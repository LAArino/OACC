// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { CourseImageService } from './course-image.service.js';
import { CourseMediaStorage } from './course-media.storage.js';

/** Course image files and columns (decision 27), shared by the api and the worker. */
@Module({
  providers: [CourseMediaStorage, CourseImageService],
  exports: [CourseMediaStorage, CourseImageService],
})
export class MediaCoreModule {}
