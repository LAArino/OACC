// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import type { MaintenanceTrigger } from '@oecp/schemas';
import { type Db, KYSELY } from '../db/db.module.js';
import { RunMetricsService } from '../metrics/run-metrics.service.js';
import { type Counters, MaintenanceRunsRepository } from './maintenance-runs.repository.js';

/** What a maintenance job reports; stored in `maintenance_runs`. */
export interface JobOutcome {
  counters: Counters;
  /** Small JSON document for reviewers (e.g. the dormancy candidates). */
  details?: Record<string, unknown> | null;
}

/**
 * Thrown by a job that did part of its work: the run is recorded as `failed`
 * with the counters of what was done.
 */
export class MaintenanceJobError extends Error {
  constructor(
    message: string,
    readonly outcome: JobOutcome,
  ) {
    super(message);
    this.name = 'MaintenanceJobError';
  }
}

export interface RunResult extends JobOutcome {
  runId: string;
  status: 'succeeded' | 'skipped';
}

/**
 * Runs a maintenance job under a PostgreSQL advisory lock (one run per job name
 * across worker replicas) and records it in `maintenance_runs`. A run that finds
 * the lock taken is recorded as `skipped`; a failure is recorded and rethrown, so
 * that BullMQ marks the job failed too.
 */
@Injectable()
export class MaintenanceRunner {
  private readonly logger = new Logger(MaintenanceRunner.name);

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly runs: MaintenanceRunsRepository,
    /** Worker only (spec §10 metrics); the api never runs jobs itself. */
    @Optional() private readonly metrics?: RunMetricsService,
  ) {}

  async run(
    job: string,
    trigger: MaintenanceTrigger,
    triggeredBy: string | undefined,
    fn: () => Promise<JobOutcome>,
  ): Promise<RunResult> {
    const runId = await this.runs.start(job, trigger, triggeredBy);
    const lockKey = `oecp-maintenance:${job}`;
    // A session-level lock needs one connection for its whole life.
    return this.db.connection().execute(async (conn) => {
      const { rows } = await sql<{
        locked: boolean;
      }>`SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked`.execute(conn);
      if (!rows[0]?.locked) {
        const details = { reason: 'Another run of this job is in progress' };
        await this.runs.finish(runId, 'skipped', { details });
        this.metrics?.maintenanceRunFinished(job, 'skipped');
        this.logger.warn(`Maintenance job ${job} skipped: another run is in progress`);
        return { runId, status: 'skipped', counters: {}, details };
      }
      const started = Date.now();
      try {
        const outcome = await fn();
        await this.runs.finish(runId, 'succeeded', outcome);
        this.metrics?.maintenanceRunFinished(job, 'succeeded');
        this.logger.log(
          `Maintenance job ${job} (${trigger}) succeeded in ${Date.now() - started} ms: ` +
            JSON.stringify(outcome.counters),
        );
        return { runId, status: 'succeeded', ...outcome };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const outcome = error instanceof MaintenanceJobError ? error.outcome : { counters: {} };
        await this.runs
          .finish(runId, 'failed', { ...outcome, error: message })
          .catch((e: unknown) => this.logger.error(e, `Run ${runId} could not be recorded`));
        this.metrics?.maintenanceRunFinished(job, 'failed');
        this.logger.error(error, `Maintenance job ${job} (${trigger}) failed`);
        throw error;
      } finally {
        await sql`SELECT pg_advisory_unlock(hashtext(${lockKey}))`
          .execute(conn)
          .catch(() => undefined);
      }
    });
  }
}
