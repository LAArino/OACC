// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { IngestionWorkerModule } from './ingestion/ingestion-worker.module.js';
import { AppLoggerModule } from './logging/logger.module.js';

/** Worker process: BullMQ processors and schedules, no HTTP. */
@Module({
  imports: [AppConfigModule, AppLoggerModule, DbModule, IngestionWorkerModule],
})
export class WorkerModule {}
