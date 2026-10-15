// SPDX-License-Identifier: EUPL-1.2
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CsvRetentionService, retentionCounters } from '../ingestion/csv/csv-retention.service.js';
import { CSV_RETENTION_JOB } from '../ingestion/csv/csv.constants.js';
import { IDP_METADATA_REFRESH_JOB } from '../identity/metadata-refresh/idp-metadata-refresh.constants.js';
import {
  type IdpRefreshOutcome,
  IdpMetadataRefreshService,
  outcomeFailed,
} from '../identity/metadata-refresh/idp-metadata-refresh.service.js';
import { AccountCleanupService } from './account-cleanup.service.js';
import { DormancyService } from './dormancy.service.js';
import { HistoryPartitionsService } from './history-partitions.service.js';
import {
  ACCOUNT_CLEANUP_JOB,
  DORMANCY_JOB,
  HISTORY_PARTITIONS_JOB,
  MAINTENANCE_QUEUE,
  maintenanceJobData,
  type MaintenanceJobData,
  RETENTION_JOB,
} from './maintenance.constants.js';
import {
  type JobOutcome,
  MaintenanceJobError,
  MaintenanceRunner,
  type RunResult,
} from './maintenance-runner.js';
import { RetentionService } from './retention.service.js';

/** IdPs listed in `maintenance_runs.details` of an `idp-metadata-refresh` run. */
const MAX_IDP_RESULTS = 200;

/**
 * `maintenance_runs` view of an IdP metadata refresh (spec §4): counts per
 * status, the aggregate used and one line per IdP (no certificate bodies).
 */
export function idpRefreshOutcome(outcome: IdpRefreshOutcome): JobOutcome {
  const count = (status: string) => outcome.results.filter((r) => r.status === status).length;
  const counters = {
    updated: count('updated'),
    unchanged: count('unchanged'),
    skipped: count('skipped'),
    failed: count('failed'),
  };
  const aggregate = outcome.aggregate;
  return {
    counters,
    details: {
      status: outcome.status,
      aggregate: aggregate
        ? {
            source: aggregate.kind,
            verified: aggregate.verified,
            sha256: aggregate.sha256,
            bytes: aggregate.bytes,
            entities: aggregate.entityCount,
            valid_until: aggregate.validUntil,
            fetched_at: aggregate.fetchedAt,
          }
        : null,
      ...(outcome.aggregateError ? { aggregate_error: outcome.aggregateError } : {}),
      warnings: outcome.warnings.slice(0, 50),
      results: outcome.results.slice(0, MAX_IDP_RESULTS).map((r) => ({
        alias: r.alias,
        organization_id: r.organizationId ?? null,
        status: r.status,
        changes: r.changes,
        ...(r.error ? { error: r.error } : {}),
        ...(r.warnings.length ? { warnings: r.warnings } : {}),
      })),
    },
  };
}

/**
 * Worker side of the maintenance queue: daily schedules, the start-up runs and
 * on-demand runs. Every job runs through MaintenanceRunner (advisory lock and a
 * `maintenance_runs` row). Concurrency 1: jobs of this queue never overlap in one
 * worker. The lock lasts 10 minutes: verifying the eduGAIN aggregate blocks the
 * event loop for a while, and a lock renewal missed meanwhile must not make
 * BullMQ consider the job stalled.
 */
@Processor(MAINTENANCE_QUEUE, { concurrency: 1, lockDuration: 10 * 60_000 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly runner: MaintenanceRunner,
    private readonly partitions: HistoryPartitionsService,
    private readonly retention: RetentionService,
    private readonly dormancy: DormancyService,
    private readonly accountCleanup: AccountCleanupService,
    private readonly csvRetention: CsvRetentionService,
    private readonly idpMetadata: IdpMetadataRefreshService,
  ) {
    super();
  }

  async process(job: Job): Promise<RunResult | null> {
    const data = maintenanceJobData.parse(job.data ?? {});
    const handler = this.handler(job.name, data);
    if (!handler) {
      this.logger.warn(`Unknown job ${job.name} on queue ${MAINTENANCE_QUEUE}`);
      return null;
    }
    return this.runner.run(job.name, data.trigger, data.triggeredBy, handler);
  }

  private handler(name: string, data: MaintenanceJobData): (() => Promise<JobOutcome>) | undefined {
    switch (name) {
      case HISTORY_PARTITIONS_JOB:
        return () => this.partitions.maintain();
      case RETENTION_JOB:
        return () => this.retention.purge();
      case DORMANCY_JOB:
        return () => this.dormancy.run();
      case ACCOUNT_CLEANUP_JOB:
        return () => this.accountCleanup.run();
      case CSV_RETENTION_JOB:
        return async () => ({ counters: retentionCounters(await this.csvRetention.purge()) });
      case IDP_METADATA_REFRESH_JOB:
        return async () => {
          const outcome = await this.idpMetadata.runOnce(
            data.reuseCacheMaxAgeMs ? { reuseCacheMaxAgeMs: data.reuseCacheMaxAgeMs } : {},
          );
          const recorded = idpRefreshOutcome(outcome);
          if (outcomeFailed(outcome)) {
            const failed = outcome.results
              .filter((r) => r.status === 'failed')
              .map((r) => `${r.alias}: ${r.error ?? 'failed'}`);
            throw new MaintenanceJobError(
              `idp-metadata-refresh failed: ${outcome.aggregateError ?? failed.join('; ')}`,
              recorded,
            );
          }
          return recorded;
        };
      default:
        return undefined;
    }
  }
}
