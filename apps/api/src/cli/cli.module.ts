// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { InvitationsModule } from '../admin/invitations/invitations.module.js';
import { AppConfigModule } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DbModule } from '../db/db.module.js';
import { MediaCoreModule } from '../media/media-core.module.js';
import { IdpMetadataRefreshModule } from '../identity/metadata-refresh/idp-metadata-refresh.module.js';
import { SecretsModule } from '../secrets/secrets.module.js';
import { BootstrapAllianceAdminCommand } from './bootstrap-alliance-admin.js';
import { IdpMetadataRefreshCommand } from './idp-metadata-refresh.js';
import { ImportCourseImagesCommand } from './import-course-images.js';
import { SeedAttributeDefinitionsCommand } from './seed-attribute-definitions.js';
import { SeedOrganizationsCommand } from './seed-organizations.js';
import { StoreSecretCommand } from './store-secret.js';

/** Logs go to stderr so that stdout carries only command output. */
const CliLoggerModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    pinoHttp: [
      { level: config.get('LOG_LEVEL', { infer: true }) },
      pino.destination({ dest: 2, sync: true }),
    ],
  }),
});

/** Application context of the `oecp` CLI: no HTTP server, no queues. */
@Module({
  imports: [
    AppConfigModule,
    CliLoggerModule,
    DbModule,
    InvitationsModule,
    SecretsModule,
    IdpMetadataRefreshModule,
    MediaCoreModule,
  ],
  providers: [
    SeedOrganizationsCommand,
    SeedAttributeDefinitionsCommand,
    ImportCourseImagesCommand,
    BootstrapAllianceAdminCommand,
    StoreSecretCommand,
    IdpMetadataRefreshCommand,
  ],
})
export class CliModule {}
