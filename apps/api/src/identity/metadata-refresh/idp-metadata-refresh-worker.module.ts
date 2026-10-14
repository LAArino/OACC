// SPDX-License-Identifier: EUPL-1.2
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IDP_METADATA_REFRESH_QUEUE } from './idp-metadata-refresh.constants.js';
import { IdpMetadataRefreshModule } from './idp-metadata-refresh.module.js';
import {
  IdpMetadataRefreshProcessor,
  IdpMetadataRefreshScheduler,
} from './idp-metadata-refresh.processor.js';

const queue = BullModule.registerQueue({ name: IDP_METADATA_REFRESH_QUEUE });

/**
 * Worker side: queue `idp-metadata-refresh`, its processor, the daily job
 * scheduler and the start-up run. Needs BullModule.forRoot (registered globally
 * by IngestionModule in the worker process).
 */
@Module({
  imports: [IdpMetadataRefreshModule, queue],
  providers: [IdpMetadataRefreshProcessor, IdpMetadataRefreshScheduler],
  exports: [IdpMetadataRefreshModule, queue],
})
export class IdpMetadataRefreshWorkerModule {}
