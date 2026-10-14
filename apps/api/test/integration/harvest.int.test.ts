// SPDX-License-Identifier: EUPL-1.2
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CanonicalWriter } from '../../src/ingestion/canonical-writer.service.js';
import { HarvestService } from '../../src/ingestion/harvest.service.js';
import { OeapiClientFactory } from '../../src/ingestion/oeapi/oeapi-client.factory.js';
import { OeapiV5Adapter } from '../../src/ingestion/oeapi/oeapi-v5.adapter.js';
import { SyncRunsRepository } from '../../src/ingestion/sync-runs.repository.js';
import { SecretsService } from '../../src/secrets/secrets.service.js';
import { configStub } from '../support/config-stub.js';
import {
  createFakeOeapi,
  type FakeOeapi,
  MOCK_BASE_URL,
  MOCK_HOST,
} from '../support/fake-oeapi.js';
import { COURSES } from '../support/oeapi-fixtures.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const NOW = new Date('2026-10-14T03:00:00Z');

describe.runIf(describeWithDatabase === 'run')('HarvestService (PostgreSQL, fake OEAPI)', () => {
  let tdb: TestDatabase;
  let fake: FakeOeapi;
  let harvest: HarvestService;
  let secrets: SecretsService;

  const run = () => harvest.run({ organizationId: ORG.uibk, trigger: 'schedule' });
  const course = (extId: string) =>
    tdb.db
      .selectFrom('courses')
      .selectAll()
      .where('organization_id', '=', ORG.uibk)
      .where('ext_id', '=', extId)
      .executeTakeFirst();
  const errors = (syncRunId: string | null) =>
    tdb.db
      .selectFrom('sync_errors')
      .select(['severity', 'code', 'ext_id', 'json_pointer', 'entity_type'])
      .where('sync_run_id', '=', syncRunId ?? '')
      .orderBy('id')
      .execute();

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    tdb = await createTestDatabase();
    const key = randomBytes(32);
    secrets = new SecretsService(tdb.db, { masterKeys: () => new Map([[1, key]]) });
    fake = createFakeOeapi({ courses: [...COURSES] });
    const clients = new OeapiClientFactory(
      configStub({
        SURFEDUHUB_GATEWAY_URL: 'https://gateway.surfeduhub.nl',
        SURFEDUHUB_SECRET_REF: undefined,
        OECP_ALLOW_INSECURE_PARTNER_HTTP: false,
      }),
      secrets,
      { transport: fake.transport, resolve: fake.resolve, sleep: async () => undefined },
    );
    harvest = new HarvestService(
      tdb.db,
      clients,
      new OeapiV5Adapter(),
      new CanonicalWriter(tdb.db),
      new SyncRunsRepository(tdb.db),
      () => NOW,
    );
    const secretRef = await secrets.store('partner-integration:uibk', 'oecp:oecp-mock-secret');
    await tdb.db
      .insertInto('partner_integrations')
      .values({
        organization_id: ORG.uibk,
        authoritative_channel: 'oeapi',
        access_mode: 'direct',
        base_url: MOCK_BASE_URL,
        auth_scheme: 'basic',
        secret_ref: secretRef,
        approved_host: MOCK_HOST,
        approved_by: 'alliance-admin',
        approved_at: NOW,
        withdraw_after_absences: 2,
        page_size: 10,
        max_requests_per_second: 100,
        enabled: true,
      })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  beforeEach(() => {
    fake.options.courses = [...COURSES];
    fake.options.failures.clear();
    fake.requests.length = 0;
  });

  it('harvests the dataset: accepted, draft, warnings and rejections', async () => {
    const outcome = await run();
    expect(outcome).toMatchObject({
      status: 'partial',
      isComplete: true,
      counters: { n_created: 11, n_updated: 0, n_unchanged: 0, n_rejected: 4, n_withdrawn: 0 },
    });
    expect(outcome.errorSummary).toBe('4 rejected');

    // Request order and parameters (spec §6.2.3).
    const paths = fake.requests.map((r) => `${r.url.pathname}${r.url.search}`);
    expect(paths[0]).toBe(
      '/oeapi/v5/organizations?organizationType=root&pageSize=10&pageNumber=1&consumer=eduxchange',
    );
    expect(paths[1]).toBe('/oeapi/v5/courses?pageSize=10&pageNumber=1&consumer=eduxchange');
    expect(paths[2]).toBe(
      '/oeapi/v5/courses/c-0001/offerings?since=2025-10-14&pageSize=10&pageNumber=1&consumer=eduxchange',
    );
    expect(paths[3]).toBe(
      '/oeapi/v5/offerings/o-0001-a?expand=academicSession&consumer=eduxchange',
    );

    expect(await course('703001')).toMatchObject({
      status: 'published',
      ects: '7.50',
      level: 'master',
      eqf_level: 7,
    });
    expect(await course('608100')).toMatchObject({ status: 'draft', ects: '5.00' });
    expect(await course('510010')).toMatchObject({ status: 'published', info_url: null });
    expect(await course('120500')).toMatchObject({ level: 'short_cycle', eqf_level: 5 });
    expect(await course('999001')).toBeUndefined();

    const offerings = await tdb.db
      .selectFrom('course_offerings as o')
      .innerJoin('courses as c', 'c.id', 'o.course_id')
      .leftJoin('academic_sessions as s', 's.id', 'o.academic_session_id')
      .select([
        'o.ext_offering_id',
        'o.teaching_languages',
        'o.max_students',
        'o.seats_available',
        'o.application_deadline',
        'o.timezone',
        's.ext_id as session',
      ])
      .orderBy('o.ext_offering_id')
      .execute();
    expect(offerings).toEqual([
      {
        ext_offering_id: '402300-2026W',
        teaching_languages: ['en'],
        max_students: null,
        seats_available: null,
        application_deadline: null,
        timezone: 'Europe/Vienna',
        session: null,
      },
      {
        ext_offering_id: '510010-2026S',
        teaching_languages: ['en'],
        max_students: null,
        seats_available: null,
        application_deadline: null,
        timezone: 'Europe/Vienna',
        session: null,
      },
      {
        ext_offering_id: '608100-2026W',
        teaching_languages: ['de'],
        max_students: 40,
        seats_available: null,
        application_deadline: null,
        timezone: 'Europe/Vienna',
        session: null,
      },
      {
        ext_offering_id: '703001-2026S',
        teaching_languages: ['en'],
        max_students: 30,
        seats_available: 5,
        application_deadline: '2026-02-20',
        timezone: 'Europe/Vienna',
        session: 'as-ss2026',
      },
      {
        ext_offering_id: '703001-2026W',
        teaching_languages: ['en'],
        max_students: 25,
        seats_available: 0,
        application_deadline: '2026-09-15',
        timezone: 'Europe/Vienna',
        session: 'as-ws2026',
      },
      {
        ext_offering_id: 'o-0007-a',
        teaching_languages: ['is'],
        max_students: null,
        seats_available: null,
        application_deadline: null,
        timezone: 'Europe/Vienna',
        session: null,
      },
    ]);

    const issues = (await errors(outcome.syncRunId)).map((e) => [
      e.severity,
      e.code,
      e.ext_id,
      e.json_pointer,
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([
        ['warning', 'oecp.content.english_missing', '608100', '/name'],
        ['warning', 'oecp.oeapi.language_dropped', '402300#402300-2026W', '/teachingLanguage'],
        ['warning', 'oecp.oeapi.invalid_isced', '510010', '/fieldsOfStudy'],
        ['warning', 'oecp.oeapi.insecure_link', '510010', '/link'],
        [
          'warning',
          'oecp.oeapi.unmappable_delivery_mode',
          '510010#510010-2026S',
          '/modeOfDelivery',
        ],
        ['error', 'oecp.oeapi.study_load_unit', '999001', '/studyLoad/studyLoadUnit'],
        ['error', 'oecp.oeapi.parent_rejected', '999001#999001-2026S', null],
        ['error', 'oecp.oeapi.missing_primary_code', 'c-0006', '/primaryCode'],
        ['error', 'oecp.oeapi.unmappable_delivery_mode', '120500#120500-X', '/modeOfDelivery'],
      ]),
    );
    const history = await tdb.db
      .selectFrom('ext_metadata_history')
      .select(['entity_type', 'validation_result'])
      .where('sync_run_id', '=', outcome.syncRunId ?? '')
      .execute();
    expect(history.filter((h) => h.entity_type === 'organization')).toHaveLength(1);
    expect(history.filter((h) => h.validation_result === 'rejected')).toHaveLength(4);
    expect(history.filter((h) => h.entity_type === 'academic_session')).toHaveLength(2);

    const syncRun = await tdb.db
      .selectFrom('sync_runs')
      .selectAll()
      .where('id', '=', outcome.syncRunId ?? '')
      .executeTakeFirstOrThrow();
    expect(syncRun).toMatchObject({
      channel: 'oeapi',
      trigger_kind: 'schedule',
      schema_version: 'oeapi-5.0',
      status: 'partial',
      is_complete: true,
      n_created: 11,
      n_rejected: 4,
    });
    expect(syncRun.finished_at).toEqual(NOW);
  });

  it('is idempotent: an identical second run changes nothing', async () => {
    const outcome = await run();
    expect(outcome.counters).toEqual({
      n_created: 0,
      n_updated: 0,
      n_unchanged: 11,
      n_rejected: 4,
      n_withdrawn: 0,
    });
    const history = await tdb.db
      .selectFrom('ext_metadata_history')
      .select('id')
      .where('sync_run_id', '=', outcome.syncRunId ?? '')
      .execute();
    expect(history).toHaveLength(0);
  });

  it('never counts absence in an incomplete run', async () => {
    fake.options.courses = COURSES.filter((c) => c.courseId !== 'c-0004');
    fake.options.failures.set('/courses/c-0002/offerings', 500);
    const outcome = await run();
    expect(outcome).toMatchObject({ status: 'partial', isComplete: false });
    expect(outcome.errorSummary).toContain('offering listing of 608100 failed');
    expect((await course('510010'))?.absent_count).toBe(0);
    expect((await errors(outcome.syncRunId)).map((e) => e.code)).toContain(
      'oecp.oeapi.listing_failed',
    );
  });

  it('counts absence in complete runs, withdraws at N and republishes when seen again', async () => {
    fake.options.courses = COURSES.filter((c) => c.courseId !== 'c-0004');
    const first = await run();
    expect(first).toMatchObject({ isComplete: true, counters: { n_withdrawn: 0 } });
    expect(await course('510010')).toMatchObject({ status: 'published', absent_count: 1 });

    const second = await run();
    expect(second.counters.n_withdrawn).toBe(2); // the course and its offering
    expect(await course('510010')).toMatchObject({ status: 'withdrawn', absent_count: 2 });
    const audit = await tdb.db
      .selectFrom('audit_log')
      .select(['actor_sub', 'action'])
      .where('action', 'like', '%.withdraw')
      .execute();
    expect(audit).toEqual(
      expect.arrayContaining([
        { actor_sub: 'system:harvester', action: 'course.withdraw' },
        { actor_sub: 'system:harvester', action: 'course_offering.withdraw' },
      ]),
    );

    fake.options.courses = [...COURSES];
    const back = await run();
    expect(back.counters.n_updated).toBe(2);
    expect(await course('510010')).toMatchObject({ status: 'published', absent_count: 0 });
  });

  it('does not count absence when 30% or more of published courses are missing', async () => {
    fake.options.courses = COURSES.filter((c) => ['c-0001', 'c-0002'].includes(c.courseId));
    const outcome = await run();
    expect(outcome.isComplete).toBe(true);
    expect(outcome.errorSummary).toContain('mass absence: 3 of 4 published courses missing');
    expect((await errors(outcome.syncRunId)).map((e) => e.code)).toContain(
      'oecp.oeapi.mass_absence',
    );
    expect(await course('402300')).toMatchObject({ status: 'published', absent_count: 0 });
  });

  it('treats an empty listing as incomplete', async () => {
    fake.options.courses = [];
    const outcome = await run();
    expect(outcome).toMatchObject({
      status: 'partial',
      isComplete: false,
      errorSummary: 'no courses returned',
    });
    expect(await course('703001')).toMatchObject({ absent_count: 0 });
  });

  it('fails the run on authentication errors without touching data', async () => {
    fake.options.failures.set('/organizations', 401);
    const outcome = await run();
    expect(outcome).toMatchObject({ status: 'failed', isComplete: false });
    expect(outcome.errorSummary).toMatch(/HTTP 401/);
    expect((await errors(outcome.syncRunId)).map((e) => e.code)).toEqual([
      'oecp.oeapi.unauthorized',
    ]);
  });

  it('fails the run when the course listing is unavailable', async () => {
    fake.options.failures.set('/courses', 503);
    const outcome = await run();
    expect(outcome.status).toBe('failed');
    expect((await errors(outcome.syncRunId)).map((e) => e.code)).toEqual(['oecp.oeapi.http_error']);
  });

  it('fails the run when the host is no longer approved', async () => {
    await tdb.db
      .updateTable('partner_integrations')
      .set({ approved_host: null })
      .where('organization_id', '=', ORG.uibk)
      .execute();
    const outcome = await run();
    expect(outcome.status).toBe('failed');
    expect((await errors(outcome.syncRunId)).map((e) => e.code)).toEqual([
      'oecp.oeapi.host_not_approved',
    ]);
    expect(fake.requests).toHaveLength(0);
    await tdb.db
      .updateTable('partner_integrations')
      .set({ approved_host: MOCK_HOST })
      .where('organization_id', '=', ORG.uibk)
      .execute();
  });

  it('skips scheduled runs of disabled integrations and runs a queued manual run', async () => {
    await tdb.db
      .updateTable('partner_integrations')
      .set({ enabled: false })
      .where('organization_id', '=', ORG.uibk)
      .execute();
    expect((await run()).status).toBe('skipped');
    const queued = await new SyncRunsRepository(tdb.db).createQueued({
      organizationId: ORG.uibk,
      trigger: 'manual',
      triggeredBy: 'admin-sub',
    });
    const outcome = await harvest.run({
      organizationId: ORG.uibk,
      trigger: 'manual',
      triggeredBy: 'admin-sub',
      syncRunId: queued.id,
    });
    expect(outcome.syncRunId).toBe(queued.id);
    expect(outcome.isComplete).toBe(true);
    const row = await tdb.db
      .selectFrom('sync_runs')
      .select(['status', 'trigger_kind', 'triggered_by'])
      .where('id', '=', queued.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'partial', trigger_kind: 'manual', triggered_by: 'admin-sub' });
  });

  it('refuses a second concurrent run of the same organization', async () => {
    const repo = new SyncRunsRepository(tdb.db);
    const running = await repo.start({
      organizationId: ORG.uibk,
      trigger: 'schedule',
      triggeredBy: null,
      now: NOW,
    });
    expect(running).toBeDefined();
    const second = await harvest.run({ organizationId: ORG.uibk, trigger: 'manual' });
    expect(second).toMatchObject({
      status: 'skipped',
      errorSummary: 'another run of the organization is in progress',
    });
    await repo.finish(
      running!.id,
      {
        status: 'cancelled',
        is_complete: false,
        error_summary: null,
        n_created: 0,
        n_updated: 0,
        n_unchanged: 0,
        n_rejected: 0,
        n_withdrawn: 0,
      },
      NOW,
    );
  });
});
