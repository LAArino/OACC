// SPDX-License-Identifier: EUPL-1.2
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatOutcome } from '../../src/cli/idp-metadata-refresh.js';
import type { KeycloakIdentityProviderRepresentation } from '../../src/identity/keycloak-admin.service.js';
import {
  IDP_METADATA_REFRESH_CRON,
  IDP_METADATA_REFRESH_JOB,
  STARTUP_CACHE_REUSE_MS,
} from '../../src/identity/metadata-refresh/idp-metadata-refresh.constants.js';
import {
  IdpMetadataRefreshService,
  type IdpRefreshResult,
  outcomeFailed,
} from '../../src/identity/metadata-refresh/idp-metadata-refresh.service.js';
import type { IdpMetadataSettings } from '../../src/identity/metadata-refresh/idp-metadata-refresh.settings.js';
import type {
  IdpRefreshStore,
  PartnerIdp,
} from '../../src/identity/metadata-refresh/idp-refresh.store.js';
import { MetadataAggregateSource } from '../../src/identity/metadata-refresh/metadata-aggregate.source.js';
import {
  MAINTENANCE_SCHEDULES,
  ON_DEMAND_JOBS,
} from '../../src/maintenance/maintenance.constants.js';
import { MaintenanceProcessor } from '../../src/maintenance/maintenance.processor.js';
import {
  type JobOutcome,
  MaintenanceJobError,
  type MaintenanceRunner,
} from '../../src/maintenance/maintenance-runner.js';
import type { RunMetricsService } from '../../src/metrics/run-metrics.service.js';
import { FakeKeycloakIdps } from '../support/fake-keycloak-idps.js';
import { aggregateXml, type FixtureEntity, signXml } from '../support/saml-aggregate.js';
import { createTestCertificate, daysFromNow, type TestCertificate } from '../support/x509.js';

const AGGREGATE_URL = 'https://mds.federation.test/aggregate.xml';
const ORG = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

let dir: string;
let federation: TestCertificate;
let oldCert: TestCertificate;
let newCert: TestCertificate;
let expired: TestCertificate;
let signedAggregate: string;

const entity = (id: string, patch: Partial<FixtureEntity> = {}): FixtureEntity => ({
  entityId: `https://${id}.test/idp`,
  signing: [{ der: newCert.der, use: 'signing' }],
  sso: { post: `https://${id}.test/sso/post`, redirect: `https://${id}.test/sso/redirect` },
  slo: { post: `https://${id}.test/slo/post` },
  ...patch,
});

/** Keycloak representation as imported from realm-oecp.yaml, plus runtime members. */
const idpRep = (
  alias: string,
  config: Record<string, string>,
  patch: Partial<KeycloakIdentityProviderRepresentation> = {},
): KeycloakIdentityProviderRepresentation => ({
  alias,
  internalId: `internal-${alias}`,
  providerId: 'saml',
  enabled: true,
  displayName: `${alias} University`,
  hideOnLogin: true,
  trustEmail: true,
  firstBrokerLoginFlowAlias: 'oecp-first-broker-login',
  postBrokerLoginFlowAlias: 'oecp-post-broker-mfa',
  config: {
    syncMode: 'FORCE',
    entityId: 'https://auth.oecp.test/realms/oecp',
    idpEntityId: `https://${alias}.test/idp`,
    principalType: 'ATTRIBUTE',
    principalAttribute: 'urn:oasis:names:tc:SAML:attribute:subject-id',
    nameIDPolicyFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
    validateSignature: 'true',
    wantAssertionsSigned: 'true',
    wantAssertionsEncrypted: 'true',
    postBindingResponse: 'true',
    postBindingAuthnRequest: 'true',
    postBindingLogout: 'true',
    ...config,
  },
  ...patch,
});

class MemoryStore implements IdpRefreshStore {
  readonly audits: { organizationId: string; changes: Record<string, unknown> }[] = [];
  constructor(readonly partners: PartnerIdp[]) {}
  async partnerIdps() {
    return this.partners;
  }
  async auditUpdate(organizationId: string, changes: Record<string, unknown>) {
    this.audits.push({ organizationId, changes });
  }
}

