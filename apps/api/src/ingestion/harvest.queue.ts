// SPDX-License-Identifier: EUPL-1.2
import { randomUUID } from 'node:crypto';
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

export type HarvestRequestResult = 'queued' | 'already_queued';

/** Producer side of Channel A, used by the API ("Sync now") and the worker's scheduler. */
@Injectable()
export class HarvestQueue {
  constructor(@InjectQueue(HARVEST_QUEUE) private readonly queue: Queue<HarvestJobData>) {}

  /**
   * Enqueues a harvest under job id `harvest-{organization_id}`, so a partner is
   * never harvested twice in parallel: a run already waiting or active is kept
   * and `already_queued` returned. A finished job still holding the id is removed
   * first (BullMQ ignores adds whose id exists in any state).
   */
  async request(data: HarvestJobData): Promise<HarvestRequestResult> {
    const job = harvestJobData.parse({ ...data, requestId: randomUUID() });
    const jobId = harvestJobId(job.organizationId);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove().catch(() => undefined);
      } else if (state !== 'unknown') {
        return 'already_queued';
      }
    }
    const added = await this.queue.add(HARVEST_JOB, job, {
      jobId,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1,
    });
    // A concurrent producer may have won the race: the returned job is theirs.
    return added.data.requestId === job.requestId ? 'queued' : 'already_queued';
  }

  /** Whether a harvest of the organization is waiting or running. */
  async isActive(organizationId: string): Promise<boolean> {
    const existing = await this.queue.getJob(harvestJobId(organizationId));
    if (!existing) return false;
    const state = await existing.getState();
    return state !== 'completed' && state !== 'failed' && state !== 'unknown';
  }
}
