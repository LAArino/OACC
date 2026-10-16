// SPDX-License-Identifier: EUPL-1.2
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MEDIA_QUEUE } from './media.constants.js';
import { MediaQueue } from './media.queue.js';

/** The `media` queue and its producer; needs BullModule.forRoot (IngestionModule). */
const mediaQueue = BullModule.registerQueue({ name: MEDIA_QUEUE });

@Module({
  imports: [mediaQueue],
  providers: [MediaQueue],
  exports: [mediaQueue, MediaQueue],
})
export class MediaQueueModule {}
