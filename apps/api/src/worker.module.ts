// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { IngestionWorkerModule } from './ingestion/ingestion-worker.module.js';
import { AppLoggerModule } from './logging/logger.module.js';
import { MaintenanceWorkerModule } from './maintenance/maintenance-worker.module.js';
import { MediaWorkerModule } from './media/media-worker.module.js';
import { MetricsModule } from './metrics/metrics.module.js';

/**
 * Worker process: BullMQ processors and schedules (ingestion; maintenance, which
 * includes the IdP metadata refresh; course image fetches). Its only HTTP is the internal `/health`,
 * `/ready` and `/metrics` on WORKER_HEALTH_PORT.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DbModule,
    MetricsModule.forWorker(),
    IngestionWorkerModule,
    MaintenanceWorkerModule,
    MediaWorkerModule,
  ],
})
export class WorkerModule {}
