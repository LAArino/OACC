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

describe('mail environment', () => {
  it('refuses production without SMTP_HOST unless OECP_MAIL_LOG_LINKS=true', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /OECP_MAIL_LOG_LINKS=true[\s\S]*SMTP_HOST/,
    );
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', OECP_MAIL_LOG_LINKS: 'true' }),
    ).toMatchObject({ SMTP_HOST: '', OECP_MAIL_LOG_LINKS: true });
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', SMTP_HOST: 'smtp.urv.cat' }),
    ).toMatchObject({ SMTP_HOST: 'smtp.urv.cat', SMTP_STARTTLS: true, SMTP_USER: '' });
    // Outside production the link is only logged (debug level).
    expect(validateEnv({ ...base, NODE_ENV: 'development' }).SMTP_HOST).toBe('');
  });

  it('takes SMTP authentication as user and password file together, and STARTTLS', () => {
    const env = validateEnv({
      ...base,
      SMTP_HOST: 'smtp.urv.cat',
      SMTP_PORT: '587',
      SMTP_USER: 'oecp',
      SMTP_PASSWORD_FILE: '/run/secrets/smtp_password',
      SMTP_STARTTLS: 'true',
    });
    expect(env).toMatchObject({ SMTP_USER: 'oecp', SMTP_STARTTLS: true, SMTP_PORT: 587 });
    expect(validateEnv({ ...base, SMTP_STARTTLS: 'false' }).SMTP_STARTTLS).toBe(false);
    expect(() => validateEnv({ ...base, SMTP_USER: 'oecp' })).toThrow(/SMTP_PASSWORD_FILE/);
    expect(() => validateEnv({ ...base, SMTP_PASSWORD_FILE: '/run/secrets/x' })).toThrow(
      /SMTP_USER/,
    );
  });
});

describe('maintenance and logging environment', () => {
  it('defaults: account cleanup in dry run after 12 months, soft deletes purged after 12, no addresses logged', () => {
    expect(validateEnv(base)).toMatchObject({
      OECP_ACCOUNT_DELETE_MONTHS: 12,
      OECP_ACCOUNT_CLEANUP_DRY_RUN: true,
      OECP_RETENTION_SOFT_DELETED_MONTHS: 12,
      OECP_LOG_CLIENT_ADDRESSES: false,
    });
  });

  it('keeps the account deletion period within the audit retention (the evidence)', () => {
    expect(() => validateEnv({ ...base, OECP_ACCOUNT_DELETE_MONTHS: '48' })).toThrow(
      /OECP_RETENTION_AUDIT_MONTHS/,
    );
    expect(
      validateEnv({
        ...base,
        OECP_ACCOUNT_DELETE_MONTHS: '48',
        OECP_RETENTION_AUDIT_MONTHS: '60',
        OECP_ACCOUNT_CLEANUP_DRY_RUN: 'false',
      }),
    ).toMatchObject({ OECP_ACCOUNT_DELETE_MONTHS: 48, OECP_ACCOUNT_CLEANUP_DRY_RUN: false });
  });
});
