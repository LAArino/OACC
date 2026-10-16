// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { CourseImageFetchService } from './course-image-fetch.service.js';
import { MediaCoreModule } from './media-core.module.js';
import { MediaProcessor } from './media.processor.js';
import { MediaQueueModule } from './media-queue.module.js';

/** Worker process only: the `media` queue processor (CSV `image_url` fetches). */
@Module({
  imports: [MediaCoreModule, MediaQueueModule],
  providers: [CourseImageFetchService, MediaProcessor],
})
export class MediaWorkerModule {}
