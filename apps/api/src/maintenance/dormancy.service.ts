// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type AdminRole, adminRole, uuid } from '@oecp/schemas';
import { sql } from 'kysely';
import { type Db, KYSELY } from '../db/db.module.js';
import {
  KeycloakAdminService,
  type KeycloakUser,
  OECP_ORG_ID_ATTRIBUTE,
} from '../identity/keycloak-admin.service.js';
import {
  DORMANCY_ACTOR,
  MAINTENANCE_CLOCK,
  MAINTENANCE_OPTIONS,
  type MaintenanceOptions,
} from './maintenance.constants.js';
import { type JobOutcome, MaintenanceJobError } from './maintenance-runner.js';
import { type AdminAccount, decideDormancy, planRevocations } from './dormancy.js';

/** Migration whose run time marks the start of activity tracking. */
export const TRACKING_MIGRATION = '0006_maintenance';
const ADMIN_ROLES = adminRole.options;

interface Holder {
  user: KeycloakUser;
  roles: Set<AdminRole>;
}

type CandidateAction = 'revoked' | 'would_revoke' | 'kept_last_alliance_admin' | 'failed';

/**
 * Dormancy (spec §2.2), daily: every Keycloak user holding `partner_admin` or
 * `alliance_admin` whose last activity (see {@link decideDormancy}) is more than
 * `OECP_DORMANCY_DAYS` (180) days ago loses the OECP realm roles and
 * `oecp_org_id` and is logged out, audited as `admin.dormant_revoke` by
 * `system:dormancy`. The last alliance_admin is never revoked. With
 * `OECP_DORMANCY_DRY_RUN=true` (the default) nothing is changed: the run lists
 * the administrators it would revoke, for the alliance to review.
 */
