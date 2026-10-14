// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';
import {
  KyselyOrganizationDirectory,
  ORGANIZATION_DIRECTORY,
} from '../../src/admin/auth/organization-directory.js';
import { IntegrationsController } from '../../src/admin/integrations/integrations.controller.js';
import {
  INTEGRATIONS_CLOCK,
  IntegrationsService,
} from '../../src/admin/integrations/integrations.service.js';
import { OrganizationAccess } from '../../src/admin/integrations/organization-access.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { KYSELY } from '../../src/db/db.module.js';
import { HarvestQueue } from '../../src/ingestion/harvest.queue.js';
import { OeapiClientFactory } from '../../src/ingestion/oeapi/oeapi-client.factory.js';
import { SyncRunsRepository } from '../../src/ingestion/sync-runs.repository.js';
import { SecretsService } from '../../src/secrets/secrets.service.js';
import { BASE_CLAIMS, createTestTokens, type TestTokens } from '../support/admin-tokens.js';
import { configStub } from '../support/config-stub.js';
import { createFakeOeapi, MOCK_BASE_URL, MOCK_HOST } from '../support/fake-oeapi.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const PARTNER_SUB = '11111111-1111-4111-8111-111111111111';
const ALLIANCE_SUB = '22222222-2222-4222-8222-222222222222';
const URV_SUB = '33333333-3333-4333-8333-333333333333';

