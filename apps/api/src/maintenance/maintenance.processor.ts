// SPDX-License-Identifier: EUPL-1.2
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CsvRetentionService, retentionCounters } from '../ingestion/csv/csv-retention.service.js';
import { CSV_RETENTION_JOB } from '../ingestion/csv/csv.constants.js';
import { IDP_METADATA_REFRESH_JOB } from '../identity/metadata-refresh/idp-metadata-refresh.constants.js';
import {
  IdpMetadataRefreshService,
  outcomeFailed,
} from '../identity/metadata-refresh/idp-metadata-refresh.service.js';
import { DormancyService } from './dormancy.service.js';
import { HistoryPartitionsService } from './history-partitions.service.js';
import {
  DORMANCY_JOB,
  HISTORY_PARTITIONS_JOB,
  MAINTENANCE_QUEUE,
  maintenanceJobData,
  RETENTION_JOB,
} from './maintenance.constants.js';
import { type JobOutcome, MaintenanceRunner, type RunResult } from './maintenance-runner.js';
import { RetentionService } from './retention.service.js';

/**
 * Worker side of the maintenance queue: daily schedules, the start-up run and
 * on-demand runs. Every job runs through MaintenanceRunner (advisory lock and a
 * `maintenance_runs` row). Concurrency 1: jobs of this queue never overlap in one
 * worker.
 */
@Processor(MAINTENANCE_QUEUE, { concurrency: 1, lockDuration: 300_000 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly runner: MaintenanceRunner,
    private readonly partitions: HistoryPartitionsService,
    private readonly retention: RetentionService,
    private readonly dormancy: DormancyService,
    private readonly csvRetention: CsvRetentionService,
    private readonly idpMetadata: IdpMetadataRefreshService,
  ) {
    super();
  }

  async process(job: Job): Promise<RunResult | null> {
    const handler = this.handler(job.name);
    if (!handler) {
      this.logger.warn(`Unknown job ${job.name} on queue ${MAINTENANCE_QUEUE}`);
      return null;
    }
    const data = maintenanceJobData.parse(job.data ?? {});
    return this.runner.run(job.name, data.trigger, data.triggeredBy, handler);
  }

  private handler(name: string): (() => Promise<JobOutcome>) | undefined {
    switch (name) {
      case HISTORY_PARTITIONS_JOB:
        return () => this.partitions.maintain();
      case RETENTION_JOB:
        return () => this.retention.purge();
      case DORMANCY_JOB:
        return () => this.dormancy.run();
      case CSV_RETENTION_JOB:
        return async () => ({ counters: retentionCounters(await this.csvRetention.purge()) });
      case IDP_METADATA_REFRESH_JOB:
        return async () => {
          const outcome = await this.idpMetadata.runOnce();
          const counters = {
            updated: outcome.results.filter((r) => r.status === 'updated').length,
            unchanged: outcome.results.filter((r) => r.status === 'unchanged').length,
            skipped: outcome.results.filter((r) => r.status === 'skipped').length,
            failed: outcome.results.filter((r) => r.status === 'failed').length,
          };
          if (outcomeFailed(outcome)) {
            throw new Error(`idp-metadata-refresh: ${counters.failed} identity provider(s) failed`);
          }
          return { counters };
        };
      default:
        return undefined;
    }
  }
}
