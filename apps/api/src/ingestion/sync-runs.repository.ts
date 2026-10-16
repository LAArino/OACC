// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import type { SyncRun, SyncRunStatus } from '@oecp/schemas';
import { type Selectable, sql } from 'kysely';
import type { SyncRunsTable } from '../db/database.js';
import { type Db, KYSELY } from '../db/db.module.js';

export type SyncRunRow = Selectable<SyncRunsTable>;

/** sync_runs.schema_version of Channel A runs (DDL comment: 'oeapi-5.0'). */
export const OEAPI_V5_SCHEMA_VERSION = 'oeapi-5.0';
/** Spec §6.2.1: a harvest lasts at most 2 h; older `running` rows are stale. */
export const RUN_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
/** Grace period before a `running` row is declared stale (worker crash). */
const STALE_MARGIN_MS = 10 * 60 * 1000;

export interface RunCounters {
  n_created: number;
  n_updated: number;
  n_unchanged: number;
  n_rejected: number;
  n_withdrawn: number;
}

export interface FinishRun extends RunCounters {
  status: Extract<SyncRunStatus, 'succeeded' | 'partial' | 'failed' | 'cancelled'>;
  is_complete: boolean;
  error_summary: string | null;
}

export function toApiSyncRun(row: SyncRunRow): SyncRun {
  const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
  const started = row.started_at ? new Date(row.started_at).getTime() : null;
  const finished = row.finished_at ? new Date(row.finished_at).getTime() : null;
  return {
    id: row.id,
    organization_id: row.organization_id,
    channel: row.channel,
    trigger_kind: row.trigger_kind,
    triggered_by: row.triggered_by,
    schema_version: row.schema_version,
    status: row.status,
    is_complete: row.is_complete,
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    duration_ms: started !== null && finished !== null ? Math.max(0, finished - started) : null,
    n_created: row.n_created,
    n_updated: row.n_updated,
    n_unchanged: row.n_unchanged,
    n_rejected: row.n_rejected,
    n_withdrawn: row.n_withdrawn,
    error_summary: row.error_summary,
    files: row.files ?? null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** `sync_runs` lifecycle for Channel A: queued → running → succeeded | partial | failed | cancelled. */
@Injectable()
export class SyncRunsRepository {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  /** "Sync now": a queued manual run whose id the API returns. */
  async createQueued(input: {
    organizationId: string;
    trigger: 'schedule' | 'manual';
    triggeredBy: string | null;
  }): Promise<SyncRunRow> {
    return this.db
      .insertInto('sync_runs')
      .values({
        organization_id: input.organizationId,
        channel: 'oeapi',
        trigger_kind: input.trigger,
        triggered_by: input.triggeredBy,
        schema_version: OEAPI_V5_SCHEMA_VERSION,
        status: 'queued',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Marks stale `running` rows of the organization as failed, then starts a run:
   * the queued row `syncRunId` if given, else a new row. Returns undefined when
   * another run of the organization is still running or the queued row is gone.
   */
  async start(input: {
    organizationId: string;
    trigger: 'schedule' | 'manual';
    triggeredBy: string | null;
    syncRunId?: string | undefined;
    now: Date;
  }): Promise<SyncRunRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      // Serialises concurrent starts for the organization within this transaction.
      await sql`select pg_advisory_xact_lock(hashtext(${'oecp-harvest:' + input.organizationId}))`.execute(
        trx,
      );
      const staleBefore = new Date(input.now.getTime() - RUN_MAX_DURATION_MS - STALE_MARGIN_MS);
      await trx
        .updateTable('sync_runs')
        .set({
          status: 'failed',
          finished_at: input.now,
          error_summary: 'Run did not finish within 2 hours (worker stopped or crashed)',
        })
        .where('organization_id', '=', input.organizationId)
        .where('channel', '=', 'oeapi')
        .where('status', '=', 'running')
        .where('started_at', '<', staleBefore)
        .execute();
      const running = await trx
        .selectFrom('sync_runs')
        .select('id')
        .where('organization_id', '=', input.organizationId)
        .where('channel', '=', 'oeapi')
        .where('status', '=', 'running')
        .executeTakeFirst();
      if (running) {
        if (input.syncRunId) {
          await trx
            .updateTable('sync_runs')
            .set({
              status: 'cancelled',
              started_at: input.now,
              finished_at: input.now,
              error_summary: `Another run (${running.id}) was in progress`,
            })
            .where('id', '=', input.syncRunId)
            .where('status', '=', 'queued')
            .execute();
        }
        return undefined;
      }
      if (input.syncRunId) {
        return trx
          .updateTable('sync_runs')
          .set({ status: 'running', started_at: input.now })
          .where('id', '=', input.syncRunId)
          .where('organization_id', '=', input.organizationId)
          .where('status', '=', 'queued')
          .returningAll()
          .executeTakeFirst();
      }
      return trx
        .insertInto('sync_runs')
        .values({
          organization_id: input.organizationId,
          channel: 'oeapi',
          trigger_kind: input.trigger,
          triggered_by: input.triggeredBy,
          schema_version: OEAPI_V5_SCHEMA_VERSION,
          status: 'running',
          started_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async finish(id: string, result: FinishRun, now: Date): Promise<void> {
    await this.db
      .updateTable('sync_runs')
      .set({ ...result, finished_at: now })
      .where('id', '=', id)
      .execute();
  }

  /** Closes a queued run that will never start (e.g. its job could not be enqueued). */
  async cancelQueued(id: string, reason: string, now: Date): Promise<void> {
    await this.db
      .updateTable('sync_runs')
      .set({ status: 'cancelled', started_at: now, finished_at: now, error_summary: reason })
      .where('id', '=', id)
      .where('status', '=', 'queued')
      .execute();
  }

  /** Queued or running (and not stale) Channel A run of the organization. */
  async findActive(organizationId: string, now: Date): Promise<SyncRunRow | undefined> {
    const since = new Date(now.getTime() - RUN_MAX_DURATION_MS - STALE_MARGIN_MS);
    return this.db
      .selectFrom('sync_runs')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('channel', '=', 'oeapi')
      .where('status', 'in', ['queued', 'running'])
      .where('created_at', '>=', since)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  }

  /** Latest manual Channel A run created at or after `since` (rate limit of "Sync now"). */
  async latestManualSince(organizationId: string, since: Date): Promise<SyncRunRow | undefined> {
    return this.db
      .selectFrom('sync_runs')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('channel', '=', 'oeapi')
      .where('trigger_kind', '=', 'manual')
      .where('status', '<>', 'cancelled')
      .where('created_at', '>=', since)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  }

  async list(organizationId: string, limit: number): Promise<SyncRunRow[]> {
    return this.db
      .selectFrom('sync_runs')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  async get(id: string): Promise<SyncRunRow | undefined> {
    return this.db.selectFrom('sync_runs').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /**
   * Courses of the run with the warning `oecp.content.handbook_incomplete`
   * (distinct `ext_id`; decision 21c).
   */
  async handbookIncomplete(id: string): Promise<number> {
    const row = await this.db
      .selectFrom('sync_errors')
      .select(sql<string>`count(distinct ext_id)`.as('n'))
      .where('sync_run_id', '=', id)
      .where('code', '=', 'oecp.content.handbook_incomplete')
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async errors(
    id: string,
    options: { page: number; pageSize: number; severity?: 'error' | 'warning' | undefined },
  ) {
    let base = this.db.selectFrom('sync_errors').where('sync_run_id', '=', id);
    if (options.severity) base = base.where('severity', '=', options.severity);
    const [items, total] = await Promise.all([
      base
        .selectAll()
        .orderBy('id', 'asc')
        .limit(options.pageSize)
        .offset((options.page - 1) * options.pageSize)
        .execute(),
      base.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow(),
    ]);
    return { items, total: Number(total.n) };
  }
}
