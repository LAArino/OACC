// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  NetworkStatus,
  NetworkStatusItem,
  NetworkStatusRun,
  SourceChannel,
  SyncRunStatus,
} from '@oecp/schemas';
import { sql } from 'kysely';
import { type Db, KYSELY } from '../../db/db.module.js';
import {
  KeycloakAdminService,
  OECP_ORG_ID_ATTRIBUTE,
} from '../../identity/keycloak-admin.service.js';
import {
  integrationBlocker,
  OeapiClientFactory,
} from '../../ingestion/oeapi/oeapi-client.factory.js';
import { hostApproved } from '../integrations/integrations.service.js';
import { networkHealthOf } from './network-health.js';

export const NETWORK_STATUS_CLOCK = Symbol('NETWORK_STATUS_CLOCK');

/** Parallel Keycloak searches for the administrator counts. */
const KEYCLOAK_CONCURRENCY = 4;

interface RunRow {
  organization_id: string;
  harvest: boolean;
  id: string;
  channel: SourceChannel;
  status: SyncRunStatus;
  is_complete: boolean;
  started_at: Date | null;
  finished_at: Date | null;
  n_created: number;
  n_updated: number;
  n_unchanged: number;
  n_rejected: number;
  n_withdrawn: number;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
/** Run key: organization plus run family (Channel A harvests vs CSV uploads and form saves). */
const key = (organizationId: string, harvest: boolean) =>
  `${organizationId}:${harvest ? 'a' : 'bc'}`;

/**
 * Network status for the alliance (spec §8 "Network status"): per organization,
 * its integration, latest run, content counts, administrators and a health
 * verdict (see `networkHealth` in @oecp/schemas).
 */
@Injectable()
export class NetworkStatusService {
  private readonly logger = new Logger(NetworkStatusService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly keycloak: KeycloakAdminService,
    private readonly clients: OeapiClientFactory,
    @Optional() @Inject(NETWORK_STATUS_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async status(): Promise<NetworkStatus> {
    const now = this.now();
    const today = now.toISOString().slice(0, 10);
    const runColumns = sql`organization_id, channel = 'oeapi' as harvest, id, channel, status,
      is_complete, started_at, finished_at, n_created, n_updated, n_unchanged, n_rejected,
      n_withdrawn`;
    const [
      organizations,
      integrations,
      latest,
      finished,
      success,
      writes,
      courses,
      offerings,
      invitations,
    ] = await Promise.all([
      this.db
        .selectFrom('organizations')
        .select(['id', 'slug', 'name', 'is_partner', 'org_type', 'parent_id'])
        .where('deleted_at', 'is', null)
        .orderBy(sql`org_type = 'alliance'`, 'desc')
        .orderBy('is_partner', 'desc')
        .orderBy('slug')
        .execute(),
      this.db.selectFrom('partner_integrations').selectAll().execute(),
      sql<RunRow>`select distinct on (organization_id, channel = 'oeapi') ${runColumns}
          from sync_runs
          order by organization_id, channel = 'oeapi', created_at desc`.execute(this.db),
      sql<RunRow>`select distinct on (organization_id, channel = 'oeapi') ${runColumns}
          from sync_runs where status in ('succeeded', 'partial', 'failed')
          order by organization_id, channel = 'oeapi', finished_at desc nulls last, created_at desc`.execute(
        this.db,
      ),
      sql<{ organization_id: string; harvest: boolean; finished_at: Date }>`
          select organization_id, channel = 'oeapi' as harvest, max(finished_at) as finished_at
          from sync_runs
          where finished_at is not null
            and (status = 'succeeded' or (status = 'partial' and is_complete))
          group by organization_id, channel = 'oeapi'`.execute(this.db),
      sql<{ organization_id: string }>`select distinct organization_id from sync_runs
          where channel in ('csv', 'form')`.execute(this.db),
      sql<{ organization_id: string; total: number; published: number }>`
          select organization_id, count(*)::int as total,
            count(*) filter (where status = 'published')::int as published
          from courses where deleted_at is null group by organization_id`.execute(this.db),
      sql<{ organization_id: string; upcoming: number }>`
          select c.organization_id, count(*)::int as upcoming
          from course_offerings o join courses c on c.id = o.course_id
          where o.status = 'published' and o.deleted_at is null and c.deleted_at is null
            and o.start_date >= ${today}::date
          group by c.organization_id`.execute(this.db),
      sql<{ organization_id: string; pending: number }>`
          select organization_id, count(*)::int as pending from admin_invitations
          where accepted_at is null and revoked_at is null and expires_at > ${now}
          group by organization_id`.execute(this.db),
    ]);

    const byOrg = <T extends { organization_id: string }>(rows: T[]) =>
      new Map(rows.map((r) => [r.organization_id, r]));
    const byRunKey = <T extends { organization_id: string; harvest: boolean }>(rows: T[]) =>
      new Map(rows.map((r) => [key(r.organization_id, r.harvest), r]));
    const integrationOf = byOrg(integrations);
    const latestOf = byRunKey(latest.rows);
    const finishedOf = byRunKey(finished.rows);
    const successOf = byRunKey(success.rows);
    const writers = new Set(writes.rows.map((r) => r.organization_id));
    const coursesOf = byOrg(courses.rows);
    const offeringsOf = byOrg(offerings.rows);
    const invitationsOf = byOrg(invitations.rows);
    const admins = await this.adminCounts(organizations.map((o) => o.id));

    const items = organizations.map((org): NetworkStatusItem => {
      const integration = integrationOf.get(org.id);
      const channel: SourceChannel = integration?.authoritative_channel ?? 'form';
      const harvest = channel === 'oeapi';
      const last = latestOf.get(key(org.id, harvest));
      const lastFinished = finishedOf.get(key(org.id, harvest));
      const lastSuccess = successOf.get(key(org.id, harvest));
      const enabled = integration?.enabled ?? false;
      return {
        organization: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          is_partner: org.is_partner,
          org_type: org.org_type,
          parent_id: org.parent_id,
        },
        authoritative_channel: channel,
        access_mode: integration?.access_mode ?? null,
        enabled,
        host_approved: integration ? hostApproved(integration) : false,
        secret_configured: integration ? integration.secret_ref !== null : false,
        schedule_cron: integration?.schedule_cron ?? null,
        last_run: last ? toRun(last) : null,
        last_success_at: lastSuccess ? iso(lastSuccess.finished_at) : null,
        courses_total: coursesOf.get(org.id)?.total ?? 0,
        courses_published: coursesOf.get(org.id)?.published ?? 0,
        offerings_upcoming: offeringsOf.get(org.id)?.upcoming ?? 0,
        admins_count: admins.get(org.id) ?? null,
        pending_invitations: invitationsOf.get(org.id)?.pending ?? 0,
        health: networkHealthOf({
          authoritativeChannel: channel,
          enabled,
          blocked:
            integration !== undefined &&
            integrationBlocker(integration, this.clients.settings) !== null,
          lastFinished: lastFinished
            ? {
                status: lastFinished.status,
                is_complete: lastFinished.is_complete,
                finished_at: lastFinished.finished_at ? new Date(lastFinished.finished_at) : null,
              }
            : null,
          hasWrites: writers.has(org.id),
          scheduleCron: integration?.schedule_cron ?? null,
          now,
        }),
      };
    });
    return { generated_at: now.toISOString(), items };
  }

  /**
   * Keycloak users per organization (attribute `oecp_org_id`). A failed search
   * leaves that organization's count null rather than failing the page.
   */
  private async adminCounts(ids: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    let failures = 0;
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          counts.set(
            id,
            (await this.keycloak.findUsersByAttribute(OECP_ORG_ID_ATTRIBUTE, id)).length,
          );
        } catch (error) {
          failures += 1;
          if (failures === 1) {
            this.logger.warn(`Administrator counts unavailable: ${(error as Error).message}`);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(KEYCLOAK_CONCURRENCY, ids.length) }, worker));
    return counts;
  }
}

function toRun(row: RunRow): NetworkStatusRun {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    is_complete: row.is_complete,
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    n_created: row.n_created,
    n_updated: row.n_updated,
    n_unchanged: row.n_unchanged,
    n_rejected: row.n_rejected,
    n_withdrawn: row.n_withdrawn,
  };
}
