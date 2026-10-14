// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import { IdentityModule } from '../identity.module.js';
import { IdpMetadataRefreshService } from './idp-metadata-refresh.service.js';
import {
  IDP_METADATA_SETTINGS,
  type IdpMetadataSettings,
  idpMetadataSettingsFromEnv,
} from './idp-metadata-refresh.settings.js';
import { IDP_REFRESH_STORE, KyselyIdpRefreshStore } from './idp-refresh.store.js';
import { MetadataAggregateSource } from './metadata-aggregate.source.js';

/**
 * The `idp-metadata-refresh` job without any queue: usable from the CLI, the
 * worker and a generic job runner (`IdpMetadataRefreshService.runOnce()`).
 * Needs the global ConfigModule and DbModule of the host application.
 */
@Module({
  imports: [IdentityModule],
  providers: [
    {
      provide: IDP_METADATA_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): IdpMetadataSettings =>
        idpMetadataSettingsFromEnv((key) => config.get(key, { infer: true })),
    },
    {
      provide: IDP_REFRESH_STORE,
      inject: [KYSELY],
      useFactory: (db: Db) => new KyselyIdpRefreshStore(db),
    },
    {
      provide: MetadataAggregateSource,
      inject: [IDP_METADATA_SETTINGS],
      useFactory: (settings: IdpMetadataSettings) => new MetadataAggregateSource(settings),
    },
    IdpMetadataRefreshService,
  ],
  exports: [IdpMetadataRefreshService, IDP_METADATA_SETTINGS],
})
export class IdpMetadataRefreshModule {}