const settings = (patch: Partial<IdpMetadataSettings> = {}): IdpMetadataSettings => ({
  url: AGGREGATE_URL,
  signingCertFile: join(dir, 'federation.pem'),
  requireValidUntil: true,
  cacheDir: mkdtempSync(join(dir, 'cache-')),
  maxBytes: 1024 * 1024,
  includeDisabled: false,
  refreshOnStart: false,
  ...patch,
});

/** fetch double for the aggregate URL. */
function aggregateFetch(respond: () => Response | Promise<Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    expect(String(input)).toBe(AGGREGATE_URL);
    return respond();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

let keycloak: FakeKeycloakIdps;
let store: MemoryStore;

function service(
  s: IdpMetadataSettings,
  fetchImpl: typeof fetch,
  metrics?: Pick<RunMetricsService, 'idpRefreshSucceeded'>,
  certificates?: { check: () => Promise<boolean> },
) {
  return new IdpMetadataRefreshService(
    s,
    store,
    keycloak.service(),
    new MetadataAggregateSource(s, fetchImpl),
    undefined,
    metrics as RunMetricsService | undefined,
    certificates,
  );
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'oecp-idp-refresh-'));
  federation = createTestCertificate('Federation signer', daysFromNow(-30), daysFromNow(3650));
  oldCert = createTestCertificate('old', daysFromNow(-400), daysFromNow(20));
  newCert = createTestCertificate('new', daysFromNow(-10), daysFromNow(700));
  expired = createTestCertificate('expired', daysFromNow(-800), daysFromNow(-1));
  writeFileSync(join(dir, 'federation.pem'), federation.pem);
  signedAggregate = signXml(
    aggregateXml([
      entity('alpha'),
      entity('beta', { signing: [{ der: expired.der }] }),
      entity('gamma'),
      entity('delta'),
      entity('same'),
    ]),
    federation,
  );
}, 60_000);

beforeEach(() => {
  keycloak = new FakeKeycloakIdps();
  // alpha: outdated certificate, SSO URL and no SLO: three keys to update.
  keycloak.add(
    idpRep('alpha', {
      signingCertificate: oldCert.der,
      singleSignOnServiceUrl: 'https://alpha.test/old-sso',
    }),
  );
  // beta: the aggregate holds only an expired certificate: failed, config kept.
  keycloak.add(idpRep('beta', { signingCertificate: oldCert.der, singleSignOnServiceUrl: 'x' }));
  // gamma: disabled, skipped.
  keycloak.add(idpRep('gamma', {}, { enabled: false }));
  // delta: no idpEntityId, skipped.
  keycloak.add(idpRep('delta', { idpEntityId: '' }));
  // epsilon: entity not in the aggregate, failed.
  keycloak.add(idpRep('epsilon', {}));
  // same: already up to date.
  keycloak.add(
    idpRep('same', {
      signingCertificate: newCert.der,
      singleSignOnServiceUrl: 'https://same.test/sso/post',
      singleLogoutServiceUrl: 'https://same.test/slo/post',
    }),
  );
  store = new MemoryStore(
    ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'same', 'missing'].map((alias, i) => ({
      organizationId: ORG(i),
      slug: alias,
      alias,
    })),
  );
});

const okFetch = () => aggregateFetch(() => new Response(signedAggregate, { status: 200 }));
const byAlias = (results: IdpRefreshResult[]): Record<string, IdpRefreshResult> =>
  Object.fromEntries(results.map((r) => [r.alias, r]));

