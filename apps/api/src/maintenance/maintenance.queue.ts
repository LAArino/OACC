// SPDX-License-Identifier: EUPL-1.2
import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { MAINTENANCE_QUEUE, type MaintenanceJobData } from './maintenance.constants.js';

export type MaintenanceRequestResult = 'queued' | 'already_queued';

/** Producer of one-off maintenance jobs (API "run now", worker start). */
@Injectable()
export class MaintenanceQueue {
  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  /**
   * Adds `job` under the custom id `jobId` unless a job with that id is still
   * waiting or running (`already_queued`). A finished job still holding the id
   * is removed first, since BullMQ ignores adds of an existing id.
   */
  async request(
    job: string,
    data: MaintenanceJobData,
    jobId: string,
  ): Promise<MaintenanceRequestResult> {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove().catch(() => undefined);
      } else if (state !== 'unknown') {
        return 'already_queued';
      }
    }
    const requestId = randomUUID();
    const added = await this.queue.add(
      job,
      { ...data, requestId },
      { jobId, attempts: 1, removeOnComplete: true, removeOnFail: 50 },
    );
    // A concurrent producer may have won the race: the returned job is theirs.
    return (added.data as { requestId?: string }).requestId === requestId
      ? 'queued'
      : 'already_queued';
  }
}