describe.runIf(describeWithDatabase === 'run')('Integration admin API (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let app: INestApplication;
  let tokens: TestTokens;
  let now = new Date('2026-10-14T10:00:00Z');
  const harvests = {
    request: vi.fn(async () => 'queued' as const),
    isActive: vi.fn(async () => false),
  };
  const auth: Record<'partner' | 'alliance' | 'urv', string> = {
    partner: '',
    alliance: '',
    urv: '',
  };
  const base = `/api/admin/v1/organizations/${ORG.uibk}`;
  const http = () => request(app.getHttpServer());

  const mockSettings = {
    authoritative_channel: 'oeapi',
    access_mode: 'direct',
    base_url: MOCK_BASE_URL,
    auth_scheme: 'basic',
    secret: 'oecp:oecp-mock-secret',
    enabled: true,
  };

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    tdb = await createTestDatabase();
    tokens = await createTestTokens();
    const key = randomBytes(32);
    const secrets = new SecretsService(tdb.db, { masterKeys: () => new Map([[1, key]]) });
    const fake = createFakeOeapi();
    const clients = new OeapiClientFactory(
      configStub({
        SURFEDUHUB_GATEWAY_URL: 'https://gateway.surfeduhub.nl',
        SURFEDUHUB_SECRET_REF: undefined,
        OECP_ALLOW_INSECURE_PARTNER_HTTP: false,
      }),
      secrets,
      { transport: fake.transport, resolve: fake.resolve, sleep: async () => undefined },
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        { provide: KYSELY, useValue: tdb.db },
        { provide: AdminTokenVerifier, useValue: tokens.verifier },
        { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
        AdminJwtGuard,
        OrganizationAccess,
        IntegrationsService,
        { provide: SecretsService, useValue: secrets },
        { provide: OeapiClientFactory, useValue: clients },
        { provide: SyncRunsRepository, useValue: new SyncRunsRepository(tdb.db) },
        { provide: HarvestQueue, useValue: harvests },
        { provide: INTEGRATIONS_CLOCK, useValue: () => now },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const sign = (sub: string, roles: string[], org: string, idp?: string) =>
      tokens.sign({ ...BASE_CLAIMS, roles, org_id: org, ...(idp ? { idp } : {}) }, sub);
    auth.partner = `Bearer ${await sign(PARTNER_SUB, ['partner_admin'], ORG.uibk, 'uibk')}`;
    auth.alliance = `Bearer ${await sign(ALLIANCE_SUB, ['alliance_admin'], ORG.aurora)}`;
    auth.urv = `Bearer ${await sign(URV_SUB, ['partner_admin'], ORG.urv, 'urv')}`;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await tdb?.drop();
  });

  it('requires a bearer token', async () => {
    await http().get(`${base}/integration`).expect(401);
  });

  it('returns 404 oecp.integration.not_configured before the first PUT', async () => {
    const response = await http()
      .get(`${base}/integration`)
      .set('Authorization', auth.partner)
      .expect(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body.errors[0].code).toBe('oecp.integration.not_configured');
  });

  it('scopes partner_admins to their organization and its sub-units', async () => {
    const other = await http()
      .get(`${base}/integration`)
      .set('Authorization', auth.urv)
      .expect(403);
    expect(other.body.errors[0].code).toBe('oecp.auth.forbidden_organization');
    await http()
      .get(`/api/admin/v1/organizations/${ORG.uibkFaculty}/integration`)
      .set('Authorization', auth.partner)
      .expect(404);
    await http()
      .get(`/api/admin/v1/organizations/00000000-0000-4000-8000-00000000dead/integration`)
      .set('Authorization', auth.alliance)
      .expect(404);
  });

  it('validates the body (problem+json 400)', async () => {
    const response = await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.partner)
      .send({ authoritative_channel: 'oeapi', access_mode: 'direct', schedule_cron: 'daily' })
      .expect(400);
    expect(
      response.body.errors.map((e: { code: string; pointer: string }) => [e.code, e.pointer]),
    ).toEqual([
      ['oecp.request.validation_failed', '/schedule_cron'],
      ['oecp.integration.base_url_required', '/base_url'],
    ]);
  });

  it('refuses http base URLs unless the insecure flag is set', async () => {
    const response = await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.partner)
      .send({ ...mockSettings, base_url: 'http://oeapi-mock:8090' })
      .expect(422);
    expect(response.body.errors[0].code).toBe('oecp.integration.insecure_url');
  });

  it('PUT stores the settings and the write-only credential, and audits without it', async () => {
    const response = await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.partner)
      .send(mockSettings)
      .expect(200);
    expect(response.body).toMatchObject({
      organization_id: ORG.uibk,
      authoritative_channel: 'oeapi',
      access_mode: 'direct',
      base_url: MOCK_BASE_URL,
      auth_scheme: 'basic',
      secret_configured: true,
      approved_host: null,
      host_approved: false,
      schedule_cron: '0 3 * * *',
      max_requests_per_second: 2,
      enabled: true,
      last_run: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('oecp-mock-secret');
    expect(response.body).not.toHaveProperty('secret_ref');
    const audit = await tdb.db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'integration.create')
      .executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ actor_sub: PARTNER_SUB, entity_type: 'partner_integration' });
    expect(audit.changes).toMatchObject({
      secret: 'set',
      base_url: { from: null, to: MOCK_BASE_URL },
    });
    expect(JSON.stringify(audit.changes)).not.toContain('oecp-mock-secret');
  });

  it('test-connection needs an approved host', async () => {
    const response = await http()
      .post(`${base}/integration/test-connection`)
      .set('Authorization', auth.partner)
      .expect(409);
    expect(response.body.errors[0].code).toBe('oecp.oeapi.host_not_approved');
  });

  it('approve-host is alliance_admin only and records who approved', async () => {
    const denied = await http()
      .post(`${base}/integration/approve-host`)
      .set('Authorization', auth.partner)
      .expect(403);
    expect(denied.body.errors[0].code).toBe('oecp.auth.forbidden_role');
    const response = await http()
      .post(`${base}/integration/approve-host`)
      .set('Authorization', auth.alliance)
      .expect(200);
    expect(response.body).toMatchObject({
      approved_host: MOCK_HOST,
      approved_by: ALLIANCE_SUB,
      approved_at: now.toISOString(),
      host_approved: true,
    });
  });

  it('keeps the approval when the host is unchanged and clears it when the host changes', async () => {
    const same = await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.partner)
      .send({
        ...mockSettings,
        base_url: `https://${MOCK_HOST}/oeapi/v5/`,
        secret: undefined,
        page_size: 50,
      })
      .expect(200);
    expect(same.body).toMatchObject({
      host_approved: true,
      secret_configured: true,
      page_size: 50,
    });
    const moved = await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.partner)
      .send({ ...mockSettings, base_url: 'https://other.uibk.example/oeapi', secret: undefined })
      .expect(200);
    expect(moved.body).toMatchObject({ approved_host: null, host_approved: false });
    // Back to the mock host and re-approve for the following tests.
    await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.partner)
      .send({ ...mockSettings, secret: undefined })
      .expect(200);
    await http()
      .post(`${base}/integration/approve-host`)
      .set('Authorization', auth.alliance)
      .expect(200);
  });

  it('test-connection reports the service document and first course without the credential', async () => {
    const response = await http()
      .post(`${base}/integration/test-connection`)
      .set('Authorization', auth.partner)
      .expect(200);
    expect(response.body).toMatchObject({
      ok: true,
      target: MOCK_BASE_URL,
      service: { contact_email: 'oeapi@uibk.example' },
      first_course_primary_code: '703001',
      courses_available: true,
      error: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('oecp-mock-secret');
  });

  it('test-connection reports remote failures in the body', async () => {
    await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.partner)
      .send({ ...mockSettings, secret: 'oecp:wrong' })
      .expect(200);
    const response = await http()
      .post(`${base}/integration/test-connection`)
      .set('Authorization', auth.partner)
      .expect(200);
    expect(response.body).toMatchObject({
      ok: false,
      error: { code: 'oecp.oeapi.unauthorized', status: 401 },
    });
    await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.partner)
      .send(mockSettings)
      .expect(200);
  });

  it('sync-now queues a manual run, then refuses while it is active and for 15 minutes', async () => {
    const response = await http()
      .post(`${base}/integration/sync-now`)
      .set('Authorization', auth.partner)
      .expect(202);
    expect(response.body).toEqual({ sync_run_id: expect.any(String), status: 'queued' });
    expect(harvests.request).toHaveBeenCalledWith({
      organizationId: ORG.uibk,
      trigger: 'manual',
      triggeredBy: PARTNER_SUB,
      syncRunId: response.body.sync_run_id,
    });
    const busy = await http()
      .post(`${base}/integration/sync-now`)
      .set('Authorization', auth.partner)
      .expect(409);
    expect(busy.body.errors[0].code).toBe('oecp.sync.already_running');

    await tdb.db
      .updateTable('sync_runs')
      .set({ status: 'succeeded', started_at: now, finished_at: now, is_complete: true })
      .where('id', '=', response.body.sync_run_id)
      .execute();
    now = new Date(now.getTime() + 5 * 60_000);
    const limited = await http()
      .post(`${base}/integration/sync-now`)
      .set('Authorization', auth.partner)
      .expect(429);
    expect(limited.body.errors[0].code).toBe('oecp.sync.rate_limited');
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(500);

    const audit = await tdb.db
      .selectFrom('audit_log')
      .select(['action', 'entity_id'])
      .where('action', '=', 'integration.sync_now')
      .execute();
    expect(audit).toEqual([
      { action: 'integration.sync_now', entity_id: response.body.sync_run_id },
    ]);
  });

  it('lists sync runs and returns one run with paginated errors', async () => {
    const [run] = await tdb.db.selectFrom('sync_runs').select('id').execute();
    await tdb.db
      .insertInto('sync_errors')
      .values(
        Array.from({ length: 3 }, (_, i) => ({
          sync_run_id: run!.id,
          severity: i === 0 ? ('error' as const) : ('warning' as const),
          code: 'oecp.oeapi.insecure_link',
          message: `m${i}`,
          entity_type: 'course',
          ext_id: `X${i}`,
          json_pointer: '/link',
        })),
      )
      .execute();
    const list = await http()
      .get(`${base}/sync-runs?limit=5`)
      .set('Authorization', auth.partner)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: run!.id,
      status: 'succeeded',
      trigger_kind: 'manual',
      duration_ms: 0,
    });

    const detail = await http()
      .get(`/api/admin/v1/sync-runs/${run!.id}?page=2&page_size=2`)
      .set('Authorization', auth.partner)
      .expect(200);
    expect(detail.body.errors).toMatchObject({ page: 2, page_size: 2, total: 3 });
    expect(detail.body.errors.items).toEqual([
      expect.objectContaining({ ext_id: 'X2', json_pointer: '/link', severity: 'warning' }),
    ]);
    const warnings = await http()
      .get(`/api/admin/v1/sync-runs/${run!.id}?severity=error`)
      .set('Authorization', auth.alliance)
      .expect(200);
    expect(warnings.body.errors.total).toBe(1);

    await http()
      .get(`/api/admin/v1/sync-runs/${run!.id}`)
      .set('Authorization', auth.urv)
      .expect(403);
    await http()
      .get('/api/admin/v1/sync-runs/00000000-0000-4000-8000-00000000dead')
      .set('Authorization', auth.alliance)
      .expect(404);
    await http().get(`${base}/sync-runs?limit=1000`).set('Authorization', auth.partner).expect(400);
  });

  it('sync-now refuses organizations whose authoritative channel is not oeapi', async () => {
    await http()
      .put(`/api/admin/v1/organizations/${ORG.urv}/integration`)
      .set('Authorization', auth.urv)
      .send({ authoritative_channel: 'csv' })
      .expect(200);
    const response = await http()
      .post(`/api/admin/v1/organizations/${ORG.urv}/integration/sync-now`)
      .set('Authorization', auth.urv)
      .expect(409);
    expect(response.body.errors[0].code).toBe('oecp.sync.channel_disabled');
  });

  it('PUT with auth_scheme none deletes the stored credential', async () => {
    const response = await http()
      .put(`${base}/integration`)
      .set('Authorization', auth.alliance)
      .send({ ...mockSettings, auth_scheme: 'none', secret: undefined })
      .expect(200);
    expect(response.body.secret_configured).toBe(false);
    const { count } = await tdb.db
      .selectFrom('secrets')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(Number(count)).toBe(0);
  });
});
