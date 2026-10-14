// SPDX-License-Identifier: EUPL-1.2
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  HARVEST_JOB,
  HARVEST_QUEUE,
  type HarvestJobData,
  harvestJobData,
  harvestJobId,
} from './harvest.constants.js';

/** Producer side of Channel A, used by the API ("Sync now") and the worker's scheduler. */
@Injectable()
export class HarvestQueue {
  constructor(@InjectQueue(HARVEST_QUEUE) private readonly queue: Queue<HarvestJobData>) {}

  /** Enqueues a harvest; a run already queued or active for the organization is kept. */
  async request(data: HarvestJobData): Promise<void> {
    const job = harvestJobData.parse(data);
    await this.queue.add(HARVEST_JOB, job, {
      jobId: harvestJobId(job.organizationId),
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}
