// SPDX-License-Identifier: EUPL-1.2
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { IdentityModule } from '../identity/identity.module.js';
import { IdpMetadataRefreshModule } from '../identity/metadata-refresh/idp-metadata-refresh.module.js';
import { CsvWorkerModule } from '../ingestion/csv/csv-worker.module.js';
import { MediaCoreModule } from '../media/media-core.module.js';
import { AccountCleanupService } from './account-cleanup.service.js';
import { DormancyService } from './dormancy.service.js';
import { HistoryPartitionsService } from './history-partitions.service.js';
import { MAINTENANCE_QUEUE } from './maintenance.constants.js';
import { MaintenanceCoreModule } from './maintenance-core.module.js';
import { MaintenanceProcessor } from './maintenance.processor.js';
import { MaintenanceQueue } from './maintenance.queue.js';
import { MaintenanceScheduler } from './maintenance.scheduler.js';
import { RetentionService } from './retention.service.js';
import { WorkerHealthServer } from './worker-health.server.js';

/**
 * Worker process only: the maintenance jobs (history partitions, retention,
 * dormancy, account cleanup, upload retention, IdP metadata refresh; spec §2.2,
 * §4, §5.4, §10), their daily schedules and start-up runs, and the worker's
 * `/health` and `/ready` endpoints. Needs BullModule.forRoot (IngestionModule).
 */
@Module({
  imports: [
    DiscoveryModule,
    IdentityModule,
    CsvWorkerModule,
    IdpMetadataRefreshModule,
    MaintenanceCoreModule,
    // Retention deletes the image directory of every course it hard-deletes.
    MediaCoreModule,
    BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
  ],
  providers: [
    MaintenanceQueue,
    HistoryPartitionsService,
    RetentionService,
    DormancyService,
    AccountCleanupService,
    MaintenanceProcessor,
    MaintenanceScheduler,
    WorkerHealthServer,
  ],
})
export class MaintenanceWorkerModule {}
