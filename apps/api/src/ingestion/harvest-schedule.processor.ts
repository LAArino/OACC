// SPDX-License-Identifier: EUPL-1.2
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  HARVEST_SCHEDULE_QUEUE,
  type HarvestTickData,
  harvestTickData,
} from './harvest.constants.js';
import { HarvestQueue } from './harvest.queue.js';

/** Turns a scheduler tick into a deduplicated harvest job (`harvest-{organization_id}`). */
@Processor(HARVEST_SCHEDULE_QUEUE, { concurrency: 1 })
export class HarvestScheduleProcessor extends WorkerHost {
  private readonly logger = new Logger(HarvestScheduleProcessor.name);

  constructor(private readonly harvests: HarvestQueue) {
    super();
  }

  async process(job: Job<HarvestTickData>): Promise<string> {
    const { organizationId } = harvestTickData.parse(job.data);
    const result = await this.harvests.request({ organizationId, trigger: 'schedule' });
    if (result === 'already_queued') {
      this.logger.log(`Scheduled harvest of ${organizationId} skipped: a run is queued or active`);
    }
    return result;
  }
}
