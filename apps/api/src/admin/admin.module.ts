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
import { InvitationsController } from './invitations/invitations.controller.js';
import { InvitationsModule } from './invitations/invitations.module.js';

@Module({
  imports: [InvitationsModule],
  controllers: [AdminController, InvitationsController],
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
  ],
})
export class AdminModule {}
