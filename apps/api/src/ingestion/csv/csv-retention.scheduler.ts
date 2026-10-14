// SPDX-License-Identifier: EUPL-1.2
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  CSV_QUEUE,
  CSV_RETENTION_CRON,
  CSV_RETENTION_JOB,
  CSV_RETENTION_SCHEDULER_ID,
} from './csv.constants.js';

/** Registers the daily upload retention job (idempotent; Valkey state is rebuildable). */
@Injectable()
export class CsvRetentionScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(CsvRetentionScheduler.name);

  constructor(@InjectQueue(CSV_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        CSV_RETENTION_SCHEDULER_ID,
        { pattern: CSV_RETENTION_CRON, tz: 'UTC' },
        { name: CSV_RETENTION_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 10 } },
      );
    } catch (error) {
      this.logger.error(error, 'Upload retention job could not be scheduled');
    }
  }
}
