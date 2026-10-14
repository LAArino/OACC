// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { CsvIngestionModule } from './csv-ingestion.module.js';
import { CsvRetentionScheduler } from './csv-retention.scheduler.js';
import { CsvRetentionService } from './csv-retention.service.js';
import { CsvProcessor } from './csv.processor.js';

/** Channel B processors (worker process only). */
@Module({
  imports: [CsvIngestionModule],
  providers: [CsvProcessor, CsvRetentionService, CsvRetentionScheduler],
})
export class CsvWorkerModule {}
