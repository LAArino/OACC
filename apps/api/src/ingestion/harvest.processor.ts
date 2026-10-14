// SPDX-License-Identifier: EUPL-1.2
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { HARVEST_QUEUE, type HarvestJobData, harvestJobData } from './harvest.constants.js';

/** Channel A run for one partner (spec §6.2); at most 2 h, one per partner at a time. */
@Processor(HARVEST_QUEUE, { concurrency: 2 })
export class HarvestProcessor extends WorkerHost {
  private readonly logger = new Logger(HarvestProcessor.name);

  async process(job: Job<HarvestJobData>): Promise<void> {
    const data = harvestJobData.parse(job.data);
    this.logger.log({ jobId: job.id, ...data }, 'harvest requested; pipeline not wired yet');
  }
}
