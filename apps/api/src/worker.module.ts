// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { IngestionWorkerModule } from './ingestion/ingestion-worker.module.js';
import { AppLoggerModule } from './logging/logger.module.js';
import { IdpMetadataRefreshWorkerModule } from './identity/metadata-refresh/idp-metadata-refresh-worker.module.js';
import { MaintenanceWorkerModule } from './maintenance/maintenance-worker.module.js';

/**
 * Worker process: BullMQ processors and schedules (ingestion, maintenance). Its
 * only HTTP is the internal `/health` and `/ready` on WORKER_HEALTH_PORT.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DbModule,
    IngestionWorkerModule,
    MaintenanceWorkerModule,
    IdpMetadataRefreshWorkerModule,
  ],
})
export class WorkerModule {}
