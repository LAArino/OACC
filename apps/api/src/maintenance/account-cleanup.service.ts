// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { adminRole } from '@oecp/schemas';
import { sql } from 'kysely';
import { type Db, KYSELY } from '../db/db.module.js';
import {
  KeycloakAdminService,
  type KeycloakUser,
  OECP_ORG_ID_ATTRIBUTE,
} from '../identity/keycloak-admin.service.js';
import {
  type AccountEvidence,
  decideAccountDeletion,
  isServiceAccount,
  type KeepReason,
} from './account-cleanup.js';
import {
  ACCOUNT_CLEANUP_ACTOR,
  MAINTENANCE_CLOCK,
  MAINTENANCE_OPTIONS,
  type MaintenanceOptions,
} from './maintenance.constants.js';
import { type JobOutcome, MaintenanceJobError } from './maintenance-runner.js';
import { subtractMonths } from './months.js';

/** Audit actions that remove OACC roles (spec §2.2): the evidence of a removal. */
export const ROLE_REMOVAL_ACTIONS = ['admin.revoke', 'admin.dormant_revoke'] as const;
export const ACCOUNT_DELETED_ACTION = 'admin.account_deleted';
/** At most this many accounts are listed in `maintenance_runs.details`. */
export const MAX_LISTED = 500;

interface Removal {
  sub: string;
  lastRemovalAt: Date;
  action: string;
  organizationId: string | null;
}

type Action = 'deleted' | 'would_delete' | 'failed';

const isOecpRole = (name: string) => adminRole.safeParse(name).success;
const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/**
 * Account cleanup (spec §2.2, §10), daily: Keycloak accounts of the realm whose
 * OACC roles were removed (revocation `admin.revoke` or dormancy
 * `admin.dormant_revoke`, read from `audit_log`) more than
 * `OECP_ACCOUNT_DELETE_MONTHS` (12) months ago are deleted through the Admin API
 * when nothing shows they are still in use (see {@link decideAccountDeletion}):
 * never accounts holding an OACC role, service accounts or accounts younger than
 * the period. Each deletion is audited `admin.account_deleted` by
 * `system:account-cleanup` and removes the account's `admin_activity` row; the
 * job also deletes `admin_activity` rows idle for the period whose `sub` holds no
 * OACC role. With `OECP_ACCOUNT_CLEANUP_DRY_RUN=true` (the default) nothing is
 * changed: the run lists the accounts it would delete.
 */
@Injectable()
export class AccountCleanupService {
  private readonly logger = new Logger(AccountCleanupService.name);
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
    const { accountDeleteMonths: months, accountCleanupDryRun: dryRun } = this.options;
    const cutoff = subtractMonths(now, months);

    const removals = await this.removals();
    const due = removals.filter((r) => r.lastRemovalAt.getTime() < cutoff.getTime());
    const candidates: Record<string, unknown>[] = [];
    const kept: Record<string, unknown>[] = [];
    const keptByReason: Partial<Record<KeepReason, number>> = {};
    const failures: string[] = [];
    let deleted = 0;
    let wouldDelete = 0;
    let alreadyAbsent = 0;
    let eventsReadable = true;
    // Subs whose account exists: their activity row is decided here, not below.
    const handled = new Set<string>();

    for (const removal of due) {
      try {
        const user = await this.keycloak.getUser(removal.sub);
        if (!user) {
          alreadyAbsent += 1;
          continue;
        }
        handled.add(removal.sub);
        const evidence = await this.evidence(removal, user, now);
        let decision = decideAccountDeletion(evidence, cutoff);
        // Login events are read only for accounts that would go without them.
        if (decision.delete && eventsReadable) {
          const login = await this.keycloak.lastLogin(removal.sub);
          if (login.available) {
            evidence.lastLoginAt = login.at;
            decision = decideAccountDeletion(evidence, cutoff);
          } else {
            eventsReadable = false;
          }
        }
        const entry = {
          sub: removal.sub,
          organization_id: removal.organizationId,
          last_role_removal_at: removal.lastRemovalAt.toISOString(),
          removal_action: removal.action,
          created_at: iso(evidence.createdAt),
          last_activity_at: iso(evidence.lastActivityAt),
        };
        if (!decision.delete) {
          keptByReason[decision.reason] = (keptByReason[decision.reason] ?? 0) + 1;
          kept.push({ ...entry, reason: decision.reason });
          continue;
        }
        if (dryRun) {
          wouldDelete += 1;
          candidates.push({ ...entry, action: 'would_delete' satisfies Action });
          continue;
        }
        const gone = await this.delete(removal, evidence, months);
        if (gone) {
          deleted += 1;
          candidates.push({ ...entry, action: 'deleted' satisfies Action });
        } else {
          alreadyAbsent += 1;
        }
      } catch (error) {
        failures.push(`${removal.sub}: ${(error as Error).message}`);
        candidates.push({
          sub: removal.sub,
          organization_id: removal.organizationId,
          last_role_removal_at: removal.lastRemovalAt.toISOString(),
          removal_action: removal.action,
          action: 'failed' satisfies Action,
        });
        this.logger.error(error, `Account ${removal.sub} could not be cleaned up`);
      }
    }

