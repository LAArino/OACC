// SPDX-License-Identifier: EUPL-1.2
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MaintenanceRunner } from '../../maintenance/maintenance-runner.js';
import { CsvIngestionService } from './csv-ingestion.service.js';
import { CsvRetentionService, retentionCounters } from './csv-retention.service.js';
import { CSV_PROCESS_JOB, CSV_QUEUE, CSV_RETENTION_JOB, csvJobData } from './csv.constants.js';

/** Worker side of Channel B: queued uploads (> 500 rows) and the daily retention job. */
@Processor(CSV_QUEUE, { concurrency: 2, lockDuration: 120_000 })
export class CsvProcessor extends WorkerHost {
  private readonly logger = new Logger(CsvProcessor.name);

  constructor(
    private readonly ingestion: CsvIngestionService,
    private readonly retention: CsvRetentionService,
    /** Records the daily retention in `maintenance_runs` (job `csv-retention`). */
    @Optional() private readonly runner?: MaintenanceRunner,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case CSV_PROCESS_JOB: {
        const { syncRunId } = csvJobData.parse(job.data);
        const outcome = await this.ingestion.process(syncRunId);
        return { syncRunId, status: outcome.status };
      }
      case CSV_RETENTION_JOB:
        if (!this.runner) return this.retention.purge();
        return this.runner.run(CSV_RETENTION_JOB, 'schedule', undefined, async () => ({
          counters: retentionCounters(await this.retention.purge()),
        }));
      default:
        this.logger.warn(`Unknown job ${job.name} on queue ${CSV_QUEUE}`);
        return null;
    }
  }
}
