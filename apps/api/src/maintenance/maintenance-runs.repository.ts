// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import { type Selectable, sql } from 'kysely';
import type { MaintenanceTrigger } from '@oecp/schemas';
import type { MaintenanceRunsTable } from '../db/database.js';
import { type Db, KYSELY } from '../db/db.module.js';

export type MaintenanceRunRow = Selectable<MaintenanceRunsTable>;
export type Counters = Record<string, number>;

const MAX_ERROR_LENGTH = 2_000;

/** `maintenance_runs` (migration 0006). */
@Injectable()
export class MaintenanceRunsRepository {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  async start(job: string, trigger: MaintenanceTrigger, triggeredBy?: string): Promise<string> {
    const row = await this.db
      .insertInto('maintenance_runs')
      .values({ job, trigger_kind: trigger, triggered_by: triggeredBy ?? null })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async finish(
    id: string,
    status: 'succeeded' | 'failed' | 'skipped',
    outcome: { counters?: Counters; details?: Record<string, unknown> | null; error?: string },
  ): Promise<void> {
    await this.db
      .updateTable('maintenance_runs')
      .set({
        status,
        // Database clock, like started_at; greatest() keeps CHECK finished_at >= started_at.
        finished_at: sql<Date>`greatest(now(), started_at)`,
        counters: outcome.counters ?? {},
        details: outcome.details ?? null,
        error: outcome.error ? outcome.error.slice(0, MAX_ERROR_LENGTH) : null,
      })
      .where('id', '=', id)
      .execute();
  }

  /** Most recent first; optionally one job only. */
  list(limit: number, job?: string): Promise<MaintenanceRunRow[]> {
    let query = this.db.selectFrom('maintenance_runs').selectAll();
    if (job) query = query.where('job', '=', job);
    return query.orderBy('started_at', 'desc').orderBy('id').limit(limit).execute();
  }
}
