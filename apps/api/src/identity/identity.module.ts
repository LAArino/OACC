// SPDX-License-Identifier: EUPL-1.2
import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { IDENTITY_PROVIDER_ALIASES, IdentityProviderAliases } from './identity-provider-aliases.js';
import { KeycloakAdminService } from './keycloak-admin.service.js';

/** Reads a Docker secret file (trimmed); throws if it is missing or empty. */
export function readSecretFile(path: string): string {
  const value = readFileSync(path, 'utf8').trim();
  if (!value) throw new Error(`Secret file ${path} is empty`);
  return value;
}

/** Keycloak Admin API access for the confidential client `oecp-backend` (spec §3). */
@Module({
  providers: [
    {
      provide: KeycloakAdminService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const secretFile = config.get('KEYCLOAK_ADMIN_CLIENT_SECRET_FILE', { infer: true });
        let secret: string | undefined;
        return new KeycloakAdminService({
          baseUrl: config.get('KEYCLOAK_ADMIN_URL', { infer: true }),
          realm: config.get('KEYCLOAK_REALM', { infer: true }),
          clientId: config.get('KEYCLOAK_ADMIN_CLIENT_ID', { infer: true }),
          clientSecret: () => (secret ??= readSecretFile(secretFile)),
        });
      },
    },
    {
      provide: IDENTITY_PROVIDER_ALIASES,
      inject: [KeycloakAdminService],
      useFactory: (keycloak: KeycloakAdminService) => new IdentityProviderAliases(keycloak),
    },
  ],
  exports: [KeycloakAdminService, IDENTITY_PROVIDER_ALIASES],
})
export class IdentityModule {}
