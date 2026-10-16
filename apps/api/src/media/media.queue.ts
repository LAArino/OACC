// SPDX-License-Identifier: EUPL-1.2
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { type CourseImageFetchJob, courseImageFetchJob } from '@oecp/schemas';
import type { Queue } from 'bullmq';
import { MEDIA_FETCH_JOB, MEDIA_QUEUE, mediaFetchJobId } from './media.constants.js';

/**
 * Producer of the `media` queue (both processes: CSV uploads are processed in the
 * api up to 500 rows and by the worker above): one fetch per course and upload.
 */
@Injectable()
export class MediaQueue {
  constructor(@InjectQueue(MEDIA_QUEUE) private readonly queue: Queue<CourseImageFetchJob>) {}

  async enqueueFetch(job: CourseImageFetchJob): Promise<void> {
    const data = courseImageFetchJob.parse(job);
    await this.queue.add(MEDIA_FETCH_JOB, data, {
      jobId: mediaFetchJobId(data.syncRunId, data.courseId),
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}
