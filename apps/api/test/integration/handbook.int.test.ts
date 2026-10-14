// SPDX-License-Identifier: EUPL-1.2
// Decision 21 (Aurora IT Handbook §3.4): migration 0007, instructors and the five
// optional texts through the writer and overrides, and the publication rule
// (OECP_PUBLISH_RULE warn/enforce) on the three channels.
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  adminCourse,
  adminCourseHistory,
  adminCourseList,
  type Course,
  type PublishRuleMode,
} from '@oecp/schemas';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';
import {
  KyselyOrganizationDirectory,
  ORGANIZATION_DIRECTORY,
} from '../../src/admin/auth/organization-directory.js';
import { CoursesController } from '../../src/admin/courses/courses.controller.js';
import { CoursesRepository } from '../../src/admin/courses/courses.repository.js';
import { CoursesService } from '../../src/admin/courses/courses.service.js';
import { IntegrationsService } from '../../src/admin/integrations/integrations.service.js';
import { OrganizationAccess } from '../../src/admin/integrations/organization-access.js';
import { CsvUploadInterceptor } from '../../src/admin/uploads/csv-upload.interceptor.js';
import { UploadsController } from '../../src/admin/uploads/uploads.controller.js';
import { UploadsService } from '../../src/admin/uploads/uploads.service.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { KYSELY } from '../../src/db/db.module.js';
import { CanonicalWriter, PUBLISH_RULE } from '../../src/ingestion/canonical-writer.service.js';
import { CsvIngestionService } from '../../src/ingestion/csv/csv-ingestion.service.js';
import { CsvAdapter } from '../../src/ingestion/csv/csv.adapter.js';
import { CsvQueue } from '../../src/ingestion/csv/csv.queue.js';
import { UploadStorage } from '../../src/ingestion/csv/upload-storage.js';
import { HarvestService } from '../../src/ingestion/harvest.service.js';
import { OeapiClientFactory } from '../../src/ingestion/oeapi/oeapi-client.factory.js';
import { OeapiV5Adapter } from '../../src/ingestion/oeapi/oeapi-v5.adapter.js';
import type { WriteContext } from '../../src/ingestion/ports/canonical-writer.js';
import { SyncRunsRepository } from '../../src/ingestion/sync-runs.repository.js';
import { SecretsService } from '../../src/secrets/secrets.service.js';
import { BASE_CLAIMS, createTestTokens } from '../support/admin-tokens.js';
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
  migrate,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const ALLIANCE_SUB = '22222222-2222-4222-8222-222222222222';
const MIGRATION = '0007_handbook_alignment.sql';
/** Migrations before 0007 (0006 may or may not exist while it is being built). */
const BEFORE_0007 = readdirSync(fileURLToPath(new URL('../../db/migrations', import.meta.url)))
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort()
  .indexOf(MIGRATION);

/** Catalog of the public schema: columns (in order), constraints, indexes, functions, triggers. */
async function snapshot(tdb: TestDatabase): Promise<Record<string, string[]>> {
  const rows = async (query: ReturnType<typeof sql<{ v: string }>>) =>
    (await query.execute(tdb.db)).rows.map((r) => r.v);
  return {
    // Relative column order (attnum keeps gaps of dropped columns).
    columns: await rows(sql<{ v: string }>`SELECT concat_ws(' ', table_name,
        row_number() OVER (PARTITION BY table_name ORDER BY ordinal_position),
        column_name, data_type, column_default, is_nullable, generation_expression) AS v
      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`),
    constraints: await rows(sql<{ v: string }>`SELECT c.conrelid::regclass || ' ' || c.conname
        || ' ' || pg_get_constraintdef(c.oid) AS v
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' ORDER BY 1`),
    indexes: await rows(sql<{ v: string }>`SELECT indexdef AS v FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY 1`),
    functions: await rows(sql<{ v: string }>`SELECT p.oid::regprocedure::text || ' '
        || md5(pg_get_functiondef(p.oid)) AS v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'oecp%' AND p.prokind = 'f' ORDER BY 1`),
    triggers: await rows(sql<{ v: string }>`SELECT tgrelid::regclass || ' ' || tgname
        || ' ' || tgenabled::text AS v
      FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1`),
  };
}

