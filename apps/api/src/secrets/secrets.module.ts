// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import {
  CURRENT_KEY_VERSION,
  readMasterKeyFile,
  SECRETS_OPTIONS,
  type SecretsOptions,
  SecretsService,
} from './secrets.service.js';

/** `secrets` table encryption with the master key Docker secret (spec §10 Security). */
@Module({
  providers: [
    SecretsService,
    {
      provide: SECRETS_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SecretsOptions => {
        const file = config.get('OECP_MASTER_KEY_FILE', { infer: true });
        let keys: Map<number, Buffer> | undefined;
        return {
          masterKeys: () => (keys ??= new Map([[CURRENT_KEY_VERSION, readMasterKeyFile(file)]])),
        };
      },
    },
  ],
  exports: [SecretsService],
})
export class SecretsModule {}
