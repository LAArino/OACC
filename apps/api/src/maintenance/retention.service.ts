// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type RawBuilder, sql } from 'kysely';
import { type Db, KYSELY } from '../db/db.module.js';
import {
  MAINTENANCE_CLOCK,
  MAINTENANCE_OPTIONS,
  type MaintenanceOptions,
} from './maintenance.constants.js';
import type { JobOutcome } from './maintenance-runner.js';
import { subtractMonths } from './months.js';

/** Rows deleted per statement (one short transaction each). */
export const RETENTION_BATCH = 5_000;
/** A run still `running` after this long was interrupted (worker stopped or crashed). */
export const STALE_RUN_HOURS = 6;

export interface RetentionCutoffs {
  sync_errors: Date;
  sync_runs: Date;
  audit_log: Date;
  admin_invitations: Date;
  maintenance_runs: Date;
  admin_activity: Date;
}

/** Cut-offs of spec §10 for a given instant: rows strictly older are deleted. */
export function retentionCutoffs(now: Date, options: MaintenanceOptions): RetentionCutoffs {
  return {
    sync_errors: subtractMonths(now, options.syncErrorsRetentionMonths),
    sync_runs: subtractMonths(now, options.syncRunsRetentionMonths),
    audit_log: subtractMonths(now, options.auditRetentionMonths),
    admin_invitations: subtractMonths(now, options.invitationsRetentionMonths),
    maintenance_runs: subtractMonths(now, options.maintenanceRunsRetentionMonths),
    admin_activity: subtractMonths(now, options.adminActivityRetentionMonths),
  };
}

/**
 * Retention of operational records (spec §10), daily:
 *
 * - `sync_errors` older than 12 months (`OECP_RETENTION_SYNC_ERRORS_MONTHS`);
 * - `sync_runs` older than 24 months (`OECP_RETENTION_SYNC_RUNS_MONTHS`) with
 *   their remaining errors, except runs still queued or running, runs whose
 *   upload file is not purged yet (csv-retention does that after 90 days) and
 *   runs still referenced by `ext_metadata_history` (kept until the history
 *   partition is dropped);
 * - `audit_log` older than 36 months (`OECP_RETENTION_AUDIT_MONTHS`);
 * - `admin_invitations` accepted, revoked or expired more than 12 months ago;
 * - `maintenance_runs` started more than 12 months ago;
 * - `admin_activity` rows not refreshed for 12 months (the administrator is
 *   dormant by then anyway).
 *
 * Batched deletes of {@link RETENTION_BATCH} rows. Also fails maintenance runs
 * left `running` for {@link STALE_RUN_HOURS} hours. The history partitions have
 * their own job (history-partitions).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    @Inject(MAINTENANCE_OPTIONS) private readonly options: MaintenanceOptions,
    @Optional() @Inject(MAINTENANCE_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async purge(): Promise<JobOutcome> {
    const now = this.now();
    const cut = retentionCutoffs(now, this.options);
    const counters: Record<string, number> = {};

    counters['sync_errors'] = await this.deleteBatched(
      'sync_errors',
      sql`SELECT id FROM sync_errors WHERE created_at < ${cut.sync_errors} ORDER BY id`,
    );
    counters['sync_runs'] = await this.deleteBatched(
      'sync_runs',
      sql`SELECT r.id FROM sync_runs r
          WHERE r.created_at < ${cut.sync_runs}
            AND r.status NOT IN ('queued', 'running')
            AND r.upload_object_key IS NULL
            AND NOT EXISTS (SELECT 1 FROM ext_metadata_history h WHERE h.sync_run_id = r.id)
          ORDER BY r.created_at`,
    );
    counters['sync_runs_kept_referenced'] = await this.count(
      sql`SELECT count(*)::int AS n FROM sync_runs r
          WHERE r.created_at < ${cut.sync_runs}
            AND EXISTS (SELECT 1 FROM ext_metadata_history h WHERE h.sync_run_id = r.id)`,
    );
    counters['audit_log'] = await this.deleteBatched(
      'audit_log',
      sql`SELECT id FROM audit_log WHERE occurred_at < ${cut.audit_log} ORDER BY id`,
    );
    counters['admin_invitations'] = await this.deleteBatched(
      'admin_invitations',
      sql`SELECT id FROM admin_invitations
          WHERE coalesce(accepted_at, revoked_at,
                         CASE WHEN expires_at < ${now} THEN expires_at END)
                < ${cut.admin_invitations}`,
    );
    counters['maintenance_runs'] = await this.deleteBatched(
      'maintenance_runs',
      sql`SELECT id FROM maintenance_runs
          WHERE started_at < ${cut.maintenance_runs} AND status <> 'running'`,
    );
    counters['admin_activity'] = await this.deleteBatched(
      'admin_activity',
      sql`SELECT sub AS id FROM admin_activity WHERE last_seen_at < ${cut.admin_activity}`,
      'sub',
    );

    const stale = await this.db
      .updateTable('maintenance_runs')
      .set({
        status: 'failed',
        finished_at: sql<Date>`greatest(now(), started_at)`,
        error: `Did not finish within ${STALE_RUN_HOURS} hours (worker stopped or crashed)`,
      })
      .where('status', '=', 'running')
      .where('started_at', '<', new Date(now.getTime() - STALE_RUN_HOURS * 3_600_000))
      .executeTakeFirst();
    counters['stale_maintenance_runs'] = Number(stale.numUpdatedRows);

    const deleted = Object.entries(counters).filter(([, n]) => n > 0);
    if (deleted.length) {
      this.logger.log(
        `Retention: ${deleted.map(([k, n]) => `${k} ${n}`).join(', ')} (cut-offs ${JSON.stringify(cut)})`,
      );
    }
    return {
      counters,
      details: {
        cutoffs: Object.fromEntries(Object.entries(cut).map(([k, d]) => [k, d.toISOString()])),
      },
    };
  }

  /**
   * Deletes the rows whose key `select` returns (column `id`), at most
   * {@link RETENTION_BATCH} per statement, until none is left.
   */
  private async deleteBatched(
    table: string,
    select: RawBuilder<unknown>,
    key: 'id' | 'sub' = 'id',
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await sql`
        DELETE FROM ${sql.table(table)}
        WHERE ${sql.ref(key)} IN (
          SELECT batch.id FROM (${select}) AS batch LIMIT ${sql.lit(RETENTION_BATCH)}
        )`.execute(this.db);
      const n = Number(result.numAffectedRows ?? 0);
      total += n;
      if (n < RETENTION_BATCH) return total;
    }
  }

  private async count(query: RawBuilder<unknown>): Promise<number> {
    const { rows } = await sql<{ n: number }>`${query}`.execute(this.db);
    return rows[0]?.n ?? 0;
  }
}
