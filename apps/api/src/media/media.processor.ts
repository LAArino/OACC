// SPDX-License-Identifier: EUPL-1.2
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { courseImageFetchJob } from '@oecp/schemas';
import type { Job } from 'bullmq';
import { CourseImageFetchService } from './course-image-fetch.service.js';
import { MEDIA_FETCH_JOB, MEDIA_QUEUE } from './media.constants.js';

/** Worker side of the `media` queue: CSV `image_url` fetches, two at a time. */
@Processor(MEDIA_QUEUE, { concurrency: 2, lockDuration: 120_000 })
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(private readonly fetches: CourseImageFetchService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== MEDIA_FETCH_JOB) {
      this.logger.warn(`Unknown job ${job.name} on queue ${MEDIA_QUEUE}`);
      return null;
    }
    const data = courseImageFetchJob.parse(job.data);
    return { courseId: data.courseId, outcome: await this.fetches.run(data) };
  }
}
