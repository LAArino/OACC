// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { MAINTENANCE_OPTIONS, maintenanceOptions } from './maintenance.constants.js';
import { MaintenanceRunner } from './maintenance-runner.js';
import { MaintenanceRunsRepository } from './maintenance-runs.repository.js';

/** Settings and `maintenance_runs` bookkeeping, shared by the API and the worker. */
@Module({
  providers: [
    {
      provide: MAINTENANCE_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        maintenanceOptions({
          OECP_RETENTION_HISTORY_MONTHS: config.get('OECP_RETENTION_HISTORY_MONTHS', {
            infer: true,
          }),
          OECP_RETENTION_SYNC_ERRORS_MONTHS: config.get('OECP_RETENTION_SYNC_ERRORS_MONTHS', {
            infer: true,
          }),
          OECP_RETENTION_SYNC_RUNS_MONTHS: config.get('OECP_RETENTION_SYNC_RUNS_MONTHS', {
            infer: true,
          }),
          OECP_RETENTION_AUDIT_MONTHS: config.get('OECP_RETENTION_AUDIT_MONTHS', { infer: true }),
          OECP_DORMANCY_DAYS: config.get('OECP_DORMANCY_DAYS', { infer: true }),
          OECP_DORMANCY_DRY_RUN: config.get('OECP_DORMANCY_DRY_RUN', { infer: true }),
        }),
    },
    MaintenanceRunsRepository,
    MaintenanceRunner,
  ],
  exports: [MAINTENANCE_OPTIONS, MaintenanceRunsRepository, MaintenanceRunner],
})
export class MaintenanceCoreModule {}
