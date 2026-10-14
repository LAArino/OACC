// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

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

describe('Channel A environment', () => {
  it('defaults to the SURFeduhub gateway, no gateway credential and secure partner HTTP', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      SURFEDUHUB_GATEWAY_URL: 'https://gateway.surfeduhub.nl',
      OECP_ALLOW_INSECURE_PARTNER_HTTP: false,
    });
    expect(env.SURFEDUHUB_SECRET_REF).toBeUndefined();
  });

  it('parses the development switch and a gateway credential reference', () => {
    const env = validateEnv({
      ...base,
      OECP_ALLOW_INSECURE_PARTNER_HTTP: 'true',
      SURFEDUHUB_SECRET_REF: 'db:75838ff7-abf1-48d1-afa2-ca124f663d8b',
      SURFEDUHUB_GATEWAY_URL: 'https://gateway.test.surfeduhub.nl/',
    });
    expect(env.OECP_ALLOW_INSECURE_PARTNER_HTTP).toBe(true);
    expect(env.SURFEDUHUB_SECRET_REF).toBe('db:75838ff7-abf1-48d1-afa2-ca124f663d8b');
    expect(env.SURFEDUHUB_GATEWAY_URL).toBe('https://gateway.test.surfeduhub.nl');
    expect(
      validateEnv({ ...base, SURFEDUHUB_SECRET_REF: '' }).SURFEDUHUB_SECRET_REF,
    ).toBeUndefined();
  });

  it('refuses invalid values', () => {
    expect(() => validateEnv({ ...base, OECP_ALLOW_INSECURE_PARTNER_HTTP: 'yes' })).toThrow();
    expect(() => validateEnv({ ...base, SURFEDUHUB_SECRET_REF: 'plaintext' })).toThrow();
    expect(() => validateEnv({ ...base, SURFEDUHUB_GATEWAY_URL: 'http://gateway' })).toThrow();
  });
});

describe('idp-metadata-refresh environment', () => {
  it('is off by default with safe defaults', () => {
    const env = validateEnv(base);
    expect(env.OECP_IDP_METADATA_URL).toBeUndefined();
    expect(env).toMatchObject({
      OECP_IDP_METADATA_REQUIRE_VALID_UNTIL: true,
      OECP_IDP_METADATA_CACHE_DIR: '/data/idp-metadata',
      OECP_IDP_METADATA_MAX_BYTES: 150 * 1024 * 1024,
      OECP_IDP_METADATA_INCLUDE_DISABLED: false,
      OECP_IDP_METADATA_REFRESH_ON_START: true,
    });
    expect(
      validateEnv({ ...base, OECP_IDP_METADATA_URL: '' }).OECP_IDP_METADATA_URL,
    ).toBeUndefined();
  });

  it('requires an HTTPS URL and the pinned certificate with it', () => {
    const url = 'https://mds.edugain.org/edugain-v2.xml';
    expect(() => validateEnv({ ...base, OECP_IDP_METADATA_URL: url })).toThrow(
      /OECP_IDP_METADATA_SIGNING_CERT_FILE/,
    );
    expect(() =>
      validateEnv({
        ...base,
        OECP_IDP_METADATA_URL: 'http://mds.edugain.org/edugain-v2.xml',
        OECP_IDP_METADATA_SIGNING_CERT_FILE: '/run/secrets/edugain.pem',
      }),
    ).toThrow();
    const env = validateEnv({
      ...base,
      OECP_IDP_METADATA_URL: url,
      OECP_IDP_METADATA_SIGNING_CERT_FILE: '/etc/oecp/edugain-signer.pem',
      OECP_IDP_METADATA_REQUIRE_VALID_UNTIL: 'false',
    });
    expect(env).toMatchObject({
      OECP_IDP_METADATA_URL: url,
      OECP_IDP_METADATA_REQUIRE_VALID_UNTIL: false,
    });
  });
});
