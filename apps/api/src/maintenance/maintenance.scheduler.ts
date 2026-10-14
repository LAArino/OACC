// SPDX-License-Identifier: EUPL-1.2
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  HISTORY_PARTITIONS_JOB,
  MAINTENANCE_QUEUE,
  MAINTENANCE_SCHEDULES,
  maintenanceSchedulerId,
  STARTUP_JOB_ID,
} from './maintenance.constants.js';
import { MaintenanceQueue } from './maintenance.queue.js';

/**
 * Registers the daily maintenance jobs (idempotent; Valkey state is rebuildable)
 * and runs `history-partitions` once at worker start, so that a worker that was
 * down at the turn of a month never leaves the history without its partition.
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly producer: MaintenanceQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const { job, pattern } of MAINTENANCE_SCHEDULES) {
      try {
        await this.queue.upsertJobScheduler(
          maintenanceSchedulerId(job),
          { pattern, tz: 'UTC' },
          {
            name: job,
            data: { trigger: 'schedule' },
            opts: { removeOnComplete: true, removeOnFail: 20 },
          },
        );
      } catch (error) {
        this.logger.error(error, `Maintenance job ${job} could not be scheduled`);
      }
    }
    try {
      await this.producer.request(HISTORY_PARTITIONS_JOB, { trigger: 'startup' }, STARTUP_JOB_ID);
    } catch (error) {
      this.logger.error(error, 'Start-up run of history-partitions could not be queued');
    }
  }
}
