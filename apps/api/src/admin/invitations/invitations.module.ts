// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { IdentityModule, readSecretFile } from '../../identity/identity.module.js';
import {
  INVITATIONS_OPTIONS,
  type InvitationsOptions,
  InvitationsService,
} from './invitations.service.js';
import { createMailer, MAILER } from './mailer.js';

/** Invitation logic without HTTP; shared by the API (AdminModule) and the CLI. */
@Module({
  imports: [IdentityModule],
  providers: [
    InvitationsService,
    {
      provide: INVITATIONS_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): InvitationsOptions => ({
        publicBaseUrl: config.get('OECP_PUBLIC_BASE_URL', { infer: true }),
      }),
    },
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const passwordFile = config.get('SMTP_PASSWORD_FILE', { infer: true });
        return createMailer({
          host: config.get('SMTP_HOST', { infer: true }),
          port: config.get('SMTP_PORT', { infer: true }),
          from: config.get('SMTP_FROM', { infer: true }),
          user: config.get('SMTP_USER', { infer: true }) || undefined,
          // Read at start-up: a missing secret file stops the process.
          password: passwordFile ? readSecretFile(passwordFile) : undefined,
          requireStartTls: config.get('SMTP_STARTTLS', { infer: true }),
        });
      },
    },
  ],
  exports: [InvitationsService, INVITATIONS_OPTIONS, IdentityModule],
})
export class InvitationsModule {}