describe('idp-metadata-refresh against a fake Keycloak', () => {
  it('PUTs only changed metadata keys and preserves everything else', async () => {
    const before = structuredClone(keycloak.idps.get('alpha')!);
    const outcome = await service(settings(), okFetch()).runOnce();
    const r = byAlias(outcome.results);

    expect(r.alpha).toMatchObject({
      status: 'updated',
      changes: ['signingCertificate', 'singleSignOnServiceUrl', 'singleLogoutServiceUrl'],
    });
    expect(r.beta).toMatchObject({
      status: 'failed',
      error: 'Metadata has no currently valid signing certificate',
    });
    expect(r.gamma).toMatchObject({ status: 'skipped', error: expect.stringMatching(/disabled/) });
    expect(r.delta).toMatchObject({ status: 'skipped', error: 'idpEntityId is not configured' });
    expect(r.epsilon).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/not found in the aggregate/),
    });
    expect(r.same).toMatchObject({ status: 'unchanged', changes: [] });
    expect(r.missing).toMatchObject({
      status: 'skipped',
      error: 'identity provider not found in Keycloak',
    });
    expect(outcomeFailed(outcome)).toBe(true);
    expect(outcome.aggregate).toMatchObject({ kind: 'url', verified: true, entityCount: 5 });

    // Exactly one write, for alpha; the rest of the representation is untouched.
    const puts = keycloak.puts();
    expect(puts.map((p) => p.path)).toEqual([
      '/admin/realms/oecp/identity-provider/instances/alpha',
    ]);
    const after = keycloak.idps.get('alpha')!;
    const { config: beforeConfig, ...beforeTop } = before;
    const { config: afterConfig, ...afterTop } = after;
    expect(afterTop).toEqual(beforeTop);
    expect(afterConfig).toEqual({
      ...beforeConfig,
      signingCertificate: newCert.der,
      singleSignOnServiceUrl: 'https://alpha.test/sso/post',
      singleLogoutServiceUrl: 'https://alpha.test/slo/post',
    });
    expect(keycloak.idps.get('beta')!.config!.signingCertificate).toBe(oldCert.der);

    // One audit row, for alpha, without certificate bodies.
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      organizationId: ORG(0),
      changes: {
        alias: 'alpha',
        idp_entity_id: 'https://alpha.test/idp',
        keys: ['signingCertificate', 'singleSignOnServiceUrl', 'singleLogoutServiceUrl'],
        source: 'url',
      },
    });
    const audit = JSON.stringify(store.audits);
    expect(audit).not.toContain(newCert.der.slice(20, 80));
    expect(audit).not.toContain(oldCert.der.slice(20, 80));

    const table = formatOutcome(outcome);
    expect(table).toMatch(/^alpha\s+updated\s+signingCertificate, singleSignOnServiceUrl/m);
    expect(table).toContain('1 updated, 1 unchanged, 3 skipped, 2 failed');
  });

  it('dry run: reports the same changes, writes nothing', async () => {
    const outcome = await service(settings(), okFetch()).runOnce({
      dryRun: true,
      aliases: ['alpha'],
    });
    expect(outcome.results).toEqual([
      expect.objectContaining({
        alias: 'alpha',
        status: 'updated',
        changes: ['signingCertificate', 'singleSignOnServiceUrl', 'singleLogoutServiceUrl'],
        warnings: [],
      }),
    ]);
    expect(outcomeFailed(outcome)).toBe(false);
    expect(keycloak.puts()).toEqual([]);
    expect(store.audits).toEqual([]);
    expect(formatOutcome(outcome)).toContain('dry run: 1 to update');
  });

  it('continues with the other aliases when Keycloak fails for one', async () => {
    keycloak.failFor.set('alpha', 500);
    const outcome = await service(settings(), okFetch()).runOnce({ aliases: ['alpha', 'same'] });
    expect(byAlias(outcome.results).alpha).toMatchObject({ status: 'failed' });
    expect(byAlias(outcome.results).same).toMatchObject({ status: 'unchanged' });
  });

  it('includes disabled IdPs only when configured to', async () => {
    const outcome = await service(settings({ includeDisabled: true }), okFetch()).runOnce({
      aliases: ['gamma'],
    });
    expect(outcome.results[0]).toMatchObject({ alias: 'gamma', status: 'updated' });
  });

  it('is a logged no-op without URL and file', async () => {
    const fetchImpl = okFetch();
    const outcome = await service(settings({ url: undefined }), fetchImpl).runOnce();
    expect(outcome).toMatchObject({ status: 'not_configured', results: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(keycloak.calls).toEqual([]);
    await expect(service(settings(), fetchImpl).runOnce({ verify: false })).rejects.toThrow(
      /only be skipped for a local file/,
    );
  });
});

