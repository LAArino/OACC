// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { adminCsvReference } from '@oecp/schemas';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';
import {
  KyselyOrganizationDirectory,
  ORGANIZATION_DIRECTORY,
} from '../../src/admin/auth/organization-directory.js';
import { OrganizationAccess } from '../../src/admin/integrations/organization-access.js';
import { CsvUploadInterceptor } from '../../src/admin/uploads/csv-upload.interceptor.js';
import { UploadsController } from '../../src/admin/uploads/uploads.controller.js';
import { UploadsService } from '../../src/admin/uploads/uploads.service.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { KYSELY } from '../../src/db/db.module.js';
import { CanonicalWriter } from '../../src/ingestion/canonical-writer.service.js';
import { CsvIngestionService } from '../../src/ingestion/csv/csv-ingestion.service.js';
import { CsvRetentionService } from '../../src/ingestion/csv/csv-retention.service.js';
import { CsvAdapter } from '../../src/ingestion/csv/csv.adapter.js';
import { CsvQueue } from '../../src/ingestion/csv/csv.queue.js';
import { UploadStorage } from '../../src/ingestion/csv/upload-storage.js';
import { SyncRunsRepository } from '../../src/ingestion/sync-runs.repository.js';
import { BASE_CLAIMS, createTestTokens } from '../support/admin-tokens.js';
import { seedAttributeDefinitions } from '../support/attribute-definitions.js';
import { configStub } from '../support/config-stub.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const PARTNER_SUB = '11111111-1111-4111-8111-111111111111';
const ALLIANCE_SUB = '22222222-2222-4222-8222-222222222222';

const fixture = (file: 'courses' | 'offerings') =>
  readFileSync(
    new URL(`../fixtures/csv/aurora-virtual-campus.${file}.csv`, import.meta.url),
    'utf8',
  );

const COURSES_HEADER = 'template_version,course_code,status,ects,isced_codes,title_en';
const OFFERINGS_HEADER =
  'template_version,course_code,offering_code,status,start_date,end_date,teaching_languages,delivery_modes';

