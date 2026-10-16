// SPDX-License-Identifier: EUPL-1.2
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MediaQueueModule } from '../../media/media-queue.module.js';
import { IngestionModule } from '../ingestion.module.js';
import { CsvIngestionService } from './csv-ingestion.service.js';
import { CsvAdapter } from './csv.adapter.js';
import { CSV_QUEUE } from './csv.constants.js';
import { CsvQueue } from './csv.queue.js';
import { UploadStorage } from './upload-storage.js';

/** Channel B building blocks shared by the API (uploads ≤ 500 rows inline) and the worker. */
const csvQueue = BullModule.registerQueue({ name: CSV_QUEUE });

@Module({
  // MediaQueueModule: CSV `image_url` fetches are queued after a successful run.
  imports: [IngestionModule, csvQueue, MediaQueueModule],
  providers: [CsvAdapter, CsvIngestionService, CsvQueue, UploadStorage],
  exports: [csvQueue, CsvAdapter, CsvIngestionService, CsvQueue, UploadStorage, IngestionModule],
})
export class CsvIngestionModule {}
