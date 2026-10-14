// SPDX-License-Identifier: EUPL-1.2
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  CSV_PROCESS_JOB,
  CSV_QUEUE,
  type CsvJobData,
  csvJobData,
  csvJobId,
} from './csv.constants.js';

/** Producer of Channel B jobs (API process): uploads above the inline threshold. */
@Injectable()
export class CsvQueue {
  constructor(@InjectQueue(CSV_QUEUE) private readonly queue: Queue<CsvJobData>) {}

  /** Job `csv-{syncRunId}`; the run must be `queued`. */
  async enqueue(syncRunId: string): Promise<void> {
    const data = csvJobData.parse({ syncRunId });
    await this.queue.add(CSV_PROCESS_JOB, data, {
      jobId: csvJobId(syncRunId),
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}
