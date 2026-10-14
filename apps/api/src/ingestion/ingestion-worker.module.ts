// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { HarvestProcessor } from './harvest.processor.js';
import { IngestionModule } from './ingestion.module.js';

/** BullMQ processors; imported only by the worker process. */
@Module({
  imports: [IngestionModule],
  providers: [HarvestProcessor],
})
export class IngestionWorkerModule {}
