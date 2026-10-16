// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { MediaCoreModule } from './media-core.module.js';
import { MediaController } from './media.controller.js';

/** API process: the anonymous `/media` route of the course images. */
@Module({
  imports: [MediaCoreModule],
  controllers: [MediaController],
})
export class MediaApiModule {}
