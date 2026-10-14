// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import type { Env } from '../config/env.js';
import { AdminController } from './admin.controller.js';
import { AdminJwtGuard } from './auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from './auth/admin-token-verifier.js';
import {
  KyselyOrganizationDirectory,
  ORGANIZATION_DIRECTORY,
} from './auth/organization-directory.js';
import { CsvIngestionModule } from '../ingestion/csv/csv-ingestion.module.js';
import { CoursesController } from './courses/courses.controller.js';
import { CoursesRepository } from './courses/courses.repository.js';
import { CoursesService } from './courses/courses.service.js';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { IntegrationsController } from './integrations/integrations.controller.js';
import { IntegrationsService } from './integrations/integrations.service.js';
import { OrganizationAccess } from './integrations/organization-access.js';
import { InvitationsController } from './invitations/invitations.controller.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { CsvUploadInterceptor } from './uploads/csv-upload.interceptor.js';
import { UploadsController } from './uploads/uploads.controller.js';
import { UploadsService } from './uploads/uploads.service.js';

@Module({
  imports: [InvitationsModule, IngestionModule, CsvIngestionModule],
  controllers: [
    AdminController,
    InvitationsController,
    IntegrationsController,
    UploadsController,
    CoursesController,
  ],
  providers: [
    {
      provide: AdminTokenVerifier,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new AdminTokenVerifier({
          issuer: config.get('KEYCLOAK_ISSUER', { infer: true }),
          getKey: createRemoteJWKSet(new URL(config.get('KEYCLOAK_JWKS_URL', { infer: true }))),
        }),
    },
    { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
    AdminJwtGuard,
    OrganizationAccess,
    IntegrationsService,
    UploadsService,
    CsvUploadInterceptor,
    CoursesRepository,
    CoursesService,
  ],
})
export class AdminModule {}