describe('metrics hook', () => {
  it('reports a success only for a completed refresh without failures, not a dry run', async () => {
    const metrics = { idpRefreshSucceeded: vi.fn() };
    await service(settings(), okFetch(), metrics).runOnce({ aliases: ['same'] });
    expect(metrics.idpRefreshSucceeded).toHaveBeenCalledTimes(1);
    expect(metrics.idpRefreshSucceeded.mock.calls[0]![0]).toBeInstanceOf(Date);

    metrics.idpRefreshSucceeded.mockClear();
    await service(settings(), okFetch(), metrics).runOnce(); // beta and epsilon fail
    await service(settings(), okFetch(), metrics).runOnce({ dryRun: true, aliases: ['same'] });
    await service(settings({ url: undefined }), okFetch(), metrics).runOnce(); // not configured
    expect(metrics.idpRefreshSucceeded).not.toHaveBeenCalled();
  });

  it('re-reads the certificate expiries after every run but a dry run, success or not', async () => {
    const certificates = { check: vi.fn(async () => true) };
    await service(settings(), okFetch(), undefined, certificates).runOnce({ aliases: ['same'] });
    expect(certificates.check).toHaveBeenCalledTimes(1);
    await service(settings(), okFetch(), undefined, certificates).runOnce(); // failures
    expect(certificates.check).toHaveBeenCalledTimes(2);
    await service(settings(), okFetch(), undefined, certificates).runOnce({ dryRun: true });
    expect(certificates.check).toHaveBeenCalledTimes(2);
    await expect(
      service(settings(), okFetch(), undefined, certificates).runOnce({ verify: false }),
    ).rejects.toThrow(/only be skipped/);
    expect(certificates.check).toHaveBeenCalledTimes(3);
  });
});

