// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Registry } from '@prometheus-io/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  KeycloakIdentityProvider,
  KeycloakIdentityProviderRepresentation,
} from '../../src/identity/keycloak-admin.service.js';
import {
  IDP_CERTIFICATE_CHECK_INTERVAL_MS,
  IdpCertificateMetricsService,
  latestCertificateExpiry,
} from '../../src/identity/metadata-refresh/idp-certificate-metrics.service.js';
import { createMetricsRegistry } from '../../src/metrics/metrics.registry.js';
import { RunMetricsService } from '../../src/metrics/run-metrics.service.js';
import { configStub } from '../support/config-stub.js';
import { createFakeDb } from '../support/fake-kysely.js';
import { createTestCertificate, type TestCertificate } from '../support/x509.js';

const EXPIRY = 'oecp_idp_certificate_expiry_timestamp_seconds';
const CHECKED = 'oecp_idp_certificate_check_last_success_timestamp_seconds';
const at = (iso: string) => new Date(iso);
const unix = (iso: string) => Date.parse(iso) / 1000;

async function samples(registry: Registry, name: string): Promise<string[]> {
  const text = await registry.metrics();
  return text
    .split('\n')
    .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `));
}

let soon: TestCertificate;
let later: TestCertificate;
let expired: TestCertificate;

beforeAll(() => {
  Logger.overrideLogger(false);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  soon = createTestCertificate(
    'idp soon',
    at('2026-01-01T00:00:00Z'),
    at('2026-11-01T12:00:00Z'),
    privateKey,
  );
  later = createTestCertificate(
    'idp later',
    at('2026-06-01T00:00:00Z'),
    at('2028-06-01T12:00:00Z'),
    privateKey,
  );
  expired = createTestCertificate(
    'idp expired',
    at('2024-01-01T00:00:00Z'),
    at('2025-01-01T00:00:00Z'),
    privateKey,
  );
});

describe('latestCertificateExpiry', () => {
  it('parses one base64 DER certificate without PEM armour', () => {
    expect(latestCertificateExpiry(soon.der)).toEqual(at('2026-11-01T12:00:00Z'));
  });

  it('takes the latest notAfter of several comma-separated certificates', () => {
    expect(latestCertificateExpiry(`${later.der},${soon.der}`)).toEqual(at('2028-06-01T12:00:00Z'));
    expect(latestCertificateExpiry(` ${expired.der} , ${soon.der} `)).toEqual(
      at('2026-11-01T12:00:00Z'),
    );
    // An expired certificate alone is reported as such (the alert fires).
    expect(latestCertificateExpiry(expired.der)).toEqual(at('2025-01-01T00:00:00Z'));
  });

  it('skips an unparsable certificate with a warning; none parsable = undefined', () => {
    const warn = vi.fn();
    expect(latestCertificateExpiry(`bm90IGEgY2VydGlmaWNhdGU=,${soon.der}`, warn)).toEqual(
      at('2026-11-01T12:00:00Z'),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^signing certificate 1 of 2 not parsed/);
    expect(latestCertificateExpiry('garbage', warn)).toBeUndefined();
    expect(latestCertificateExpiry('', warn)).toBeUndefined();
    expect(latestCertificateExpiry(undefined, warn)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('IdpCertificateMetricsService', () => {
  class StubKeycloak {
    idps: KeycloakIdentityProviderRepresentation[] = [];
    fail = false;
    readonly listIdentityProviders = vi.fn(async (): Promise<KeycloakIdentityProvider[]> => {
      if (this.fail) throw new Error('Keycloak admin request failed: list identity providers');
      return this.idps.map(({ alias, enabled, providerId }) => ({ alias, enabled, providerId }));
    });
    readonly getIdentityProvider = vi.fn(async (alias: string) =>
      structuredClone(this.idps.find((i) => i.alias === alias)),
    );
  }

  const setup = (enabled = true) => {
    const registry = createMetricsRegistry({ version: '9.9.9', commit: 'abc1234' });
    const metrics = new RunMetricsService(
      registry,
      createFakeDb(() => []).db,
      configStub({ OECP_METRICS_ENABLED: enabled }),
    );
    const keycloak = new StubKeycloak();
    const service = new IdpCertificateMetricsService(keycloak, metrics);
    return { registry, keycloak, service };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports one series per SAML identity provider with its latest expiry', async () => {
    const { registry, keycloak, service } = setup();
    expect(await samples(registry, CHECKED)).toEqual([`${CHECKED} 0`]);
    expect(await samples(registry, EXPIRY)).toEqual([]);

    keycloak.idps = [
      {
        alias: 'urv',
        enabled: true,
        providerId: 'saml',
        config: { signingCertificate: `${soon.der},${later.der}` },
      },
      {
        alias: 'uibk',
        enabled: false,
        providerId: 'saml',
        config: { signingCertificate: soon.der },
      },
      { alias: 'nocert', enabled: true, providerId: 'saml', config: {} },
      { alias: 'broken', enabled: true, providerId: 'saml', config: { signingCertificate: 'x' } },
      { alias: 'google', enabled: true, providerId: 'oidc', config: {} },
    ];
    await expect(service.check()).resolves.toBe(true);
    expect(await samples(registry, EXPIRY)).toEqual([
      `${EXPIRY}{alias="urv",enabled="true"} ${unix('2028-06-01T12:00:00Z')}`,
      `${EXPIRY}{alias="uibk",enabled="false"} ${unix('2026-11-01T12:00:00Z')}`,
    ]);
    expect(keycloak.getIdentityProvider).not.toHaveBeenCalledWith('google');
    const [checked] = await samples(registry, CHECKED);
    expect(Number(checked!.split(' ')[1])).toBeGreaterThan(0);

    // A removed identity provider disappears from the metrics.
    keycloak.idps = keycloak.idps.filter((i) => i.alias !== 'uibk');
    await service.check();
    expect(await samples(registry, EXPIRY)).toEqual([
      `${EXPIRY}{alias="urv",enabled="true"} ${unix('2028-06-01T12:00:00Z')}`,
    ]);
  });

  it('keeps the previous values and the last success when Keycloak fails', async () => {
    const { registry, keycloak, service } = setup();
    keycloak.idps = [
      { alias: 'urv', enabled: true, providerId: 'saml', config: { signingCertificate: soon.der } },
    ];
    await service.check();
    const before = await samples(registry, CHECKED);

    keycloak.fail = true;
    await expect(service.check()).resolves.toBe(false);
    expect(await samples(registry, EXPIRY)).toEqual([
      `${EXPIRY}{alias="urv",enabled="true"} ${unix('2026-11-01T12:00:00Z')}`,
    ]);
    expect(await samples(registry, CHECKED)).toEqual(before);

    // A failure on one alias also keeps everything.
    keycloak.fail = false;
    keycloak.getIdentityProvider.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.check()).resolves.toBe(false);
    expect(await samples(registry, CHECKED)).toEqual(before);
  });

  it('checks at start-up and every hour; nothing when disabled or without metrics', async () => {
    const { keycloak, service } = setup();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(keycloak.listIdentityProviders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDP_CERTIFICATE_CHECK_INTERVAL_MS);
    expect(keycloak.listIdentityProviders).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(IDP_CERTIFICATE_CHECK_INTERVAL_MS);
    expect(keycloak.listIdentityProviders).toHaveBeenCalledTimes(2);

    const disabled = setup(false);
    disabled.service.onApplicationBootstrap();
    await expect(disabled.service.check()).resolves.toBe(false);
    const cli = new IdpCertificateMetricsService(disabled.keycloak);
    cli.onApplicationBootstrap();
    await expect(cli.check()).resolves.toBe(false);
    expect(disabled.keycloak.listIdentityProviders).not.toHaveBeenCalled();
  });
});
