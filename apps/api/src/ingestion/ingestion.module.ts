// SPDX-License-Identifier: EUPL-1.2
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { HARVEST_QUEUE } from './harvest.constants.js';
import { HarvestQueue } from './harvest.queue.js';
import { valkeyConnection } from './valkey-connection.js';

/** Queue registration and producers; imported by both processes. No workers here. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: valkeyConnection(config.get('VALKEY_URL', { infer: true })),
      }),
    }),
    BullModule.registerQueue({ name: HARVEST_QUEUE }),
  ],
  providers: [HarvestQueue],
  exports: [BullModule, HarvestQueue],
})
export class IngestionModule {}
