// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { HarvestScheduleProcessor } from './harvest-schedule.processor.js';
import { HarvestProcessor } from './harvest.processor.js';
import { HarvestScheduler } from './harvest.scheduler.js';
import { HarvestService } from './harvest.service.js';
import { IngestionModule } from './ingestion.module.js';

/** BullMQ processors and the harvest scheduler; imported only by the worker process. */
@Module({
  imports: [IngestionModule],
  providers: [HarvestService, HarvestProcessor, HarvestScheduleProcessor, HarvestScheduler],
})
export class IngestionWorkerModule {}