describe('aggregate download, last good copy and staleness', () => {
  it('caches a verified download and falls back to it on failure, with a warning', async () => {
    const s = settings();
    await service(s, okFetch()).runOnce({ dryRun: true, aliases: ['same'] });
    expect(readFileSync(join(s.cacheDir, 'aggregate.xml'), 'utf8')).toBe(signedAggregate);
    expect(JSON.parse(readFileSync(join(s.cacheDir, 'aggregate.json'), 'utf8'))).toMatchObject({
      url: AGGREGATE_URL,
    });

    const down = aggregateFetch(() => new Response('unavailable', { status: 503 }));
    const outcome = await service(s, down).runOnce({ aliases: ['alpha'] });
    expect(outcome.aggregate?.kind).toBe('cache');
    expect(outcome.warnings[0]).toMatch(/HTTP 503.*last good aggregate/);
    expect(byAlias(outcome.results).alpha?.status).toBe('updated');

    // A forged download is refused just the same, the cached copy is kept.
    const forger = createTestCertificate('Federation signer', daysFromNow(-1), daysFromNow(10));
    const forged = signXml(
      aggregateXml([entity('alpha', { sso: { post: 'https://evil.test' } })]),
      forger,
    );
    const evil = await service(
      s,
      aggregateFetch(() => new Response(forged)),
    ).runOnce({
      dryRun: true,
      aliases: ['alpha'],
    });
    expect(evil.aggregate?.kind).toBe('cache');
    expect(evil.warnings[0]).toMatch(/Signature verification failed/);
    expect(readFileSync(join(s.cacheDir, 'aggregate.xml'), 'utf8')).toBe(signedAggregate);
  });

  it('fails loudly when the last good copy is older than 7 days', async () => {
    const s = settings();
    await service(s, okFetch()).runOnce({ dryRun: true, aliases: ['same'] });
    const old = daysFromNow(-8);
    writeFileSync(
      join(s.cacheDir, 'aggregate.json'),
      JSON.stringify({ url: AGGREGATE_URL, fetchedAt: old.toISOString() }),
    );
    utimesSync(join(s.cacheDir, 'aggregate.xml'), old, old);
    const down = aggregateFetch(() => {
      throw new TypeError('fetch failed');
    });
    const outcome = await service(s, down).runOnce({ aliases: ['alpha', 'same'] });
    expect(outcome.aggregateError).toMatch(/older than 7 days/);
    expect(outcome.results.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(outcomeFailed(outcome)).toBe(true);
    expect(keycloak.puts()).toEqual([]);
  });

  it('enforces the size limit and fails without a cache', async () => {
    const s = settings({ maxBytes: 2048 });
    const outcome = await service(s, okFetch()).runOnce({ aliases: ['alpha'] });
    expect(outcome.aggregateError).toMatch(/too large.*no cached aggregate/);
    const declared = aggregateFetch(
      () => new Response('x', { headers: { 'content-length': String(10 * 1024 * 1024) } }),
    );
    const again = await service(s, declared).runOnce({ aliases: ['alpha'] });
    expect(again.aggregateError).toMatch(/too large \(10485760 bytes/);
  });

  it('reuses a fresh cached copy at start-up without downloading', async () => {
    const s = settings();
    await service(s, okFetch()).runOnce({ dryRun: true, aliases: ['same'] });
    const fetchImpl = okFetch();
    const outcome = await service(s, fetchImpl).runOnce({
      dryRun: true,
      aliases: ['same'],
      reuseCacheMaxAgeMs: 60 * 60 * 1000,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome.aggregate?.kind).toBe('cache');
    expect(outcome.warnings).toEqual([]);
  });
});

describe('maintenance queue', () => {
  it('schedules idp-metadata-refresh daily at 04:15 UTC on the maintenance queue', () => {
    expect(MAINTENANCE_SCHEDULES).toContainEqual({
      job: IDP_METADATA_REFRESH_JOB,
      pattern: IDP_METADATA_REFRESH_CRON,
    });
    expect(IDP_METADATA_REFRESH_CRON).toBe('15 4 * * *');
    expect(ON_DEMAND_JOBS).toContain(IDP_METADATA_REFRESH_JOB);
  });

  /** A processor whose runner records the trigger and runs the job directly. */
  const processorWith = (refresh: IdpMetadataRefreshService) => {
    const calls: { job: string; trigger: string }[] = [];
    const runner = {
      run: async (job: string, trigger: string, _by: unknown, fn: () => Promise<JobOutcome>) => {
        calls.push({ job, trigger });
        return { runId: 'run', status: 'succeeded', ...(await fn()) };
      },
    } as unknown as MaintenanceRunner;
    const none = undefined as never;
    const processor = new MaintenanceProcessor(runner, none, none, none, none, none, refresh);
    return { processor, calls };
  };

  it('records the run (counters, details) and fails it when an IdP failed', async () => {
    const { processor, calls } = processorWith(service(settings(), okFetch()));
    const job = (data = {}) => ({ name: IDP_METADATA_REFRESH_JOB, data }) as never;
    const failure = await processor.process(job({ trigger: 'schedule' })).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(MaintenanceJobError);
    expect((failure as Error).message).toMatch(
      /idp-metadata-refresh failed: beta: Metadata has no currently valid signing certificate/,
    );
    expect((failure as MaintenanceJobError).outcome.counters).toMatchObject({ failed: 2 });
    expect(calls).toEqual([{ job: IDP_METADATA_REFRESH_JOB, trigger: 'schedule' }]);

    store.partners.splice(0, store.partners.length, {
      organizationId: ORG(5),
      slug: 'same',
      alias: 'same',
    });
    const ok = await processor.process(
      job({ trigger: 'startup', reuseCacheMaxAgeMs: STARTUP_CACHE_REUSE_MS }),
    );
    expect(ok).toMatchObject({
      status: 'succeeded',
      counters: { updated: 0, unchanged: 1, skipped: 0, failed: 0 },
      details: {
        status: 'completed',
        aggregate: { source: 'cache', verified: true },
        results: [{ alias: 'same', status: 'unchanged', changes: [] }],
      },
    });
    expect(calls[1]).toEqual({ job: IDP_METADATA_REFRESH_JOB, trigger: 'startup' });
    await expect(processor.process({ name: 'other', data: {} } as never)).resolves.toBeNull();
  });
});
