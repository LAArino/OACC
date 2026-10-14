// SPDX-License-Identifier: EUPL-1.2
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Job } from 'bullmq';
import { HARVEST_QUEUE, type HarvestJobData, harvestJobData } from './harvest.constants.js';
import { HarvestService } from './harvest.service.js';

/**
 * Channel A run for one partner (spec §6.2); at most 2 h (enforced by
 * HarvestService), one per partner at a time (job id), two partners in parallel.
 */
@Processor(HARVEST_QUEUE, { concurrency: 2, lockDuration: 60_000 })
export class HarvestProcessor extends WorkerHost implements OnApplicationShutdown {
  private readonly logger = new Logger(HarvestProcessor.name);
  private readonly shutdown = new AbortController();

  constructor(private readonly harvest: HarvestService) {
    super();
  }

  async process(job: Job<HarvestJobData>): Promise<{ syncRunId: string | null; status: string }> {
    const data = harvestJobData.parse(job.data);
    this.logger.log(`Harvest job ${job.id} (${data.trigger}) for ${data.organizationId}`);
    const outcome = await this.harvest.run(data, this.shutdown.signal);
    return { syncRunId: outcome.syncRunId, status: outcome.status };
  }

  onApplicationShutdown(): void {
    this.shutdown.abort(new Error('worker shutting down'));
  }
}
