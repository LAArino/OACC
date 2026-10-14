// SPDX-License-Identifier: EUPL-1.2
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { SecretsModule } from '../secrets/secrets.module.js';
import { CanonicalWriter } from './canonical-writer.service.js';
import { HARVEST_QUEUE, HARVEST_SCHEDULE_QUEUE } from './harvest.constants.js';
import { HarvestQueue } from './harvest.queue.js';
import { OeapiClientFactory } from './oeapi/oeapi-client.factory.js';
import { OeapiV5Adapter } from './oeapi/oeapi-v5.adapter.js';
import { SyncRunsRepository } from './sync-runs.repository.js';
import { valkeyConnection } from './valkey-connection.js';

/**
 * Queue registration, producers and the Channel A building blocks shared by both
 * processes (the API uses them for "Test connection" and "Sync now"). No workers here.
 */
@Module({
  imports: [
    SecretsModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: valkeyConnection(config.get('VALKEY_URL', { infer: true })),
      }),
    }),
    BullModule.registerQueue({ name: HARVEST_QUEUE }, { name: HARVEST_SCHEDULE_QUEUE }),
  ],
  providers: [
    HarvestQueue,
    OeapiClientFactory,
    OeapiV5Adapter,
    CanonicalWriter,
    SyncRunsRepository,
  ],
  exports: [
    BullModule,
    SecretsModule,
    HarvestQueue,
    OeapiClientFactory,
    OeapiV5Adapter,
    CanonicalWriter,
    SyncRunsRepository,
  ],
})
export class IngestionModule {}