describe.runIf(describeWithDatabase === 'run')('CSV uploads (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let app: INestApplication;
  let uploadsDir: string;
  let ingestion: CsvIngestionService;
  let retention: CsvRetentionService;
  const queue = { enqueue: vi.fn(async (_id: string) => undefined) };
  const auth = { partner: '', alliance: '' };
  const http = () => request(app.getHttpServer());
  const uploadUrl = (org: string) => `/api/admin/v1/organizations/${org}/uploads`;

  const upload = (
    org: string,
    files: { courses?: string; offerings?: string },
    token = auth.alliance,
  ) => {
    let req = http().post(uploadUrl(org)).set('Authorization', token);
    if (files.courses !== undefined) {
      req = req.attach('courses', Buffer.from(files.courses, 'utf8'), 'courses.csv');
    }
    if (files.offerings !== undefined) {
      req = req.attach('offerings', Buffer.from(files.offerings, 'utf8'), 'offerings.csv');
    }
    return req;
  };

  const count = async (table: 'courses' | 'course_offerings', org: string) => {
    const q =
      table === 'courses'
        ? tdb.db.selectFrom('courses').where('organization_id', '=', org)
        : tdb.db
            .selectFrom('course_offerings')
            .innerJoin('courses', 'courses.id', 'course_offerings.course_id')
            .where('courses.organization_id', '=', org);
    return Number((await q.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n);
  };

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    tdb = await createTestDatabase();
    uploadsDir = mkdtempSync(join(tmpdir(), 'oecp-uploads-'));
    const tokens = await createTestTokens();
    const storage = new UploadStorage(configStub({ OECP_UPLOADS_DIR: uploadsDir }));
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        { provide: KYSELY, useValue: tdb.db },
        { provide: AdminTokenVerifier, useValue: tokens.verifier },
        { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
        AdminJwtGuard,
        OrganizationAccess,
        UploadsService,
        CsvUploadInterceptor,
        CsvIngestionService,
        CsvRetentionService,
        CsvAdapter,
        CanonicalWriter,
        SyncRunsRepository,
        { provide: UploadStorage, useValue: storage },
        { provide: CsvQueue, useValue: queue },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ingestion = moduleRef.get(CsvIngestionService);
    retention = moduleRef.get(CsvRetentionService);
    auth.partner = `Bearer ${await tokens.sign(
      { ...BASE_CLAIMS, roles: ['partner_admin'], org_id: ORG.urv, idp: 'urv' },
      PARTNER_SUB,
    )}`;
    auth.alliance = `Bearer ${await tokens.sign(
      { ...BASE_CLAIMS, roles: ['alliance_admin'], org_id: ORG.aurora },
      ALLIANCE_SUB,
    )}`;
    await seedAttributeDefinitions(tdb.db);
    // UIBK harvests over OEAPI: CSV is refused there (spec §6.5).
    await tdb.db
      .insertInto('partner_integrations')
      .values({
        organization_id: ORG.uibk,
        authoritative_channel: 'oeapi',
        access_mode: 'direct',
        base_url: 'https://oeapi.uibk.example',
      })
      .execute();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await tdb?.drop();
    if (uploadsDir) rmSync(uploadsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    queue.enqueue.mockClear();
  });

  it('requires a bearer token', async () => {
    await http().post(uploadUrl(ORG.aurora)).expect(401);
  });

  it('uploads the Aurora Virtual Campus listing: courses, texts, sessions, offerings, history', async () => {
    const response = await upload(ORG.aurora, {
      courses: fixture('courses'),
      offerings: fixture('offerings'),
    }).expect(201);
    expect(response.body).toMatchObject({
      status: 'succeeded',
      processed_inline: true,
      run: {
        channel: 'csv',
        trigger_kind: 'upload',
        schema_version: 'csv-1.3',
        triggered_by: ALLIANCE_SUB,
        n_created: 16,
        n_updated: 0,
        n_unchanged: 0,
        is_complete: true,
      },
    });
    // Decision 21c (OECP_PUBLISH_RULE=warn): the listing lacks outcomes, assessment and a
    // contact, so every course is published with oecp.content.handbook_incomplete.
    const warnings = response.body.warnings as { code: string; row: number; message: string }[];
    expect(warnings.map((w) => [w.code, w.row])).toEqual(
      [2, 3, 4, 5, 6, 7, 8, 9].map((row) => ['oecp.content.handbook_incomplete', row]),
    );
    expect(warnings[3]?.message).toBe(
      'AVC-SPARK-SOCIAL: Course is missing fields the Aurora IT Handbook requires to publish: ' +
        'texts.en.learning_outcomes, texts.en.assessment, contact_email',
    );
    const runId: string = response.body.sync_run_id;
    expect(response.headers['location']).toBe(`/api/admin/v1/sync-runs/${runId}`);

    const run = await tdb.db
      .selectFrom('sync_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(run.upload_object_key).toBe(`${ORG.aurora}/${runId}`);
    expect(existsSync(join(uploadsDir, ORG.aurora, runId, 'courses.csv'))).toBe(true);
    expect(existsSync(join(uploadsDir, ORG.aurora, runId, 'offerings.csv'))).toBe(true);

    expect(await count('courses', ORG.aurora)).toBe(8);
    expect(await count('course_offerings', ORG.aurora)).toBe(8);
    const course = await tdb.db
      .selectFrom('courses')
      .selectAll()
      .where('organization_id', '=', ORG.aurora)
      .where('ext_id', '=', 'AVC-SPARK-SOCIAL')
      .executeTakeFirstOrThrow();
    expect(course).toMatchObject({
      source_channel: 'csv',
      source_ref: null,
      status: 'published',
      instructors: ['Course team, University of Iceland'],
      kind: 'bip',
      level: 'master',
      levels: ['master', 'bachelor'],
      eqf_level: 7,
      attributes: {
        educational_hub: ['social_entrepreneurship_innovation'],
        sdg: ['sdg08', 'sdg09'],
        micro_credential: false,
        free_course: true,
        enrolled_only: true,
        open_to_alliance: true,
        target_audience: ['students'],
      },
    });
    expect(Number(course.ects)).toBe(6);
    const text = await tdb.db
      .selectFrom('course_texts')
      .selectAll()
      .where('course_id', '=', course.id)
      .executeTakeFirstOrThrow();
    expect(text).toMatchObject({
      lang: 'en',
      title: 'BIP: Spark Social',
      keywords: ['social innovation', 'entrepreneurship', 'BIP'],
      methods: 'Online sessions combined with a short physical mobility.',
      remarks: 'Hosted by the University of Iceland.',
      mode_of_repetition: null,
      literature: null,
      privacy_notice: null,
    });
    const isced = await tdb.db
      .selectFrom('course_isced_codes')
      .selectAll()
      .where('course_id', '=', course.id)
      .orderBy('is_primary', 'desc')
      .execute();
    expect(isced.map((r) => [r.isced_code, r.is_primary])).toEqual([
      ['0413', true],
      ['0319', false],
    ]);
    const offering = await tdb.db
      .selectFrom('course_offerings')
      .innerJoin(
        'academic_sessions',
        'academic_sessions.id',
        'course_offerings.academic_session_id',
      )
      .select([
        'course_offerings.timezone',
        'course_offerings.teaching_languages',
        'course_offerings.application_url',
        'course_offerings.application_deadline',
        'course_offerings.application_instructions',
        'academic_sessions.ext_id as session',
      ])
      .where('course_offerings.course_id', '=', course.id)
      .executeTakeFirstOrThrow();
    expect(offering).toEqual({
      timezone: 'Atlantic/Reykjavik',
      teaching_languages: ['en'],
      application_url: null,
      application_deadline: '2026-11-15',
      application_instructions: {
        en: expect.stringMatching(/^Apply through the Aurora office of your home university/),
      },
      session: 'AUR-2026-27-S2',
    });
    const kinds = await tdb.db
      .selectFrom('courses')
      .select(['kind', sql<string>`count(*)`.as('n')])
      .where('organization_id', '=', ORG.aurora)
      .groupBy('kind')
      .orderBy('kind')
      .execute();
    expect(kinds.map((k) => [k.kind, Number(k.n)])).toEqual([
      ['bip', 2],
      ['course', 5],
      ['lecture_series', 1],
    ]);
    const sessions = await tdb.db
      .selectFrom('academic_sessions')
      .selectAll()
      .where('organization_id', '=', ORG.aurora)
      .orderBy('ext_id')
      .execute();
    expect(sessions.map((s) => [s.ext_id, s.start_date, s.end_date, s.session_type])).toEqual([
      ['AUR-2026-27-S1', '2026-10-20', '2027-01-31', 'period'],
      ['AUR-2026-27-S2', '2027-01-12', '2027-05-15', 'period'],
    ]);
    // Offerings without a timezone column value get the organization's default.
    const defaults = await tdb.db
      .selectFrom('course_offerings')
      .select('timezone')
      .where('ext_offering_id', '=', '2026-27-S1')
      .execute();
    expect(new Set(defaults.map((r) => r.timezone))).toEqual(new Set(['Europe/Brussels']));

    const history = await tdb.db
      .selectFrom('ext_metadata_history')
      .select(['entity_type', 'channel', 'schema_version', 'raw_payload'])
      .where('sync_run_id', '=', runId)
      .execute();
    expect(history.filter((h) => h.entity_type === 'course')).toHaveLength(8);
    expect(history.filter((h) => h.entity_type === 'course_offering')).toHaveLength(8);
    expect(history.filter((h) => h.entity_type === 'academic_session')).toHaveLength(2);
    expect(history.every((h) => h.channel === 'csv' && h.schema_version === 'csv-1.3')).toBe(true);
    expect(history.find((h) => h.entity_type === 'course')?.raw_payload).toMatchObject({
      template_version: '1.2',
    });
    const recorded = await tdb.db
      .selectFrom('sync_errors')
      .select(['code', 'severity', 'entity_type', 'ext_id'])
      .where('sync_run_id', '=', runId)
      .orderBy('id')
      .execute();
    expect(recorded).toHaveLength(8);
    expect(recorded[0]).toEqual({
      code: 'oecp.content.handbook_incomplete',
      severity: 'warning',
      entity_type: 'course',
      ext_id: 'AVC-BIP-AI-ETHICS',
    });

    const audit = await tdb.db
      .selectFrom('audit_log')
      .select(['action', 'actor_sub'])
      .where('entity_id', '=', runId)
      .orderBy('id')
      .execute();
    expect(audit).toEqual([
      { action: 'upload.create', actor_sub: ALLIANCE_SUB },
      { action: 'upload.processed', actor_sub: ALLIANCE_SUB },
    ]);
  });

  it('re-uploading unchanged files changes nothing', async () => {
    const before = Number(
      (
        await tdb.db
          .selectFrom('ext_metadata_history')
          .select(sql<string>`count(*)`.as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
    const response = await upload(ORG.aurora, {
      courses: fixture('courses'),
      offerings: fixture('offerings'),
    }).expect(201);
    expect(response.body.run).toMatchObject({ n_created: 0, n_updated: 0, n_unchanged: 16 });
    const after = Number(
      (
        await tdb.db
          .selectFrom('ext_metadata_history')
          .select(sql<string>`count(*)`.as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
    expect(after).toBe(before);
  });

  it('withdraws a course only through its status column; omission never withdraws', async () => {
    const response = await upload(ORG.aurora, {
      courses: `${COURSES_HEADER}\n1.0,AVC-SUST-EDU,withdrawn,5,0111|0521,Sustainability Education and Learning\n`,
    }).expect(201);
    expect(response.body.run).toMatchObject({ n_updated: 1, n_created: 0 });
    const rows = await tdb.db
      .selectFrom('courses')
      .select(['ext_id', 'status'])
      .where('organization_id', '=', ORG.aurora)
      .execute();
    expect(rows.find((r) => r.ext_id === 'AVC-SUST-EDU')?.status).toBe('withdrawn');
    expect(rows.filter((r) => r.status === 'published')).toHaveLength(7);
    // Columns absent from the header (abstract_en, keywords_en, level…) are untouched.
    const kept = await tdb.db
      .selectFrom('courses')
      .innerJoin('course_texts', 'course_texts.course_id', 'courses.id')
      .select(['courses.level', 'course_texts.abstract'])
      .where('courses.ext_id', '=', 'AVC-SUST-EDU')
      .executeTakeFirstOrThrow();
    expect(kept.level).toBe('master');
    expect(kept.abstract).toMatch(/^Graduate course/);
    // A 1.0 row leaves kind, levels, attributes and instructors as they were.
    const attributes = await tdb.db
      .selectFrom('courses')
      .select(['kind', 'levels', 'attributes', 'instructors'])
      .where('ext_id', '=', 'AVC-SUST-EDU')
      .executeTakeFirstOrThrow();
    expect(attributes).toMatchObject({
      kind: 'course',
      instructors: ['Course team, host university'],
      levels: ['master'],
      attributes: { competence_framework: 'louis', micro_credential: true },
    });
    const audit = await tdb.db
      .selectFrom('audit_log')
      .select(['action', 'changes'])
      .where('action', '=', 'course.status')
      .execute();
    expect(audit[0]?.changes).toMatchObject({ status: { from: 'published', to: 'withdrawn' } });
  });

  it('deletes a language whose cells are all empty and keeps languages absent from the header', async () => {
    const header = `${COURSES_HEADER},title_de,title_fr`;
    await upload(
      ORG.urv,
      {
        courses: `${header}\n1.0,URV-1,draft,6,0613,Data science,Datenwissenschaft,Science des données\n`,
      },
      auth.partner,
    ).expect(201);
    await upload(
      ORG.urv,
      {
        courses: `${COURSES_HEADER},title_de\n1.0,URV-1,draft,6,0613,Data science,\n`,
      },
      auth.partner,
    ).expect(201);
    const langs = await tdb.db
      .selectFrom('course_texts')
      .innerJoin('courses', 'courses.id', 'course_texts.course_id')
      .select('lang')
      .where('courses.ext_id', '=', 'URV-1')
      .orderBy('lang')
      .execute();
    expect(langs.map((r) => r.lang)).toEqual(['en', 'fr']);
  });

  it('fails an invalid upload with row/column errors and writes nothing', async () => {
    const response = await upload(
      ORG.urv,
      {
        courses: `${COURSES_HEADER}\n1.0,URV-2,published,6,0613,Valid\n1.0,URV-3,live,6,0613,Bad status\n`,
        offerings: `${OFFERINGS_HEADER}\n1.0,URV-2,A,published,2027-02-30,2027-06-30,en,online\n1.0,NOPE,B,published,2027-02-01,2027-06-30,en,teleport\n`,
      },
      auth.partner,
    ).expect(422);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    const runId: string = response.body.sync_run_id;
    expect(response.body).toMatchObject({
      type: '/problems/validation-failed',
      title: 'Upload validation failed',
      status: 422,
      instance: `/api/admin/v1/sync-runs/${runId}`,
      run_status: 'failed',
      processed_inline: true,
      error_count: 4,
    });
    expect(
      response.body.errors.map((e: Record<string, unknown>) => [e.file, e.row, e.column, e.code]),
    ).toEqual([
      ['courses', 3, 'status', 'oecp.csv.invalid_status'],
      ['offerings', 2, 'start_date', 'oecp.csv.invalid_date'],
      ['offerings', 3, 'course_code', 'oecp.content.unknown_course'],
      ['offerings', 3, 'delivery_modes', 'oecp.content.unknown_delivery_mode'],
    ]);
    expect(
      await tdb.db.selectFrom('courses').select('id').where('ext_id', '=', 'URV-2').execute(),
    ).toEqual([]);
    const run = await tdb.db
      .selectFrom('sync_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(run).toMatchObject({
      status: 'failed',
      n_created: 0,
      n_rejected: 3,
      is_complete: false,
    });
    expect(run.error_summary).toMatch(/4 error\(s\).*nothing was written/);
    const errors = await tdb.db
      .selectFrom('sync_errors')
      .select(['file', 'row_number', 'column_name', 'code', 'severity'])
      .where('sync_run_id', '=', runId)
      .orderBy('id')
      .execute();
    expect(errors[0]).toEqual({
      file: 'courses',
      row_number: 3,
      column_name: 'status',
      code: 'oecp.csv.invalid_status',
      severity: 'error',
    });
    expect(errors).toHaveLength(4);
  });

  it('updates attributes per column and rejects values outside the definitions', async () => {
    const header = `${COURSES_HEADER},kind,levels,attr_free_course,attr_sdg`;
    const ok = await upload(ORG.aurora, {
      courses: `${header}
1.1,AVC-GIS-SOCIETY,published,5,0532|0312,Analysing societal challenges using Geographical Information Systems,lecture_series,master,no,sdg13
`,
    }).expect(201);
    expect(ok.body.run).toMatchObject({ n_updated: 1 });
    const course = await tdb.db
      .selectFrom('courses')
      .select(['kind', 'level', 'levels', 'attributes'])
      .where('ext_id', '=', 'AVC-GIS-SOCIETY')
      .executeTakeFirstOrThrow();
    expect(course).toEqual({
      kind: 'lecture_series',
      level: 'master',
      levels: ['master'],
      attributes: {
        educational_hub: ['sustainability_climate_change', 'digital_society_global_citizenship'],
        sdg: ['sdg13'],
        micro_credential: false,
        free_course: false,
        enrolled_only: true,
        open_to_alliance: true,
        target_audience: ['students'],
      },
    });

    const bad = await upload(ORG.aurora, {
      courses: `${header},attr_hub
1.1,AVC-GIS-SOCIETY,published,5,0532,GIS,course,master,maybe,sdg18,x
`,
    }).expect(422);
    expect(bad.body.errors.map((e: Record<string, unknown>) => [e.row, e.column, e.code])).toEqual([
      [1, 'attr_hub', 'oecp.content.unknown_attribute'],
      [2, 'attr_free_course', 'oecp.content.invalid_attribute_value'],
      [2, 'attr_sdg', 'oecp.content.unknown_attribute_option'],
    ]);
    const unchanged = await tdb.db
      .selectFrom('courses')
      .select('kind')
      .where('ext_id', '=', 'AVC-GIS-SOCIETY')
      .executeTakeFirstOrThrow();
    expect(unchanged.kind).toBe('lecture_series');
  });

  it('rejects files that are not UTF-8', async () => {
    const response = await http()
      .post(uploadUrl(ORG.urv))
      .set('Authorization', auth.partner)
      .attach('courses', Buffer.from([0x74, 0xed, 0x74, 0x0a]), 'courses.csv')
      .expect(422);
    expect(response.body.errors[0]).toMatchObject({ code: 'oecp.csv.encoding', file: 'courses' });
  });

  it('refuses CSV for an organization whose authoritative channel is oeapi', async () => {
    const response = await upload(ORG.uibk, { courses: fixture('courses') }).expect(409);
    expect(response.body.errors[0].code).toBe('oecp.sync.channel_disabled');
  });

  it('scopes partner_admins to their organization', async () => {
    const response = await upload(ORG.aurora, { courses: fixture('courses') }, auth.partner).expect(
      403,
    );
    expect(response.body.errors[0].code).toBe('oecp.auth.forbidden_organization');
  });

  it('validates the multipart request', async () => {
    const none = await http()
      .post(uploadUrl(ORG.urv))
      .set('Authorization', auth.partner)
      .expect(400);
    expect(none.body.errors[0].code).toBe('oecp.csv.no_files');
    const unexpected = await http()
      .post(uploadUrl(ORG.urv))
      .set('Authorization', auth.partner)
      .attach('programmes', Buffer.from('a\n'), 'programmes.csv')
      .expect(400);
    expect(unexpected.body.errors[0].code).toBe('oecp.csv.unexpected_file');
    const big = await http()
      .post(uploadUrl(ORG.urv))
      .set('Authorization', auth.partner)
      .attach('courses', Buffer.alloc(5 * 1024 * 1024 + 1, 0x61), 'courses.csv')
      .expect(413);
    expect(big.body.errors[0].code).toBe('oecp.csv.file_too_large');
  });

  it('queues uploads above 500 rows for the worker', async () => {
    const lines = Array.from(
      { length: 501 },
      (_, i) => `1.0,BULK-${i},draft,3,0613,Bulk course ${i}`,
    );
    const response = await upload(
      ORG.urv,
      {
        courses: `${COURSES_HEADER}\n${lines.join('\n')}\n`,
      },
      auth.partner,
    ).expect(202);
    expect(response.body).toEqual({
      sync_run_id: expect.any(String),
      status: 'queued',
      processed_inline: false,
    });
    expect(queue.enqueue).toHaveBeenCalledWith(response.body.sync_run_id);
    const outcome = await ingestion.process(response.body.sync_run_id);
    expect(outcome).toMatchObject({ status: 'succeeded', counters: { n_created: 501 } });
    // A second delivery of the job is a no-op.
    expect((await ingestion.process(response.body.sync_run_id)).status).toBe('skipped');
  }, 60_000);

  it('sets Location also when the queue is unavailable (503, run cancelled)', async () => {
    queue.enqueue.mockRejectedValueOnce(new Error('valkey down'));
    const lines = Array.from({ length: 501 }, (_, i) => `1.0,DOWN-${i},draft,3,0613,Down ${i}`);
    const response = await upload(ORG.urv, {
      courses: `${COURSES_HEADER}\n${lines.join('\n')}\n`,
    }).expect(503);
    const location = String(response.headers['location']);
    expect(location).toMatch(/^\/api\/admin\/v1\/sync-runs\/[0-9a-f-]{36}$/);
    const run = await tdb.db
      .selectFrom('sync_runs')
      .select('status')
      .where('id', '=', location.split('/').pop() ?? '')
      .executeTakeFirstOrThrow();
    expect(run.status).toBe('cancelled');
  });

  it('revives soft-deleted courses and offerings written again, like the form', async () => {
    const courses = `${COURSES_HEADER}\n1.0,REVIVE-1,draft,3,0613,Revived course\n`;
    const offerings = `${OFFERINGS_HEADER}\n1.0,REVIVE-1,R1-2027,draft,2027-03-01,2027-06-30,en,online\n`;
    await upload(ORG.urv, { courses, offerings }).expect(201);
    const course = await tdb.db
      .selectFrom('courses')
      .select('id')
      .where('organization_id', '=', ORG.urv)
      .where('ext_id', '=', 'REVIVE-1')
      .executeTakeFirstOrThrow();
    await tdb.db
      .updateTable('courses')
      .set({
        deleted_at: new Date(),
        overrides: { ects: { value: 9, by: 'x', at: 'y', source: 3 } },
      })
      .where('id', '=', course.id)
      .execute();
    await tdb.db
      .updateTable('course_offerings')
      .set({ deleted_at: new Date() })
      .where('course_id', '=', course.id)
      .execute();

    const again = await upload(ORG.urv, {
      courses: courses.replace('Revived course', 'Revived again'),
      offerings,
    }).expect(201);
    expect(again.body.run).toMatchObject({ n_created: 2, n_updated: 0 });
    const revived = await tdb.db
      .selectFrom('courses')
      .select(['deleted_at', 'overrides', 'ects'])
      .where('id', '=', course.id)
      .executeTakeFirstOrThrow();
    expect(revived).toMatchObject({ deleted_at: null, overrides: {} });
    expect(Number(revived.ects)).toBe(3);
    const offering = await tdb.db
      .selectFrom('course_offerings')
      .select(['id', 'deleted_at'])
      .where('course_id', '=', course.id)
      .executeTakeFirstOrThrow();
    expect(offering.deleted_at).toBeNull();
    const audits = await tdb.db
      .selectFrom('audit_log')
      .select(['action', 'entity_id', 'changes'])
      .where('action', 'in', ['course.revive', 'course_offering.revive'])
      .orderBy('id')
      .execute();
    expect(audits).toEqual([
      {
        action: 'course.revive',
        entity_id: course.id,
        changes: {
          ext_id: 'REVIVE-1',
          channel: 'csv',
          deleted: { from: true, to: false },
          overrides_dropped: ['ects'],
          sync_run_id: again.body.sync_run_id,
        },
      },
      {
        action: 'course_offering.revive',
        entity_id: offering.id,
        changes: {
          ext_id: 'REVIVE-1#R1-2027',
          channel: 'csv',
          deleted: { from: true, to: false },
          sync_run_id: again.body.sync_run_id,
        },
      },
    ]);
  });

  /** Ages the organization's runs out of the upload rate window (10 per hour). */
  const freshRateWindow = (org: string) =>
    sql`UPDATE sync_runs SET created_at = created_at - interval '2 hours'
      WHERE organization_id = ${org}`.execute(tdb.db);

  it('drops overrides left from an oeapi period, like the form (spec §6.5)', async () => {
    await freshRateWindow(ORG.urv);
    const courses = `${COURSES_HEADER}\n1.0,LEFTOVER-1,draft,3,0613,Leftover course\n`;
    const offerings = `${OFFERINGS_HEADER}\n1.0,LEFTOVER-1,L1-2027,draft,2027-03-01,2027-06-30,en,online\n`;
    await upload(ORG.urv, { courses, offerings }).expect(201);
    const course = await tdb.db
      .selectFrom('courses')
      .select('id')
      .where('organization_id', '=', ORG.urv)
      .where('ext_id', '=', 'LEFTOVER-1')
      .executeTakeFirstOrThrow();
    const entry = { by: 'kc-partner-admin', at: '2026-09-01T00:00:00Z' };
    // As an oeapi period would have left them (the organization is csv/form now).
    await tdb.db
      .updateTable('courses')
      .set({ ects: '9', overrides: { ects: { value: 9, source: 3, ...entry } } })
      .where('id', '=', course.id)
      .execute();
    await tdb.db
      .updateTable('course_texts')
      .set({
        title: 'Overridden',
        overrides: { title: { value: 'Overridden', source: 'Leftover course', ...entry } },
      })
      .where('course_id', '=', course.id)
      .execute();
    await tdb.db
      .updateTable('course_offerings')
      .set({
        campus: 'Tarragona',
        overrides: { campus: { value: 'Tarragona', source: null, ...entry } },
      })
      .where('course_id', '=', course.id)
      .execute();

    // The same files again: without the drop the overrides would keep masking them.
    const again = await upload(ORG.urv, { courses, offerings }).expect(201);
    expect(again.body.run).toMatchObject({ n_updated: 2, n_unchanged: 0 });
    const after = await tdb.db
      .selectFrom('courses')
      .select(['ects', 'overrides'])
      .where('id', '=', course.id)
      .executeTakeFirstOrThrow();
    expect(Number(after.ects)).toBe(3);
    expect(after.overrides).toEqual({});
    const text = await tdb.db
      .selectFrom('course_texts')
      .select(['title', 'overrides'])
      .where('course_id', '=', course.id)
      .executeTakeFirstOrThrow();
    expect(text).toEqual({ title: 'Leftover course', overrides: {} });
    const offering = await tdb.db
      .selectFrom('course_offerings')
      .select(['id', 'campus', 'overrides'])
      .where('course_id', '=', course.id)
      .executeTakeFirstOrThrow();
    // `campus` is not in the header: the field keeps the value the catalogue showed.
    expect(offering).toMatchObject({ campus: 'Tarragona', overrides: {} });
    const audits = await tdb.db
      .selectFrom('audit_log')
      .select(['action', 'entity_id', 'changes'])
      .where('action', 'in', ['course.overrides_drop', 'course_offering.overrides_drop'])
      .orderBy('id')
      .execute();
    expect(audits).toEqual([
      {
        action: 'course.overrides_drop',
        entity_id: course.id,
        changes: {
          ext_id: 'LEFTOVER-1',
          channel: 'csv',
          overrides_dropped: ['ects', 'texts.en.title'],
          sync_run_id: again.body.sync_run_id,
        },
      },
      {
        action: 'course_offering.overrides_drop',
        entity_id: offering.id,
        changes: {
          ext_id: 'LEFTOVER-1#L1-2027',
          channel: 'csv',
          overrides_dropped: ['campus'],
          sync_run_id: again.body.sync_run_id,
        },
      },
    ]);
    // A third upload finds nothing left to drop.
    const third = await upload(ORG.urv, { courses, offerings }).expect(201);
    expect(third.body.run).toMatchObject({ n_updated: 0, n_unchanged: 2 });
  });

  it('records the original file names on the run (SyncRun.files)', async () => {
    await freshRateWindow(ORG.urv);
    const courses = `${COURSES_HEADER}\n1.0,FILES-1,draft,3,0613,Files course\n`;
    const response = await http()
      .post(uploadUrl(ORG.urv))
      .set('Authorization', auth.partner)
      .attach('courses', Buffer.from(courses, 'utf8'), 'cursos-2027 (versió ñ).csv')
      .expect(201);
    expect(response.body.run.files).toEqual({ courses: 'cursos-2027 (versió ñ).csv' });
    const row = await tdb.db
      .selectFrom('sync_runs')
      .select('files')
      .where('id', '=', response.body.sync_run_id)
      .executeTakeFirstOrThrow();
    expect(row.files).toEqual({ courses: 'cursos-2027 (versió ñ).csv' });
  });

  it('serves the reference lists of the browser validator (GET /reference)', async () => {
    const own = await http()
      .get('/api/admin/v1/reference')
      .set('Authorization', auth.partner)
      .expect(200);
    expect(own.headers['cache-control']).toBe('private, max-age=60');
    expect(own.body).toMatchObject({
      organization_id: ORG.urv,
      language_tags: null,
      delivery_modes: expect.arrayContaining(['online']),
      isced_broad_fields: expect.arrayContaining(['06']),
    });
    expect(own.body.course_codes).toEqual(expect.arrayContaining(['FILES-1', 'LEFTOVER-1']));
    expect([...own.body.course_codes].sort()).toEqual(own.body.course_codes);
    expect(adminCsvReference.parse(own.body)).toEqual(own.body);
    const other = await http()
      .get(`/api/admin/v1/reference?org=${ORG.urv}`)
      .set('Authorization', auth.alliance)
      .expect(200);
    expect(other.body).toEqual(own.body);
    await http()
      .get(`/api/admin/v1/reference?org=${ORG.uibk}`)
      .set('Authorization', auth.partner)
      .expect(403);
    await http()
      .get('/api/admin/v1/reference?org=not-a-uuid')
      .set('Authorization', auth.partner)
      .expect(400);
    await http().get('/api/admin/v1/reference').expect(401);
  });

  it('limits uploads to 10 per hour per organization', async () => {
    const now = new Date();
    await tdb.db
      .insertInto('sync_runs')
      .values(
        Array.from({ length: 10 }, (_, i) => ({
          organization_id: ORG.uibkFaculty,
          channel: 'csv' as const,
          trigger_kind: 'upload' as const,
          schema_version: 'csv-1.0',
          status: 'succeeded' as const,
          created_at: new Date(now.getTime() - (50 - i) * 60_000),
        })),
      )
      .execute();
    const response = await upload(ORG.uibkFaculty, { courses: fixture('courses') }).expect(429);
    expect(response.body.errors[0].code).toBe('oecp.csv.rate_limited');
    const retryAfter = Number(response.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(9 * 60);
    expect(retryAfter).toBeLessThanOrEqual(10 * 60);
  });

  it('serves injection-safe templates and the JSON Schema', async () => {
    const courses = await http()
      .get('/api/admin/v1/csv-template/courses.csv')
      .set('Authorization', auth.partner)
      .expect(200);
    expect(courses.headers['content-type']).toMatch(/^text\/csv/);
    expect(courses.headers['content-disposition']).toBe('attachment; filename="courses.csv"');
    expect(courses.text.startsWith('\uFEFFtemplate_version,course_code,status,')).toBe(true);
    const header = courses.text.slice(1).split('\r\n')[0]!.split(',');
    expect(header).toEqual(
      expect.arrayContaining(['kind', 'levels', 'instructors', 'methods_en', 'remarks_en']),
    );
    expect(header.filter((c) => c.startsWith('attr_'))).toEqual([
      'attr_educational_hub',
      'attr_sdg',
      'attr_competence_framework',
      'attr_micro_credential',
      'attr_free_course',
      'attr_enrolled_only',
      'attr_open_to_alliance',
      'attr_target_audience',
    ]);
    expect(courses.text.split('\r\n')[1]!.startsWith('1.3,')).toBe(true);
    const offerings = await http()
      .get('/api/admin/v1/csv-template/offerings.csv')
      .set('Authorization', auth.partner)
      .expect(200);
    expect(offerings.text.split('\r\n')).toHaveLength(3);
    const schema = await http()
      .get('/api/admin/v1/csv-template/schema.json')
      .set('Authorization', auth.partner)
      .expect(200);
    expect(schema.headers['content-type']).toMatch(/^application\/schema\+json/);
    expect(schema.headers['content-disposition']).toContain('oecp-csv-1.3.schema.json');
    expect(JSON.parse(schema.text)).toMatchObject({
      $id: 'urn:oecp:schema:csv:1.3',
      $defs: { courseRow: expect.any(Object), offeringRow: expect.any(Object) },
    });
    await http().get('/api/admin/v1/csv-template/courses.csv').expect(401);
  });

  it('purges upload files after 90 days and keeps the run', async () => {
    const run = await tdb.db
      .selectFrom('sync_runs')
      .select(['id', 'upload_object_key'])
      .where('organization_id', '=', ORG.aurora)
      .where('upload_object_key', 'is not', null)
      .orderBy('created_at')
      .executeTakeFirstOrThrow();
    await tdb.db
      .updateTable('sync_runs')
      .set({ created_at: new Date(Date.now() - 91 * 86_400_000) })
      .where('id', '=', run.id)
      .execute();
    const result = await retention.purge();
    expect(result.purged).toBe(1);
    expect(existsSync(join(uploadsDir, ...(run.upload_object_key as string).split('/')))).toBe(
      false,
    );
    const after = await tdb.db
      .selectFrom('sync_runs')
      .select(['upload_object_key', 'status', 'files'])
      .where('id', '=', run.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual({
      upload_object_key: null,
      status: 'succeeded',
      files: { courses: 'courses.csv', offerings: 'offerings.csv' }, // the names stay
    });
    const audit = await tdb.db
      .selectFrom('audit_log')
      .select('actor_sub')
      .where('action', '=', 'upload.purge')
      .where('entity_id', '=', run.id)
      .execute();
    expect(audit).toEqual([{ actor_sub: 'system:retention' }]);
  });
});
