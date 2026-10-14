// SPDX-License-Identifier: EUPL-1.2
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MAINTENANCE_QUEUE } from './maintenance.constants.js';
import { MaintenanceCoreModule } from './maintenance-core.module.js';
import { MaintenanceJobsService } from './maintenance-jobs.service.js';
import { MaintenanceQueue } from './maintenance.queue.js';

/**
 * API process: run history and on-demand runs. MaintenanceController is declared
 * by AdminModule, which provides the admin guard. Needs BullModule.forRoot
 * (IngestionModule).
 */
const maintenanceQueue = BullModule.registerQueue({ name: MAINTENANCE_QUEUE });

@Module({
  imports: [MaintenanceCoreModule, maintenanceQueue],
  providers: [MaintenanceQueue, MaintenanceJobsService],
  exports: [MaintenanceJobsService],
})
export class MaintenanceApiModule {}
