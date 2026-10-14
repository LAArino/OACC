// SPDX-License-Identifier: EUPL-1.2
// OECP_PUBLISH_RULE (decision 21c): configuration and injection into the writer.
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';
import { KYSELY } from '../../src/db/db.module.js';
import { CanonicalWriter, PUBLISH_RULE } from '../../src/ingestion/canonical-writer.service.js';
import { publishRuleProvider } from '../../src/ingestion/publish-rule.provider.js';

const base = {
  DATABASE_URL: 'postgres://oecp@postgres/oecp',
  VALKEY_URL: 'redis://valkey:6379',
  KEYCLOAK_ISSUER: 'https://auth.example.org/realms/oecp',
  KEYCLOAK_JWKS_URL: 'https://auth.example.org/realms/oecp/protocol/openid-connect/certs',
  OECP_MASTER_KEY_FILE: '/run/secrets/oecp_master_key',
  OECP_PUBLIC_BASE_URL: 'https://campus.example.org',
  KEYCLOAK_ADMIN_URL: 'http://keycloak:8080',
  KEYCLOAK_ADMIN_CLIENT_SECRET_FILE: '/run/secrets/oecp_backend_client_secret',
};

describe('OECP_PUBLISH_RULE', () => {
  it('defaults to warn and accepts enforce', () => {
    expect(validateEnv(base).OECP_PUBLISH_RULE).toBe('warn');
    expect(validateEnv({ ...base, OECP_PUBLISH_RULE: 'enforce' }).OECP_PUBLISH_RULE).toBe(
      'enforce',
    );
  });

  it('refuses other values at start-up', () => {
    expect(() => validateEnv({ ...base, OECP_PUBLISH_RULE: 'block' })).toThrow(/OECP_PUBLISH_RULE/);
  });

  it.each(['warn', 'enforce'] as const)('reaches the writer (%s)', async (mode) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: KYSELY, useValue: {} },
        {
          provide: ConfigService,
          useValue: new ConfigService(validateEnv({ ...base, OECP_PUBLISH_RULE: mode })),
        },
        publishRuleProvider,
        CanonicalWriter,
      ],
    }).compile();
    expect(moduleRef.get(PUBLISH_RULE)).toBe(mode);
    expect(moduleRef.get(CanonicalWriter).publishRule).toBe(mode);
  });

  it('is warn when nothing provides it (tests, tools)', () => {
    expect(new CanonicalWriter({} as never).publishRule).toBe('warn');
  });
});