    const activity = await this.idleActivity(cutoff, handled, dryRun, failures);

    const counters = {
      removed_accounts: removals.length,
      within_period: removals.length - due.length,
      checked: due.length,
      deleted,
      would_delete: wouldDelete,
      already_absent: alreadyAbsent,
      kept: kept.length,
      failed: failures.length,
      activity_rows_deleted: dryRun ? 0 : activity,
      activity_rows_would_delete: dryRun ? activity : 0,
      dry_run: dryRun ? 1 : 0,
      login_events_readable: eventsReadable ? 1 : 0,
    };
    const outcome: JobOutcome = {
      counters,
      details: {
        dry_run: dryRun,
        months,
        cutoff: cutoff.toISOString(),
        candidates: candidates.slice(0, MAX_LISTED),
        kept: kept.slice(0, MAX_LISTED),
        kept_by_reason: keptByReason,
        ...(candidates.length > MAX_LISTED || kept.length > MAX_LISTED ? { truncated: true } : {}),
      },
    };
    if (dryRun && wouldDelete) {
      this.logger.warn(
        `Account cleanup (dry run, ${months} months): would delete ${wouldDelete} Keycloak ` +
          'account(s). Set OECP_ACCOUNT_CLEANUP_DRY_RUN=false to enforce.',
      );
    } else if (deleted) {
      this.logger.log(`Account cleanup: deleted ${deleted} Keycloak account(s)`);
    }
    if (failures.length) {
      throw new MaintenanceJobError(failures.slice(0, 20).join('; '), outcome);
    }
    return outcome;
  }

  /**
   * Latest role removal per `sub`, from the audit log, without the subs whose
   * account was deleted by this job after that removal (a later audit row:
   * `id` is an identity column, so the order does not depend on clocks).
   */
  private async removals(): Promise<Removal[]> {
    const { rows } = await sql<{
      sub: string;
      last_removal_at: Date;
      action: string;
      organization_id: string | null;
    }>`
      WITH removal AS (
        SELECT DISTINCT ON (changes->>'keycloak_user_id')
               changes->>'keycloak_user_id' AS sub, id, occurred_at, action, entity_id
        FROM audit_log
        WHERE action IN (${sql.join([...ROLE_REMOVAL_ACTIONS])})
          AND coalesce(changes->>'keycloak_user_id', '') <> ''
        ORDER BY changes->>'keycloak_user_id', occurred_at DESC, id DESC
      )
      SELECT r.sub, r.occurred_at AS last_removal_at, r.action, r.entity_id AS organization_id
      FROM removal r
      WHERE NOT EXISTS (
        SELECT 1 FROM audit_log d
        WHERE d.action = ${ACCOUNT_DELETED_ACTION}
          AND d.changes->>'keycloak_user_id' = r.sub
          AND d.id > r.id
      )
      ORDER BY r.occurred_at, r.sub`.execute(this.db);
    return rows.map((r) => ({
      sub: r.sub,
      lastRemovalAt: new Date(r.last_removal_at),
      action: r.action,
      organizationId: r.organization_id,
    }));
  }

  private async evidence(
    removal: Removal,
    user: KeycloakUser,
    now: Date,
  ): Promise<AccountEvidence> {
    const [roles, activity, grant, pending] = await Promise.all([
      this.keycloak.realmRoleNames(removal.sub),
      this.db
        .selectFrom('admin_activity')
        .select('last_seen_at')
        .where('sub', '=', removal.sub)
        .executeTakeFirst(),
      this.db
        .selectFrom('admin_invitations')
        .select((eb) => eb.fn.max('accepted_at').as('at'))
        .where('accepted_sub', '=', removal.sub)
        .executeTakeFirst(),
      user.email
        ? this.db
            .selectFrom('admin_invitations')
            .select('id')
            .where(sql<boolean>`lower(email) = lower(${user.email})`)
            .where('accepted_at', 'is', null)
            .where('revoked_at', 'is', null)
            .where('expires_at', '>', now)
            .limit(1)
            .executeTakeFirst()
        : Promise.resolve(undefined),
    ]);
    return {
      lastRemovalAt: removal.lastRemovalAt,
      lastGrantAt: grant?.at ? new Date(grant.at) : null,
      roles: roles.filter(isOecpRole),
      serviceAccount: isServiceAccount(user),
      organizationAttribute: (user.attributes?.[OECP_ORG_ID_ATTRIBUTE] ?? []).some(
        (v) => v.trim() !== '',
      ),
      createdAt: typeof user.createdTimestamp === 'number' ? new Date(user.createdTimestamp) : null,
      lastActivityAt: activity ? new Date(activity.last_seen_at) : null,
      lastLoginAt: null,
      pendingInvitation: pending !== undefined,
    };
  }

  /**
   * Deletes the account in Keycloak inside the transaction that writes the audit
   * row and removes the activity row, so a Keycloak failure leaves no trace and
   * the next run retries. Returns false when Keycloak no longer had the account.
   */
  private async delete(
    removal: Removal,
    evidence: AccountEvidence,
    months: number,
  ): Promise<boolean> {
    return this.db
      .transaction()
      .execute(async (trx) => {
        await trx
          .insertInto('audit_log')
          .values({
            actor_sub: ACCOUNT_CLEANUP_ACTOR,
            actor_org_id: null,
            action: ACCOUNT_DELETED_ACTION,
            entity_type: 'organization',
            entity_id: removal.organizationId,
            changes: {
              keycloak_user_id: removal.sub,
              last_role_removal_at: removal.lastRemovalAt.toISOString(),
              removal_action: removal.action,
              account_created_at: iso(evidence.createdAt),
              last_activity_at: iso(evidence.lastActivityAt),
              last_login_at: iso(evidence.lastLoginAt),
              threshold_months: months,
            },
          })
          .execute();
        await trx.deleteFrom('admin_activity').where('sub', '=', removal.sub).execute();
        const gone = await this.keycloak.deleteUser(removal.sub);
        // Nothing to audit when someone else deleted the account first.
        if (!gone) throw new AccountAlreadyAbsent();
        this.logger.log(
          `Keycloak account ${removal.sub} deleted (roles removed ${removal.action})`,
        );
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof AccountAlreadyAbsent) return false;
        throw error;
      });
  }

  /**
   * `admin_activity` rows idle since before the cutoff whose `sub` holds no OACC
   * role (or no longer exists). Subs handled above are skipped. Returns how
   * many rows were (or, in a dry run, would be) deleted.
   */
  private async idleActivity(
    cutoff: Date,
    handled: ReadonlySet<string>,
    dryRun: boolean,
    failures: string[],
  ): Promise<number> {
    const rows = await this.db
      .selectFrom('admin_activity')
      .select('sub')
      .where('last_seen_at', '<', cutoff)
      .orderBy('sub')
      .execute();
    let count = 0;
    for (const { sub } of rows) {
      if (handled.has(sub)) continue;
      try {
        const user = await this.keycloak.getUser(sub);
        const roles = user ? (await this.keycloak.realmRoleNames(sub)).filter(isOecpRole) : [];
        if (roles.length > 0) continue;
        if (!dryRun) {
          await this.db
            .deleteFrom('admin_activity')
            .where('sub', '=', sub)
            .where('last_seen_at', '<', cutoff)
            .execute();
        }
        count += 1;
      } catch (error) {
        failures.push(`admin_activity ${sub}: ${(error as Error).message}`);
        this.logger.error(error, `Activity row of ${sub} could not be checked`);
      }
    }
    return count;
  }
}

class AccountAlreadyAbsent extends Error {
  constructor() {
    super('Keycloak account already absent');
  }
}