describe.runIf(describeWithDatabase === 'run')('migration 0007_handbook_alignment', () => {
  let tdb: TestDatabase;
  let before: Record<string, string[]>;
  const COURSE = '0d000000-0000-4000-8000-000000000071';

  beforeAll(async () => {
    expect(BEFORE_0007).toBeGreaterThanOrEqual(5);
    tdb = await createTestDatabase({ migrations: BEFORE_0007 });
    await sql`INSERT INTO courses (id, organization_id, ext_id, source_channel, ects)
      VALUES (${COURSE}, ${ORG.urv}, 'M7', 'csv', 5)`.execute(tdb.db);
    await sql`INSERT INTO course_texts (course_id, lang, title, description)
      VALUES (${COURSE}, 'en', 'Glaciology', 'Moraines and crevasses.')`.execute(tdb.db);
    before = await snapshot(tdb);
    await migrate(tdb.url, 'up', 1);
  }, 60_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  it('adds instructors (default empty) and the five texts', async () => {
    const { rows } = await sql<{ instructors: string[] }>`SELECT instructors FROM courses
      WHERE id = ${COURSE}`.execute(tdb.db);
    expect(rows[0]!.instructors).toEqual([]);
    await sql`UPDATE course_texts SET mode_of_repetition = 'Every summer.', methods = 'Fieldwork.',
      literature = 'Paterson.', privacy_notice = 'Photographs are taken.', remarks = 'Bring boots.'
      WHERE course_id = ${COURSE}`.execute(tdb.db);
    await sql`UPDATE courses SET instructors = '{"Course team, University of Iceland"}'
      WHERE id = ${COURSE}`.execute(tdb.db);
  });

  it.each([
    [`'{""}'`],
    [`ARRAY[repeat('x', 201)]`],
    [`ARRAY[NULL]::text[]`],
    [`(SELECT array_agg('T' || g) FROM generate_series(1, 51) g)`],
  ])('refuses instructors = %s', async (value) => {
    await expect(
      sql.raw(`UPDATE courses SET instructors = ${value} WHERE id = '${COURSE}'`).execute(tdb.db),
    ).rejects.toThrow(/check constraint/);
  });

  it('indexes methods, literature and remarks (weight C) but not privacy notice or repetition', async () => {
    const match = async (word: string) =>
      (
        await sql<{ n: string }>`SELECT count(*) AS n FROM course_texts
          WHERE search_vector @@ to_tsquery('oecp_en', ${word})`.execute(tdb.db)
      ).rows[0]!.n;
    expect(await match('fieldwork')).toBe('1');
    expect(await match('paterson')).toBe('1');
    expect(await match('boots')).toBe('1');
    expect(await match('crevasse')).toBe('1');
    expect(await match('photograph')).toBe('0');
    expect(await match('summer')).toBe('0');
  });

  it('restores the previous schema exactly on down, and migrates up again', async () => {
    await migrate(tdb.url, 'down', 1);
    expect(await snapshot(tdb)).toEqual(before);
    const { rows } = await sql<{ n: string }>`SELECT count(*) AS n FROM course_texts
      WHERE search_vector @@ to_tsquery('oecp_en', 'crevasse')`.execute(tdb.db);
    expect(rows[0]!.n).toBe('1');
    await migrate(tdb.url, 'up', 1);
    const again = await sql<{ instructors: string[]; methods: string | null }>`
      SELECT c.instructors, t.methods FROM courses c JOIN course_texts t ON t.course_id = c.id
      WHERE c.id = ${COURSE}`.execute(tdb.db);
    expect(again.rows[0]).toEqual({ instructors: [], methods: null });
  });
});

const NOW = new Date('2026-10-14T03:00:00Z');

/** A course the harvester could have mapped; complete except what a test removes. */
const harvested = (patch: Partial<Course> = {}): Course => ({
  ext_id: 'H-1',
  source_ref: 'h-1',
  status: 'published',
  kind: 'course',
  ects: 5,
  level: 'master',
  levels: ['master'],
  eqf_level: 7,
  teaching_hours: null,
  teaching_unit_ext_id: null,
  info_url: null,
  contact_email: 'h1@uibk.example',
  isced_codes: ['0613'],
  instructors: ['Course team, University of Innsbruck'],
  attributes: {},
  texts: {
    en: {
      title: 'Hydrology',
      abstract: null,
      description: 'Water.',
      learning_outcomes: 'Model rivers.',
      prerequisites: 'None.',
      assessment: 'Exam.',
      mode_of_repetition: 'Every winter semester.',
      methods: 'Lectures.',
      literature: null,
      privacy_notice: null,
      remarks: null,
      keywords: [],
      is_machine_translated: false,
    },
  },
  ...patch,
});

describe.runIf(describeWithDatabase === 'run')('IT Handbook alignment (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let fake: FakeOeapi;
  let clients: OeapiClientFactory;
  let tokens: Awaited<ReturnType<typeof createTestTokens>>;
  let alliance = '';
  let uploadsDir: string;
  const apps: INestApplication[] = [];

  const runContext = async (
    organizationId: string,
    channel: 'oeapi' | 'csv' | 'form' = 'oeapi',
  ): Promise<WriteContext> => {
    const run = await tdb.db
      .insertInto('sync_runs')
      .values({
        organization_id: organizationId,
        channel,
        trigger_kind: channel === 'oeapi' ? 'schedule' : channel === 'csv' ? 'upload' : 'form',
        schema_version: 'test',
        status: 'succeeded',
        started_at: NOW,
        finished_at: NOW,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      syncRunId: run.id,
      organizationId,
      channel,
      schemaVersion: 'test',
      actor: channel === 'oeapi' ? 'system:harvester' : ALLIANCE_SUB,
      now: NOW,
    };
  };
  const issues = (syncRunId: string | null) =>
    tdb.db
      .selectFrom('sync_errors')
      .select(['code', 'severity', 'ext_id', 'entity_type', 'message'])
      .where('sync_run_id', '=', syncRunId ?? '')
      .where('code', '=', 'oecp.content.handbook_incomplete')
      .orderBy('id')
      .execute();
  const courseRow = (organizationId: string, extId: string) =>
    tdb.db
      .selectFrom('courses')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('ext_id', '=', extId)
      .executeTakeFirstOrThrow();
  const statusAudits = (courseId: string) =>
    tdb.db
      .selectFrom('audit_log')
      .select(['action', 'changes'])
      .where('entity_id', '=', courseId)
      .where('action', 'in', ['course.status', 'course.republish'])
      .orderBy('id')
      .execute();

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    tdb = await createTestDatabase();
    tokens = await createTestTokens();
    alliance = `Bearer ${await tokens.sign(
      { ...BASE_CLAIMS, roles: ['alliance_admin'], org_id: ORG.aurora },
      ALLIANCE_SUB,
    )}`;
    uploadsDir = mkdtempSync(join(tmpdir(), 'oecp-handbook-'));
    const key = randomBytes(32);
    const secrets = new SecretsService(tdb.db, { masterKeys: () => new Map([[1, key]]) });
    fake = createFakeOeapi({ courses: [] });
    clients = new OeapiClientFactory(
      configStub({
        SURFEDUHUB_GATEWAY_URL: 'https://gateway.surfeduhub.nl',
        SURFEDUHUB_SECRET_REF: undefined,
        OECP_ALLOW_INSECURE_PARTNER_HTTP: false,
      }),
      secrets,
      { transport: fake.transport, resolve: fake.resolve, sleep: async () => undefined },
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
        page_size: 10,
        max_requests_per_second: 100,
        enabled: true,
      })
      .execute();
  }, 60_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
    await tdb?.drop();
    if (uploadsDir) rmSync(uploadsDir, { recursive: true, force: true });
  });

  describe('CanonicalWriter: instructors and texts', () => {
    it('stores them, hashes them and keeps overrides of them across source changes', async () => {
      const writer = new CanonicalWriter(tdb.db);
      const ctx = await runContext(ORG.uibk);
      const first = await writer.upsertCourse(ctx, harvested(), {});
      expect(first).toMatchObject({ outcome: 'created', requestedStatus: 'published' });
      expect(await courseRow(ORG.uibk, 'H-1')).toMatchObject({
        instructors: ['Course team, University of Innsbruck'],
      });
      const text = await tdb.db
        .selectFrom('course_texts')
        .selectAll()
        .where('course_id', '=', first.entityId)
        .executeTakeFirstOrThrow();
      expect(text).toMatchObject({
        mode_of_repetition: 'Every winter semester.',
        methods: 'Lectures.',
        literature: null,
      });
      expect((await writer.upsertCourse(ctx, harvested(), {})).outcome).toBe('unchanged');
      expect(
        (await writer.upsertCourse(ctx, harvested({ instructors: ['Dr. A. Example'] }), {}))
          .outcome,
      ).toBe('updated');

      const overrideCtx = { ...(await runContext(ORG.uibk, 'form')), actor: ALLIANCE_SUB };
      await writer.applyCourseOverrides(
        overrideCtx,
        first.entityId,
        {
          set: { instructors: ['Course team (override)'] },
          clear: [],
          texts: { en: { set: { literature: 'Reading list.' }, clear: [] } },
        },
        {},
      );
      // A changed source keeps the overrides and refreshes their source values.
      await writer.upsertCourse(
        ctx,
        harvested({
          instructors: ['Dr. B. Example'],
          texts: {
            en: { ...harvested().texts['en']!, literature: 'Source literature.' },
          },
        }),
        {},
      );
      const row = await courseRow(ORG.uibk, 'H-1');
      expect(row.instructors).toEqual(['Course team (override)']);
      expect(row.overrides['instructors']).toMatchObject({ source: ['Dr. B. Example'] });
      const overridden = await tdb.db
        .selectFrom('course_texts')
        .select(['literature', 'overrides'])
        .where('course_id', '=', first.entityId)
        .executeTakeFirstOrThrow();
      expect(overridden.literature).toBe('Reading list.');
      expect(overridden.overrides['literature']).toMatchObject({ source: 'Source literature.' });

      await writer.applyCourseOverrides(
        overrideCtx,
        first.entityId,
        { set: {}, clear: ['instructors'], texts: { en: { set: {}, clear: ['literature'] } } },
        {},
      );
      expect((await courseRow(ORG.uibk, 'H-1')).instructors).toEqual(['Dr. B. Example']);
      // Cleanup: H-1 is not part of the harvest tests below.
      await tdb.db
        .updateTable('courses')
        .set({ deleted_at: NOW })
        .where('ext_id', '=', 'H-1')
        .execute();
    });
  });

  describe('publication rule on the harvester (Channel A)', () => {
    const c0001 = COURSES.find((c) => c.courseId === 'c-0001')!;
    const harvest = (mode: PublishRuleMode, coordinators: unknown[]) => {
      fake.options.courses = [{ ...c0001, coordinators }];
      return new HarvestService(
        tdb.db,
        clients,
        new OeapiV5Adapter(),
        new CanonicalWriter(tdb.db, mode),
        new SyncRunsRepository(tdb.db),
        () => NOW,
      ).run({ organizationId: ORG.uibk, trigger: 'schedule' });
    };
    const runDetail = (id: string) =>
      new IntegrationsService(
        tdb.db,
        null as never,
        null as never,
        new SyncRunsRepository(tdb.db),
        null as never,
      ).getRun(id, { page: 1, page_size: 100 });

    it('warn: publishes the incomplete course and reports what is missing', async () => {
      // Coordinators given as ids only: ignored, so the course has no instructors.
      const outcome = await harvest('warn', ['p-1', 'p-2']);
      expect(outcome.status).toBe('succeeded');
      const course = await courseRow(ORG.uibk, '703001');
      expect(course).toMatchObject({ status: 'published', instructors: [] });
      expect(await issues(outcome.syncRunId)).toEqual([
        {
          code: 'oecp.content.handbook_incomplete',
          severity: 'warning',
          ext_id: '703001',
          entity_type: 'course',
          message:
            'Course is missing fields the Aurora IT Handbook requires to publish: instructors',
        },
      ]);
      expect((await runDetail(outcome.syncRunId!)).detail.handbook_incomplete).toBe(1);
      expect(fake.requests.some((r) => r.url.pathname.includes('/persons'))).toBe(false);
    });

    it('enforce: stores it as draft with the same warning, never failing the run', async () => {
      const outcome = await harvest('enforce', ['p-1']);
      expect(outcome.status).toBe('succeeded');
      const course = await courseRow(ORG.uibk, '703001');
      expect(course.status).toBe('draft');
      expect(await issues(outcome.syncRunId)).toHaveLength(1);
      const audits = await statusAudits(course.id);
      expect(audits.at(-1)?.changes).toMatchObject({
        status: { from: 'published', to: 'draft' },
        publish_rule: 'enforce',
        missing: ['instructors'],
      });

      // An unchanged incomplete course stays draft without flip-flopping its status.
      const again = await harvest('enforce', ['p-1']);
      expect(again.counters).toMatchObject({ n_unchanged: 3, n_updated: 0 });
      expect((await courseRow(ORG.uibk, '703001')).status).toBe('draft');
      expect(await statusAudits(course.id)).toHaveLength(audits.length);
      expect(await issues(again.syncRunId)).toHaveLength(1);
    });

    it('enforce: publishes the course once the partner sends named coordinators', async () => {
      const outcome = await harvest('enforce', [
        { personId: 'p-1', displayName: 'Course team, University of Innsbruck' },
      ]);
      const course = await courseRow(ORG.uibk, '703001');
      expect(course).toMatchObject({
        status: 'published',
        instructors: ['Course team, University of Innsbruck'],
      });
      expect(await issues(outcome.syncRunId)).toEqual([]);
      expect((await statusAudits(course.id)).at(-1)?.changes).toMatchObject({
        status: { from: 'draft', to: 'published' },
        publish_rule: 'enforce',
      });
      expect((await runDetail(outcome.syncRunId!)).detail.handbook_incomplete).toBe(0);
    });
  });

  describe('publication rule on CSV uploads (Channel B)', () => {
    const COURSES_HEADER =
      'template_version,course_code,status,ects,isced_codes,title_en,levels,contact_email,instructors,description_en,learning_outcomes_en,prerequisites_en,assessment_en,methods_en';
    const OFFERINGS_HEADER =
      'template_version,course_code,offering_code,status,start_date,end_date,teaching_languages,delivery_modes,enrol_start_date,application_deadline';
    const courseLine = (code: string, assessment: string) =>
      `1.2,${code},published,5,0613,Glaciology,master,ice@urv.example,"Course team, Rovira i Virgili University",Ice.,Read ice.,None.,${assessment},Fieldwork.`;
    const offeringLine = (code: string, status = 'published') =>
      `1.2,${code},2027S,${status},2027-03-01,2027-06-30,en,online,2026-12-01,2027-02-01`;

    async function csvApp(mode: PublishRuleMode) {
      const moduleRef = await Test.createTestingModule({
        controllers: [UploadsController],
        providers: [
          { provide: KYSELY, useValue: tdb.db },
          { provide: AdminTokenVerifier, useValue: tokens.verifier },
          { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
          { provide: PUBLISH_RULE, useValue: mode },
          AdminJwtGuard,
          OrganizationAccess,
          UploadsService,
          CsvUploadInterceptor,
          CsvIngestionService,
          CsvAdapter,
          CanonicalWriter,
          SyncRunsRepository,
          {
            provide: UploadStorage,
            useValue: new UploadStorage(configStub({ OECP_UPLOADS_DIR: uploadsDir })),
          },
          { provide: CsvQueue, useValue: { enqueue: async () => undefined } },
          { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        ],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      apps.push(app);
      return (files: { courses?: string; offerings?: string }) => {
        let req = request(app.getHttpServer())
          .post(`/api/admin/v1/organizations/${ORG.urv}/uploads`)
          .set('Authorization', alliance);
        if (files.courses !== undefined) {
          req = req.attach('courses', Buffer.from(files.courses), 'courses.csv');
        }
        if (files.offerings !== undefined) {
          req = req.attach('offerings', Buffer.from(files.offerings), 'offerings.csv');
        }
        return req.expect(201);
      };
    }

    it('warn: publishes complete and incomplete courses; warns about the incomplete one', async () => {
      const upload = await csvApp('warn');
      const response = await upload({
        courses: `${COURSES_HEADER}\n${courseLine('W-OK', 'Exam.')}\n${courseLine('W-GAP', '')}\n`,
        offerings: `${OFFERINGS_HEADER}\n${offeringLine('W-OK')}\n${offeringLine('W-GAP')}\n`,
      });
      expect(response.body.status).toBe('succeeded');
      expect(response.body.warnings).toEqual([
        {
          code: 'oecp.content.handbook_incomplete',
          severity: 'warning',
          file: 'courses',
          row: 3,
          message:
            'W-GAP: Course is missing fields the Aurora IT Handbook requires to publish: texts.en.assessment',
        },
      ]);
      expect(await issues(response.body.sync_run_id)).toHaveLength(1);
      expect((await courseRow(ORG.urv, 'W-OK')).status).toBe('published');
      expect((await courseRow(ORG.urv, 'W-GAP')).status).toBe('published');
    });

    it('enforce: stores the incomplete course as draft and never fails the upload', async () => {
      const upload = await csvApp('enforce');
      const response = await upload({
        courses: `${COURSES_HEADER}\n${courseLine('E-OK', 'Exam.')}\n${courseLine('E-GAP', '')}\n`,
        offerings: `${OFFERINGS_HEADER}\n${offeringLine('E-OK')}\n${offeringLine('E-GAP')}\n`,
      });
      expect(response.body).toMatchObject({ status: 'succeeded', run: { n_created: 4 } });
      expect(response.body.warnings.map((w: { message: string }) => w.message)).toEqual([
        'E-GAP: Course is missing fields the Aurora IT Handbook requires to publish: texts.en.assessment',
      ]);
      expect((await courseRow(ORG.urv, 'E-OK')).status).toBe('published');
      expect((await courseRow(ORG.urv, 'E-GAP')).status).toBe('draft');

      // An offerings-only upload that leaves no published offering unpublishes E-OK…
      const withdrawn = await upload({
        offerings: `${OFFERINGS_HEADER}\n${offeringLine('E-OK', 'withdrawn')}\n`,
      });
      expect(withdrawn.body.warnings).toEqual([
        expect.objectContaining({
          code: 'oecp.content.handbook_incomplete',
          file: 'offerings',
          message: expect.stringMatching(/^E-OK: .*: offerings$/),
        }),
      ]);
      expect((await courseRow(ORG.urv, 'E-OK')).status).toBe('draft');
      // …and re-publishing needs the course row again (offerings never publish a course).
      await upload({ offerings: `${OFFERINGS_HEADER}\n${offeringLine('E-OK')}\n` });
      expect((await courseRow(ORG.urv, 'E-OK')).status).toBe('draft');
      const republished = await upload({
        courses: `${COURSES_HEADER}\n${courseLine('E-OK', 'Exam.')}\n`,
      });
      expect(republished.body.warnings).toEqual([]);
      expect((await courseRow(ORG.urv, 'E-OK')).status).toBe('published');
    });
  });

  describe('publication rule on the web form (Channel C) and the admin API', () => {
    const api = '/api/admin/v1';
    const body = (extId: string, patch: Record<string, unknown> = {}) => ({
      ext_id: extId,
      status: 'published',
      levels: ['master'],
      ects: 5,
      isced_codes: [{ code: '0613' }],
      contact_email: 'form@aurora.example',
      instructors: ['Course team, University of Iceland'],
      texts: {
        en: {
          title: 'Volcanology',
          description: 'Lava.',
          learning_outcomes: 'Read seismographs.',
          prerequisites: 'Geology.',
          assessment: 'Field report.',
          mode_of_repetition: 'Every summer.',
          privacy_notice: 'Field trips are photographed.',
        },
      },
      ...patch,
    });
    const offering = {
      ext_offering_id: '2027S',
      status: 'published',
      start_date: '2027-03-01',
      end_date: '2027-06-30',
      enrol_start_date: '2026-12-01',
      application_deadline: '2027-02-01',
      teaching_languages: ['en'],
      delivery_modes: ['online'],
    };

    async function formApp(mode: PublishRuleMode) {
      const moduleRef = await Test.createTestingModule({
        controllers: [CoursesController],
        providers: [
          { provide: KYSELY, useValue: tdb.db },
          { provide: AdminTokenVerifier, useValue: tokens.verifier },
          { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
          { provide: PUBLISH_RULE, useValue: mode },
          AdminJwtGuard,
          OrganizationAccess,
          CoursesService,
          CoursesRepository,
          CanonicalWriter,
          CsvAdapter,
          { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        ],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      apps.push(app);
      const http = () => request(app.getHttpServer());
      return {
        get: (url: string) => http().get(`${api}${url}`).set('Authorization', alliance),
        post: (url: string, payload: object) =>
          http().post(`${api}${url}`).set('Authorization', alliance).send(payload),
      };
    }
    const lastFormRun = () =>
      tdb.db
        .selectFrom('sync_runs')
        .select('id')
        .where('channel', '=', 'form')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow();

    it('warn: publishes, records the warning in the form run and exposes completeness', async () => {
      const form = await formApp('warn');
      const created = adminCourse.parse(
        (await form.post(`/organizations/${ORG.aurora}/courses`, body('F-WARN')).expect(201)).body,
      );
      expect(created).toMatchObject({
        status: 'published',
        instructors: ['Course team, University of Iceland'],
        completeness: { complete: false, missing: ['offerings'] },
      });
      expect(created.texts['en']).toMatchObject({
        mode_of_repetition: 'Every summer.',
        privacy_notice: 'Field trips are photographed.',
        methods: null,
      });
      expect(await issues((await lastFormRun()).id)).toEqual([
        expect.objectContaining({ ext_id: 'F-WARN', severity: 'warning' }),
      ]);
      await form.post(`/courses/${created.id}/offerings`, offering).expect(201);
      const complete = adminCourse.parse(
        (await form.get(`/courses/${created.id}`).expect(200)).body,
      );
      expect(complete.completeness).toEqual({ complete: true, missing: [] });
      expect(await issues((await lastFormRun()).id)).toEqual([]);

      const list = adminCourseList.parse(
        (await form.get(`/organizations/${ORG.aurora}/courses?q=F-WARN`).expect(200)).body,
      );
      expect(list.items.map((i) => [i.ext_id, i.complete])).toEqual([['F-WARN', true]]);
    });

    it('enforce: holds the course as draft until it is complete and published again', async () => {
      const form = await formApp('enforce');
      const created = adminCourse.parse(
        (await form.post(`/organizations/${ORG.aurora}/courses`, body('F-ENF')).expect(201)).body,
      );
      expect(created).toMatchObject({
        status: 'draft',
        completeness: { complete: false, missing: ['offerings'] },
      });
      expect(await issues((await lastFormRun()).id)).toHaveLength(1);
      const list = adminCourseList.parse(
        (await form.get(`/organizations/${ORG.aurora}/courses?q=F-ENF`).expect(200)).body,
      );
      expect(list.items[0]?.complete).toBe(false);

      // An offering save never publishes the course…
      const saved = (await form.post(`/courses/${created.id}/offerings`, offering).expect(201))
        .body as { id: string };
      expect((await courseRow(ORG.aurora, 'F-ENF')).status).toBe('draft');
      // …publishing it again does, now that it is complete.
      const published = adminCourse.parse(
        (await form.post(`/courses/${created.id}/status`, { status: 'published' }).expect(200))
          .body,
      );
      expect(published).toMatchObject({
        status: 'published',
        completeness: { complete: true, missing: [] },
      });

      // Withdrawing the only offering unpublishes it, visibly in the history.
      await form.post(`/offerings/${saved.id}/status`, { status: 'withdrawn' }).expect(200);
      expect((await courseRow(ORG.aurora, 'F-ENF')).status).toBe('draft');
      const history = adminCourseHistory.parse(
        (await form.get(`/courses/${created.id}/history`).expect(200)).body,
      );
      expect(history.items.map((h) => h.summary)).toContain(
        'Status published → draft: IT Handbook fields missing (offerings)',
      );
      const audit = await tdb.db
        .selectFrom('audit_log')
        .select('changes')
        .where('action', '=', 'course_offering.status')
        .where('entity_id', '=', saved.id)
        .where(sql<string>`changes->>'channel'`, '=', 'form')
        .executeTakeFirstOrThrow();
      expect(audit.changes).toMatchObject({
        channel: 'form',
        publish_rule: { mode: 'enforce', status: 'draft', missing: ['offerings'] },
      });
    });

    it('enforce: a form save without instructors on a complete course keeps it draft', async () => {
      const form = await formApp('enforce');
      const created = adminCourse.parse(
        (
          await form
            .post(`/organizations/${ORG.aurora}/courses`, body('F-NOI', { status: 'draft' }))
            .expect(201)
        ).body,
      );
      await form.post(`/courses/${created.id}/offerings`, offering).expect(201);
      const put = await request(apps.at(-1)!.getHttpServer())
        .put(`${api}/courses/${created.id}`)
        .set('Authorization', alliance)
        .send(body('F-NOI', { instructors: [] }))
        .expect(200);
      expect(adminCourse.parse(put.body)).toMatchObject({
        status: 'draft',
        instructors: [],
        completeness: { complete: false, missing: ['instructors'] },
      });
    });
  });
});
