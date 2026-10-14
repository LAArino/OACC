// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Db, KYSELY } from '../../db/db.module.js';
import { RUN_MAX_DURATION_MS } from '../sync-runs.repository.js';
import { CSV_CLOCK } from './csv-ingestion.service.js';
import { UPLOAD_RETENTION_DAYS } from './csv.constants.js';
import { UploadStorage } from './upload-storage.js';

export const RETENTION_ACTOR = 'system:retention';
const BATCH = 500;

export interface RetentionResult {
  purged: number;
  orphans: number;
  staleRuns: number;
}

/** Counters of a run, as recorded in `maintenance_runs` (job `csv-retention`). */
export function retentionCounters(result: RetentionResult): Record<string, number> {
  return {
    uploads_purged: result.purged,
    orphan_directories: result.orphans,
    stale_runs_failed: result.staleRuns,
  };
}

/**
 * Spec §10: uploads are kept 90 days. Deletes the files of older Channel B runs,
 * keeps the `sync_runs` row (its `upload_object_key` becomes null, audited as
 * `upload.purge`), removes unreferenced upload directories of the same age and
 * fails CSV runs stuck in `running` (worker crash).
 */
@Injectable()
export class CsvRetentionService {
  private readonly logger = new Logger(CsvRetentionService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly storage: UploadStorage,
    @Optional() @Inject(CSV_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async purge(): Promise<RetentionResult> {
    const now = this.now();
    const cutoff = new Date(now.getTime() - UPLOAD_RETENTION_DAYS * 86_400_000);
    const result: RetentionResult = { purged: 0, orphans: 0, staleRuns: 0 };

    for (;;) {
      const runs = await this.db
        .selectFrom('sync_runs')
        .select(['id', 'organization_id', 'upload_object_key'])
        .where('channel', '=', 'csv')
        .where('upload_object_key', 'is not', null)
        .where('created_at', '<', cutoff)
        .orderBy('created_at')
        .limit(BATCH)
        .execute();
      for (const run of runs) {
        await this.storage.remove(run.upload_object_key as string);
        await this.db.transaction().execute(async (trx) => {
          await trx
            .updateTable('sync_runs')
            .set({ upload_object_key: null })
            .where('id', '=', run.id)
            .execute();
          await trx
            .insertInto('audit_log')
            .values({
              actor_sub: RETENTION_ACTOR,
              actor_org_id: null,
              action: 'upload.purge',
              entity_type: 'sync_run',
              entity_id: run.id,
              changes: {
                organization_id: run.organization_id,
                upload_object_key: run.upload_object_key,
                reason: `retention ${UPLOAD_RETENTION_DAYS} days`,
              },
            })
            .execute();
        });
        result.purged += 1;
      }
      if (runs.length < BATCH) break;
    }

    const referenced = new Set(
      (
        await this.db
          .selectFrom('sync_runs')
          .select('upload_object_key')
          .where('channel', '=', 'csv')
          .where('upload_object_key', 'is not', null)
          .execute()
      ).map((r) => r.upload_object_key as string),
    );
    result.orphans = (await this.storage.sweep(cutoff, (key) => referenced.has(key))).length;

    const stale = await this.db
      .updateTable('sync_runs')
      .set({
        status: 'failed',
        finished_at: now,
        error_summary: 'Processing did not finish within 2 hours (worker stopped or crashed)',
      })
      .where('channel', '=', 'csv')
      .where('status', '=', 'running')
      .where('started_at', '<', new Date(now.getTime() - RUN_MAX_DURATION_MS))
      .executeTakeFirst();
    result.staleRuns = Number(stale.numUpdatedRows);

    if (result.purged || result.orphans || result.staleRuns) {
      this.logger.log(
        `Upload retention: ${result.purged} purged, ${result.orphans} orphan directories, ` +
          `${result.staleRuns} stale runs failed`,
      );
    }
    return result;
  }
}