@Injectable()
export class DormancyService {
  private readonly logger = new Logger(DormancyService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly keycloak: KeycloakAdminService,
    @Inject(MAINTENANCE_OPTIONS) private readonly options: MaintenanceOptions,
    @Optional() @Inject(MAINTENANCE_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async run(): Promise<JobOutcome> {
    const now = this.now();
    const { dormancyDays, dormancyDryRun: dryRun } = this.options;
    const trackingSince = await this.trackingSince();

    const holders = new Map<string, Holder>();
    for (const role of ADMIN_ROLES) {
      for (const user of await this.keycloak.usersWithRealmRole(role)) {
        const holder = holders.get(user.id) ?? { user, roles: new Set<AdminRole>() };
        holder.roles.add(role);
        holders.set(user.id, holder);
      }
    }
    const lastSeen = await this.lastSeen([...holders.keys()]);

    // Login events are read only for accounts that look dormant without them.
    let eventsReadable = true;
    const accounts: AdminAccount[] = [];
    for (const [sub, holder] of holders) {
      const evidence = {
        lastSeenAt: lastSeen.get(sub) ?? null,
        lastLoginAt: null as Date | null,
        createdAt:
          typeof holder.user.createdTimestamp === 'number'
            ? new Date(holder.user.createdTimestamp)
            : null,
        trackingSince,
      };
      let decision = decideDormancy(evidence, now, dormancyDays);
      if (decision.dormant && eventsReadable) {
        const login = await this.keycloak.lastLogin(sub);
        if (login.available) {
          evidence.lastLoginAt = login.at;
          decision = decideDormancy(evidence, now, dormancyDays);
        } else {
          eventsReadable = false;
        }
      }
      accounts.push({ sub, roles: [...holder.roles].sort(), decision });
    }

    const plan = planRevocations(accounts);
    const candidates: Record<string, unknown>[] = [];
    const describe = (account: AdminAccount, action: CandidateAction) => {
      const decision = account.decision;
      candidates.push({
        sub: account.sub,
        roles: account.roles,
        organization_id: this.organizationOf(holders.get(account.sub)?.user),
        last_activity_at: decision.lastActivityAt?.toISOString() ?? null,
        basis: decision.basis,
        inactive_days: decision.dormant ? decision.inactiveDays : null,
        action,
      });
    };

    let revoked = 0;
    const failures: string[] = [];
    for (const account of plan.revoke) {
      if (dryRun) {
        describe(account, 'would_revoke');
        continue;
      }
      try {
        const outcome = await this.revoke(account, holders.get(account.sub)?.user);
        if (outcome === 'revoked') {
          revoked += 1;
          describe(account, 'revoked');
        } else {
          describe(account, 'kept_last_alliance_admin');
        }
      } catch (error) {
        failures.push(`${account.sub}: ${(error as Error).message}`);
        describe(account, 'failed');
        this.logger.error(error, `Dormant administrator ${account.sub} could not be revoked`);
      }
    }
    for (const account of plan.keptLastAllianceAdmin) describe(account, 'kept_last_alliance_admin');

    const dormant = accounts.filter((a) => a.decision.dormant).length;
    const counters = {
      administrators: accounts.length,
      dormant,
      revoked,
      would_revoke: dryRun ? plan.revoke.length : 0,
      kept_last_alliance_admin: candidates.filter((c) => c['action'] === 'kept_last_alliance_admin')
        .length,
      failed: failures.length,
      no_evidence: accounts.filter(
        (a) => !a.decision.dormant && a.decision.reason === 'no_evidence',
      ).length,
      dry_run: dryRun ? 1 : 0,
      login_events_readable: eventsReadable ? 1 : 0,
    };
    const outcome: JobOutcome = {
      counters,
      details: {
        dry_run: dryRun,
        threshold_days: dormancyDays,
        tracking_since: trackingSince.toISOString(),
        candidates,
      },
    };
    if (dryRun && plan.revoke.length) {
      this.logger.warn(
        `Dormancy (dry run, ${dormancyDays} days): would revoke ${plan.revoke.length} ` +
          `administrator(s): ${plan.revoke.map((a) => a.sub).join(', ')}. ` +
          'Set OECP_DORMANCY_DRY_RUN=false to enforce.',
      );
    } else if (revoked) {
      this.logger.log(`Dormancy: revoked ${revoked} administrator(s) idle > ${dormancyDays} days`);
    }
    if (failures.length) throw new MaintenanceJobError(failures.join('; '), outcome);
    return outcome;
  }

  /**
   * Revokes one dormant account with fresh role data; refuses (returns
   * `kept_last_alliance_admin`) when it holds the only alliance_admin mapping left.
   */
  private async revoke(
    account: AdminAccount,
    user: KeycloakUser | undefined,
  ): Promise<'revoked' | 'kept_last_alliance_admin'> {
    const roles = (await this.keycloak.realmRoleNames(account.sub)).filter(
      (r): r is AdminRole => adminRole.safeParse(r).success,
    );
    if (
      roles.includes('alliance_admin') &&
      (await this.keycloak.countUsersWithRole('alliance_admin')) <= 1
    ) {
      return 'kept_last_alliance_admin';
    }
    await this.keycloak.revokeOecpAccess(account.sub, roles);
    const organizationId = this.organizationOf(user);
    const decision = account.decision;
    await this.db
      .insertInto('audit_log')
      .values({
        actor_sub: DORMANCY_ACTOR,
        actor_org_id: null,
        action: 'admin.dormant_revoke',
        entity_type: 'organization',
        entity_id: organizationId,
        changes: {
          keycloak_user_id: account.sub,
          roles_removed: roles,
          oecp_org_id: { from: user?.attributes?.[OECP_ORG_ID_ATTRIBUTE]?.[0] ?? null, to: null },
          last_activity_at: decision.lastActivityAt?.toISOString() ?? null,
          basis: decision.basis,
          inactive_days: decision.dormant ? decision.inactiveDays : null,
          threshold_days: this.options.dormancyDays,
          sessions: 'logged_out',
        },
      })
      .execute();
    this.logger.log(`Dormant administrator ${account.sub} revoked (${roles.join(', ')})`);
    return 'revoked';
  }

  private organizationOf(user: KeycloakUser | undefined): string | null {
    const value = user?.attributes?.[OECP_ORG_ID_ATTRIBUTE]?.[0];
    return value && uuid.safeParse(value).success ? value.toLowerCase() : null;
  }

  private async lastSeen(subs: string[]): Promise<Map<string, Date>> {
    const result = new Map<string, Date>();
    for (let i = 0; i < subs.length; i += 1_000) {
      const chunk = subs.slice(i, i + 1_000);
      const rows = await this.db
        .selectFrom('admin_activity')
        .select(['sub', 'last_seen_at'])
        .where('sub', 'in', chunk)
        .execute();
      for (const row of rows) result.set(row.sub, new Date(row.last_seen_at));
    }
    return result;
  }

  /**
   * When activity tracking started: the run time of migration 0006 (`run_on` is a
   * timestamp without time zone, written in the session time zone). Without it
   * the job refuses to decide, since inactivity before tracking is unknown.
   */
  private async trackingSince(): Promise<Date> {
    try {
      const { rows } = await sql<{ run_on: Date }>`
        SELECT run_on AT TIME ZONE current_setting('TimeZone') AS run_on
        FROM pgmigrations WHERE name = ${TRACKING_MIGRATION}`.execute(this.db);
      if (rows[0]) return new Date(rows[0].run_on);
    } catch {
      // Table absent: the schema was not migrated with node-pg-migrate.
    }
    throw new Error(
      `Start of activity tracking unknown (no pgmigrations row ${TRACKING_MIGRATION}); ` +
        'dormancy not evaluated',
    );
  }
}
