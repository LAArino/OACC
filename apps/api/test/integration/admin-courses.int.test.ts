// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  adminCourse,
  adminCourseHistory,
  adminCourseList,
  adminOffering,
  adminReference,
  type Course,
  type CourseOffering,
} from '@oecp/schemas';
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
import { OrganizationAccess } from '../../src/admin/integrations/organization-access.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { KYSELY } from '../../src/db/db.module.js';
import { CanonicalWriter } from '../../src/ingestion/canonical-writer.service.js';
import { CsvAdapter } from '../../src/ingestion/csv/csv.adapter.js';
import type { WriteContext } from '../../src/ingestion/ports/canonical-writer.js';
import { BASE_CLAIMS, createTestTokens } from '../support/admin-tokens.js';
import { seedAttributeDefinitions } from '../support/attribute-definitions.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const ALLIANCE_SUB = '22222222-2222-4222-8222-222222222222';
const URV_SUB = '33333333-3333-4333-8333-333333333333';
const UIBK_SUB = '44444444-4444-4444-8444-444444444444';

const courseBody = (patch: Record<string, unknown> = {}) => ({
  ext_id: 'AUR-DATA-1',
  kind: 'bip',
  levels: ['master', 'bachelor'],
  ects: 5,
  teaching_hours: 30,
  info_url: 'https://aurora.example/data',
  contact_email: 'data@aurora.example',
  isced_codes: [{ code: '0613', is_primary: true }, { code: '0611' }],
  attributes: { micro_credential: true },
  texts: {
    en: { title: 'Data for Good', abstract: 'Short.', keywords: ['data', 'ethics'] },
    ca: { title: 'Dades per al bé' },
  },
  ...patch,
});

const offeringBody = (patch: Record<string, unknown> = {}) => ({
  ext_offering_id: 'AUR-DATA-1-2027S',
  academic_session_ext_id: 'SS2027',
  start_date: '2027-03-01',
  end_date: '2027-06-30',
  application_deadline: '2027-02-01',
  teaching_languages: ['en', 'ca'],
  delivery_modes: ['online', 'blended'],
  max_students: 30,
  alliance_seats: 10,
  seats_available: 12,
  application_url: 'https://aurora.example/apply',
  application_instructions: { en: 'Ask your home coordinator.' },
  ...patch,
});

/** A course as the OEAPI harvester maps it (spec §6.2.4). */
const harvested = (patch: Partial<Course> = {}): Course => ({
  ext_id: 'UIBK-ML',
  source_ref: 'c-ml',
  status: 'published',
  kind: 'course',
  ects: 7.5,
  level: 'master',
  levels: ['master'],
  eqf_level: 7,
  teaching_hours: null,
  teaching_unit_ext_id: null,
  info_url: 'https://uibk.example/ml',
  contact_email: 'aurora@uibk.example',
  isced_codes: ['0613'],
  attributes: {},
  texts: {
    en: {
      title: 'Machine Learning',
      abstract: 'Learning from data.',
      description: null,
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: [],
      is_machine_translated: false,
    },
  },
  ...patch,
});

const harvestedOffering = (patch: Partial<CourseOffering> = {}): CourseOffering => ({
  course_ext_id: 'UIBK-ML',
  ext_offering_id: 'UIBK-ML-2027S',
  source_ref: 'o-ml',
  status: 'published',
  academic_session_ext_id: null,
  start_date: '2027-03-01',
  end_date: '2027-06-30',
  enrol_start_date: null,
  application_deadline: '2027-02-15',
  timezone: 'Europe/Vienna',
  teaching_languages: ['en'],
  delivery_modes: ['presential'],
  campus: 'Technik',
  max_students: 40,
  alliance_seats: null,
  seats_available: null,
  seats_updated_at: null,
  application_url: null,
  application_instructions: {},
  ...patch,
});

describe.runIf(describeWithDatabase === 'run')('Channel C, the web form (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let app: INestApplication;
  let writer: CanonicalWriter;
  const auth = { alliance: '', urv: '', uibk: '' };
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', token),
    post: (url: string, body?: object) =>
      http()
        .post(url)
        .set('Authorization', token)
        .send(body ?? {}),
    put: (url: string, body: object) => http().put(url).set('Authorization', token).send(body),
    patch: (url: string, body: object) => http().patch(url).set('Authorization', token).send(body),
    delete: (url: string) => http().delete(url).set('Authorization', token),
  });
  const api = '/api/admin/v1';

  async function harvestRun(): Promise<WriteContext> {
    const run = await tdb.db
      .insertInto('sync_runs')
      .values({
        organization_id: ORG.uibk,
        channel: 'oeapi',
        trigger_kind: 'schedule',
        schema_version: 'oeapi-5.0',
        status: 'running',
        started_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      syncRunId: run.id,
      organizationId: ORG.uibk,
      channel: 'oeapi',
      schemaVersion: 'oeapi-5.0',
      actor: 'system:harvester',
      now: new Date(),
    };
  }

  const formRuns = () =>
    tdb.db
      .selectFrom('sync_runs')
      .selectAll()
      .where('channel', '=', 'form')
      .orderBy('created_at', 'desc')
      .execute();

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    tdb = await createTestDatabase();
    const tokens = await createTestTokens();
    const moduleRef = await Test.createTestingModule({
      controllers: [CoursesController],
      providers: [
        { provide: KYSELY, useValue: tdb.db },
        { provide: AdminTokenVerifier, useValue: tokens.verifier },
        { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
        AdminJwtGuard,
        OrganizationAccess,
        CoursesService,
        CoursesRepository,
        CanonicalWriter,
        CsvAdapter,
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    writer = moduleRef.get(CanonicalWriter);
    auth.alliance = `Bearer ${await tokens.sign(
      { ...BASE_CLAIMS, roles: ['alliance_admin'], org_id: ORG.aurora },
      ALLIANCE_SUB,
    )}`;
    auth.urv = `Bearer ${await tokens.sign(
      { ...BASE_CLAIMS, roles: ['partner_admin'], org_id: ORG.urv, idp: 'urv' },
      URV_SUB,
    )}`;
    auth.uibk = `Bearer ${await tokens.sign(
      { ...BASE_CLAIMS, roles: ['partner_admin'], org_id: ORG.uibk, idp: 'uibk' },
      UIBK_SUB,
    )}`;
    await seedAttributeDefinitions(tdb.db);
    await tdb.db
      .updateTable('organizations')
      .set({ ext_id: 'INF' })
      .where('id', '=', ORG.uibkFaculty)
      .execute();
    // UIBK harvests over OEAPI: the form only stores overrides there (spec §6.5).
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
  });

  describe('reference and scope', () => {
    it('requires a bearer token', async () => {
      await http().get(`${api}/organizations/${ORG.aurora}/reference`).expect(401);
    });

    it('serves the reference of a write organization and of an OEAPI organization', async () => {
      const aurora = adminReference.parse(
        (await as(auth.alliance).get(`${api}/organizations/${ORG.aurora}/reference`).expect(200))
          .body,
      );
      expect(aurora).toMatchObject({
        organization_id: ORG.aurora,
        default_timezone: 'Europe/Brussels',
        authoritative_channel: null,
        form_mode: 'write',
        levels: ['short_cycle', 'bachelor', 'master', 'doctoral', 'other'],
        teaching_units: [],
      });
      expect(aurora.languages).toHaveLength(29);
      expect(aurora.languages[0]).toEqual({ tag: 'en', label: { en: 'English' } });
      expect(aurora.delivery_modes.map((m) => m.code)).toContain('online');
      expect(aurora.isced_broad_fields.map((f) => f.code)).toContain('06');
      expect(aurora.kinds.find((k) => k.code === 'bip')?.label.en).toMatch(/Blended/);
      expect(aurora.attribute_definitions.map((d) => d.key)).toContain('micro_credential');

      const uibk = adminReference.parse(
        (await as(auth.uibk).get(`${api}/organizations/${ORG.uibk}/reference`).expect(200)).body,
      );
      expect(uibk).toMatchObject({
        authoritative_channel: 'oeapi',
        form_mode: 'overrides',
        default_timezone: 'Europe/Vienna',
        teaching_units: [
          { id: ORG.uibkFaculty, ext_id: 'INF', name: { en: 'Faculty of Computer Science' } },
        ],
      });
    });

    it('keeps partner admins inside their organization', async () => {
      const res = await as(auth.urv).get(`${api}/organizations/${ORG.uibk}/reference`).expect(403);
      expect(res.body.errors[0].code).toBe('oecp.auth.forbidden_organization');
      await as(auth.urv)
        .post(`${api}/organizations/${ORG.aurora}/courses`, courseBody())
        .expect(403);
      await as(auth.uibk).get(`${api}/organizations/${ORG.uibkFaculty}/reference`).expect(200);
      await as(auth.alliance)
        .get(`${api}/organizations/0a000000-0000-4000-8000-0000000000ff/reference`)
        .expect(404);
    });
  });

  describe('write mode (authoritative channel form/csv)', () => {
    let courseId = '';
    let offeringId = '';

    it('creates a draft course through the canonical writer with run, audit and history', async () => {
      const res = await as(auth.alliance)
        .post(`${api}/organizations/${ORG.aurora}/courses`, courseBody())
        .expect(201);
      const course = adminCourse.parse(res.body);
      courseId = course.id;
      expect(res.headers['location']).toBe(`${api}/courses/${course.id}`);
      expect(course).toMatchObject({
        organization_id: ORG.aurora,
        ext_id: 'AUR-DATA-1',
        source_ref: null,
        source_channel: 'form',
        status: 'draft',
        kind: 'bip',
        level: 'master',
        levels: ['master', 'bachelor'],
        ects: 5,
        teaching_hours: 30,
        isced_codes: [
          { code: '0613', is_primary: true },
          { code: '0611', is_primary: false },
        ],
        attributes: { micro_credential: true },
        overrides: {},
        override_meta: {},
        source_values: {},
        offerings: [],
      });
      expect(course.texts['en']).toMatchObject({
        title: 'Data for Good',
        abstract: 'Short.',
        description: null,
        keywords: ['data', 'ethics'],
        is_machine_translated: false,
      });
      expect(Object.keys(course.texts)).toEqual(['ca', 'en']);

      const [run] = await formRuns();
      expect(run).toMatchObject({
        organization_id: ORG.aurora,
        channel: 'form',
        trigger_kind: 'form',
        triggered_by: ALLIANCE_SUB,
        schema_version: 'form-1',
        status: 'succeeded',
        is_complete: true,
        n_created: 1,
        n_updated: 0,
        n_unchanged: 0,
      });
      const row = await tdb.db
        .selectFrom('courses')
        .select(['content_hash'])
        .where('id', '=', courseId)
        .executeTakeFirstOrThrow();
      expect(row.content_hash).toHaveLength(32);
      const history = await tdb.db
        .selectFrom('ext_metadata_history')
        .selectAll()
        .where('entity_id', '=', courseId)
        .execute();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        channel: 'form',
        schema_version: 'form-1',
        validation_result: 'accepted',
        sync_run_id: run?.id,
      });
      expect(history[0]?.raw_payload).toMatchObject({ ext_id: 'AUR-DATA-1', ects: 5 });
      const audit = await tdb.db
        .selectFrom('audit_log')
        .selectAll()
        .where('entity_id', '=', courseId)
        .execute();
      expect(audit).toEqual([
        expect.objectContaining({
          actor_sub: ALLIANCE_SUB,
          actor_org_id: ORG.aurora,
          action: 'course.create',
          entity_type: 'course',
          changes: expect.objectContaining({ sync_run_id: run?.id, outcome: 'created' }),
        }),
      ]);
    });

    it('refuses duplicates, bad references and publishing without English', async () => {
      const dup = await as(auth.alliance)
        .post(`${api}/organizations/${ORG.aurora}/courses`, courseBody())
        .expect(409);
      expect(dup.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(dup.body.errors[0].code).toBe('oecp.content.duplicate_ext_id');

      const refs = await as(auth.alliance)
        .post(
          `${api}/organizations/${ORG.aurora}/courses`,
          courseBody({
            ext_id: 'AUR-X',
            teaching_unit_ext_id: 'NOPE',
            attributes: { unknown_attr: true, micro_credential: 'yes' },
          }),
        )
        .expect(422);
      expect(
        refs.body.errors.map((e: { code: string; pointer: string }) => [e.code, e.pointer]),
      ).toEqual([
        ['oecp.content.unknown_teaching_unit', '/teaching_unit_ext_id'],
        expect.arrayContaining([]),
        expect.arrayContaining([]),
      ]);
      const codes = refs.body.errors.map((e: { code: string }) => e.code);
      expect(codes).toContain('oecp.content.unknown_attribute');
      expect(codes).toContain('oecp.content.invalid_attribute_value');

      const english = await as(auth.alliance)
        .post(
          `${api}/organizations/${ORG.aurora}/courses`,
          courseBody({ ext_id: 'AUR-Y', status: 'published', texts: { ca: { title: 'Hola' } } }),
        )
        .expect(400);
      expect(english.body.errors[0]).toMatchObject({
        code: 'oecp.content.english_missing',
        pointer: '/texts/en',
      });
      const runs = await formRuns();
      expect(runs).toHaveLength(1); // refused saves write nothing
    });

    it('replaces a course (texts omitted are deleted, English kept), code immutable', async () => {
      const res = await as(auth.alliance)
        .put(
          `${api}/courses/${courseId}`,
          courseBody({
            status: 'published',
            ects: 6,
            teaching_unit_ext_id: null,
            texts: { en: { title: 'Data for Good', description: 'Long.' } },
          }),
        )
        .expect(200);
      const course = adminCourse.parse(res.body);
      expect(course).toMatchObject({ status: 'published', ects: 6 });
      expect(Object.keys(course.texts)).toEqual(['en']);
      expect(course.texts['en']?.description).toBe('Long.');
      const [run] = await formRuns();
      expect(run).toMatchObject({ n_updated: 1, n_created: 0 });
      const audit = await tdb.db
        .selectFrom('audit_log')
        .select('changes')
        .where('entity_id', '=', courseId)
        .where('action', '=', 'course.update')
        .executeTakeFirstOrThrow();
      expect(audit.changes?.['fields']).toEqual(['status', 'ects', 'texts.ca', 'texts.en']);

      // Same content again: unchanged.
      await as(auth.alliance)
        .put(
          `${api}/courses/${courseId}`,
          courseBody({
            ects: 6,
            texts: { en: { title: 'Data for Good', description: 'Long.' } },
          }),
        )
        .expect(200);
      expect((await formRuns())[0]).toMatchObject({ n_unchanged: 1 });

      const immutable = await as(auth.alliance)
        .put(`${api}/courses/${courseId}`, courseBody({ ext_id: 'AUR-OTHER' }))
        .expect(409);
      expect(immutable.body.errors[0].code).toBe('oecp.content.ext_id_immutable');
      const overrides = await as(auth.alliance)
        .patch(`${api}/courses/${courseId}/overrides`, { set: { ects: 3 } })
        .expect(409);
      expect(overrides.body.errors[0].code).toBe('oecp.content.override_not_allowed');
    });

    it('creates an offering with a minimal session, the default time zone and seat timestamp', async () => {
      const bad = await as(auth.alliance)
        .post(`${api}/courses/${courseId}/offerings`, offeringBody({ delivery_modes: ['x-moon'] }))
        .expect(422);
      expect(bad.body.errors[0]).toMatchObject({
        code: 'oecp.content.unknown_delivery_mode',
        pointer: '/delivery_modes/0',
      });
      const before = Date.now();
      const res = await as(auth.alliance)
        .post(`${api}/courses/${courseId}/offerings`, offeringBody())
        .expect(201);
      const offering = adminOffering.parse(res.body);
      offeringId = offering.id;
      expect(res.headers['location']).toBe(`${api}/offerings/${offering.id}`);
      expect(offering).toMatchObject({
        course_id: courseId,
        course_ext_id: 'AUR-DATA-1',
        source_channel: 'form',
        status: 'draft',
        timezone: 'Europe/Brussels',
        academic_session_ext_id: 'SS2027',
        academic_session: { ext_id: 'SS2027', name: { en: 'SS2027' } },
        teaching_languages: ['en', 'ca'],
        delivery_modes: ['blended', 'online'],
        seats_available: 12,
        application_instructions: { en: 'Ask your home coordinator.' },
      });
      expect(Date.parse(offering.seats_updated_at ?? '')).toBeGreaterThanOrEqual(before - 1000);
      const session = await tdb.db
        .selectFrom('academic_sessions')
        .selectAll()
        .where('organization_id', '=', ORG.aurora)
        .where('ext_id', '=', 'SS2027')
        .executeTakeFirstOrThrow();
      expect(session).toMatchObject({
        session_type: 'period',
        start_date: '2027-03-01',
        end_date: '2027-06-30',
        source_channel: 'form',
      });
      expect((await formRuns())[0]).toMatchObject({ n_created: 1 });

      const reference = adminReference.parse(
        (await as(auth.alliance).get(`${api}/organizations/${ORG.aurora}/reference`)).body,
      );
      expect(reference.academic_sessions.map((s) => s.ext_id)).toEqual(['SS2027']);

      const dup = await as(auth.alliance)
        .post(`${api}/courses/${courseId}/offerings`, offeringBody())
        .expect(409);
      expect(dup.body.errors[0].code).toBe('oecp.content.duplicate_ext_id');
    });

    it('replaces and publishes an offering', async () => {
      const res = await as(auth.alliance)
        .put(
          `${api}/offerings/${offeringId}`,
          offeringBody({ timezone: 'Europe/Madrid', campus: 'Tarragona', seats_available: null }),
        )
        .expect(200);
      expect(adminOffering.parse(res.body)).toMatchObject({
        timezone: 'Europe/Madrid',
        campus: 'Tarragona',
        seats_available: null,
        seats_updated_at: null,
      });
      const published = await as(auth.alliance)
        .post(`${api}/offerings/${offeringId}/status`, { status: 'published' })
        .expect(200);
      expect(published.body.status).toBe('published');
      const immutable = await as(auth.alliance)
        .put(`${api}/offerings/${offeringId}`, offeringBody({ ext_offering_id: 'OTHER' }))
        .expect(409);
      expect(immutable.body.errors[0].code).toBe('oecp.content.ext_id_immutable');
      const course = adminCourse.parse(
        (await as(auth.alliance).get(`${api}/courses/${courseId}`).expect(200)).body,
      );
      expect(course.offerings.map((o) => o.status)).toEqual(['published']);
    });

    it('lists courses with filters, search and pagination', async () => {
      await as(auth.alliance)
        .post(
          `${api}/organizations/${ORG.aurora}/courses`,
          courseBody({
            ext_id: 'AUR-HIST-2',
            kind: 'course',
            texts: { de: { title: 'Geschichte' } },
          }),
        )
        .expect(201);
      const all = adminCourseList.parse(
        (await as(auth.alliance).get(`${api}/organizations/${ORG.aurora}/courses`).expect(200))
          .body,
      );
      expect(all.total).toBe(2);
      const data = all.items.find((i) => i.ext_id === 'AUR-DATA-1');
      expect(data).toMatchObject({
        status: 'published',
        title: 'Data for Good',
        title_lang: 'en',
        ects: 6,
        offerings_count: 1,
        has_overrides: false,
        next_start_date: '2027-03-01',
        source_channel: 'form',
      });
      expect(all.items.find((i) => i.ext_id === 'AUR-HIST-2')).toMatchObject({
        title: 'Geschichte',
        title_lang: 'de',
        status: 'draft',
        offerings_count: 0,
        next_start_date: null,
      });
      const drafts = adminCourseList.parse(
        (
          await as(auth.alliance)
            .get(`${api}/organizations/${ORG.aurora}/courses?status[]=draft&kind=course`)
            .expect(200)
        ).body,
      );
      expect(drafts.items.map((i) => i.ext_id)).toEqual(['AUR-HIST-2']);
      const search = adminCourseList.parse(
        (
          await as(auth.alliance)
            .get(`${api}/organizations/${ORG.aurora}/courses?q=geschich`)
            .expect(200)
        ).body,
      );
      expect(search.items.map((i) => i.ext_id)).toEqual(['AUR-HIST-2']);
      const paged = adminCourseList.parse(
        (
          await as(auth.alliance)
            .get(`${api}/organizations/${ORG.aurora}/courses?page=2&page_size=1`)
            .expect(200)
        ).body,
      );
      expect(paged).toMatchObject({ page: 2, page_size: 1, total: 2 });
      expect(paged.items).toHaveLength(1);
      await as(auth.alliance)
        .get(`${api}/organizations/${ORG.aurora}/courses?page_size=500`)
        .expect(400);
    });

    it('deletes only unpublished records created by form or CSV', async () => {
      const blocked = await as(auth.alliance).delete(`${api}/courses/${courseId}`).expect(409);
      expect(blocked.body.errors[0].code).toBe('oecp.content.has_published_offerings');
      const published = await as(auth.alliance)
        .delete(`${api}/offerings/${offeringId}`)
        .expect(409);
      expect(published.body.errors[0].code).toBe('oecp.content.published_not_deletable');

      await as(auth.alliance)
        .post(`${api}/offerings/${offeringId}/status`, { status: 'withdrawn' })
        .expect(200);
      await as(auth.alliance).delete(`${api}/offerings/${offeringId}`).expect(204);
      await as(auth.alliance).get(`${api}/offerings/${offeringId}`).expect(404);
      await as(auth.alliance).delete(`${api}/courses/${courseId}`).expect(204);
      await as(auth.alliance).get(`${api}/courses/${courseId}`).expect(404);
      const list = adminCourseList.parse(
        (await as(auth.alliance).get(`${api}/organizations/${ORG.aurora}/courses`)).body,
      );
      expect(list.items.map((i) => i.ext_id)).toEqual(['AUR-HIST-2']);
      const row = await tdb.db
        .selectFrom('courses')
        .select('deleted_at')
        .where('id', '=', courseId)
        .executeTakeFirstOrThrow();
      expect(row.deleted_at).not.toBeNull();
      expect((await formRuns())[0]).toMatchObject({ status: 'succeeded', n_updated: 1 });

      // The code is free again: the deleted row comes back.
      const again = await as(auth.alliance)
        .post(`${api}/organizations/${ORG.aurora}/courses`, courseBody())
        .expect(201);
      expect(again.body.id).toBe(courseId);
      expect(again.body.offerings).toEqual([]);
    });

    it('shows the change history of a course', async () => {
      const res = await as(auth.alliance)
        .get(`${api}/courses/${courseId}/history?limit=100`)
        .expect(200);
      const history = adminCourseHistory.parse(res.body);
      const actions = history.items.map((i) => i.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'course.create',
          'course.update',
          'course.delete',
          'course_offering.create',
          'course_offering.status',
          'course_offering.delete',
          'ingest.accepted',
        ]),
      );
      // The writer's own status audit of a form save is folded into the form row.
      expect(actions.filter((a) => a === 'course_offering.status')).toHaveLength(2);
      const statusRow = history.items.find(
        (i) => i.action === 'course_offering.status' && i.summary.includes('withdrawn'),
      );
      expect(statusRow).toMatchObject({
        kind: 'audit',
        actor: ALLIANCE_SUB,
        channel: 'form',
        summary: 'Status published → withdrawn',
        entity_type: 'course_offering',
      });
      const ingest = history.items.find((i) => i.kind === 'history');
      expect(ingest).toMatchObject({ actor: ALLIANCE_SUB, channel: 'form' });
      expect(JSON.stringify(history)).not.toContain('Ask your home coordinator');
      const sorted = [...history.items].sort((a, b) => b.at.localeCompare(a.at));
      expect(history.items).toEqual(sorted);
      await as(auth.urv).get(`${api}/courses/${courseId}/history`).expect(403);
    });
  });

  describe('overrides mode (authoritative channel oeapi)', () => {
    let courseId = '';
    let offeringId = '';

    beforeAll(async () => {
      const ctx = await harvestRun();
      courseId = (await writer.upsertCourse(ctx, harvested(), { courseId: 'c-ml', v: 1 })).entityId;
      offeringId = (
        await writer.upsertOffering(ctx, harvestedOffering(), { offeringId: 'o-ml', v: 1 })
      ).entityId;
    });

    it('refuses record writes and deletes', async () => {
      const create = await as(auth.uibk)
        .post(`${api}/organizations/${ORG.uibk}/courses`, courseBody({ ext_id: 'UIBK-NEW' }))
        .expect(409);
      expect(create.body.errors[0].code).toBe('oecp.sync.channel_disabled');
      await as(auth.uibk)
        .put(`${api}/courses/${courseId}`, courseBody({ ext_id: 'UIBK-ML' }))
        .expect(409);
      await as(auth.uibk).post(`${api}/courses/${courseId}/offerings`, offeringBody()).expect(409);
      await as(auth.uibk).delete(`${api}/courses/${courseId}`).expect(409);
      await as(auth.uibk).delete(`${api}/offerings/${offeringId}`).expect(409);
      await as(auth.uibk).put(`${api}/offerings/${offeringId}`, offeringBody()).expect(409);
    });

    it('stores overrides over the harvested values without touching the source hash', async () => {
      const before = await tdb.db
        .selectFrom('courses')
        .select('content_hash')
        .where('id', '=', courseId)
        .executeTakeFirstOrThrow();
      const res = await as(auth.uibk)
        .patch(`${api}/courses/${courseId}/overrides`, {
          set: {
            ects: 6,
            kind: 'bip',
            levels: ['master', 'doctoral'],
            isced_codes: [{ code: '0611' }, { code: '0613', is_primary: true }],
            attributes: { micro_credential: true },
            'texts.en.title': 'Machine Learning (Aurora edition)',
            'texts.de.title': 'Maschinelles Lernen',
            'texts.de.abstract': 'Lernen aus Daten.',
          },
        })
        .expect(200);
      const course = adminCourse.parse(res.body);
      expect(course).toMatchObject({
        source_channel: 'oeapi',
        ects: 6,
        kind: 'bip',
        level: 'master',
        levels: ['master', 'doctoral'],
        isced_codes: [
          { code: '0613', is_primary: true },
          { code: '0611', is_primary: false },
        ],
        attributes: { micro_credential: true },
        overrides: {
          ects: 6,
          kind: 'bip',
          levels: ['master', 'doctoral'],
          isced_codes: [
            { code: '0613', is_primary: true },
            { code: '0611', is_primary: false },
          ],
          'texts.en.title': 'Machine Learning (Aurora edition)',
          'texts.de.title': 'Maschinelles Lernen',
          'texts.de.abstract': 'Lernen aus Daten.',
        },
        source_values: {
          ects: 7.5,
          kind: 'course',
          levels: ['master'],
          isced_codes: [{ code: '0613', is_primary: true }],
          attributes: {},
          'texts.en.title': 'Machine Learning',
          'texts.de.title': null,
          'texts.de.abstract': null,
        },
      });
      expect(course.override_meta['ects']?.by).toBe(UIBK_SUB);
      expect(course.texts['de']?.title).toBe('Maschinelles Lernen');
      expect(course.texts['en']?.title).toBe('Machine Learning (Aurora edition)');
      const after = await tdb.db
        .selectFrom('courses')
        .select('content_hash')
        .where('id', '=', courseId)
        .executeTakeFirstOrThrow();
      expect(after.content_hash?.equals(before.content_hash as Buffer)).toBe(true);
      expect((await formRuns())[0]).toMatchObject({
        organization_id: ORG.uibk,
        triggered_by: UIBK_SUB,
        n_updated: 1,
      });
      const list = adminCourseList.parse(
        (await as(auth.uibk).get(`${api}/organizations/${ORG.uibk}/courses`)).body,
      );
      expect(list.items[0]).toMatchObject({ ext_id: 'UIBK-ML', has_overrides: true });
    });

    it('keeps overrides through the next harvest and follows the new source values', async () => {
      const ctx = await harvestRun();
      const changed = harvested({
        ects: 8,
        texts: {
          en: { ...harvested().texts['en']!, title: 'Machine Learning II', abstract: 'New.' },
        },
      });
      expect((await writer.upsertCourse(ctx, changed, { courseId: 'c-ml', v: 2 })).outcome).toBe(
        'updated',
      );
      const course = adminCourse.parse(
        (await as(auth.uibk).get(`${api}/courses/${courseId}`).expect(200)).body,
      );
      expect(course).toMatchObject({ ects: 6, kind: 'bip', levels: ['master', 'doctoral'] });
      expect(course.texts['en']).toMatchObject({
        title: 'Machine Learning (Aurora edition)',
        abstract: 'New.',
      });
      expect(course.texts['de']?.title).toBe('Maschinelles Lernen');
      expect(course.source_values).toMatchObject({
        ects: 8,
        'texts.en.title': 'Machine Learning II',
        'texts.de.title': null,
      });
    });

    it('restores the latest harvested value when an override is removed', async () => {
      const res = await as(auth.uibk)
        .patch(`${api}/courses/${courseId}/overrides`, {
          clear: ['ects', 'texts.en.title', 'texts.de.title', 'isced_codes'],
        })
        .expect(200);
      const course = adminCourse.parse(res.body);
      expect(course.ects).toBe(8);
      expect(course.texts['en']?.title).toBe('Machine Learning II');
      // German exists only through overrides: removing its title removes the language.
      expect(course.texts['de']).toBeUndefined();
      expect(course.isced_codes).toEqual([{ code: '0613', is_primary: true }]);
      expect(Object.keys(course.overrides).sort()).toEqual(['attributes', 'kind', 'levels']);
    });

    it('sets status overrides that win over the harvest, and checks English to publish', async () => {
      const res = await as(auth.uibk)
        .post(`${api}/courses/${courseId}/status`, { status: 'withdrawn' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'withdrawn',
        overrides: { status: 'withdrawn' },
        source_values: { status: 'published' },
      });
      const ctx = await harvestRun();
      const same = harvested({
        ects: 8,
        texts: {
          en: { ...harvested().texts['en']!, title: 'Machine Learning II', abstract: 'New.' },
        },
      });
      expect((await writer.upsertCourse(ctx, same, { courseId: 'c-ml', v: 2 })).outcome).toBe(
        'unchanged',
      );
      const after = adminCourse.parse((await as(auth.uibk).get(`${api}/courses/${courseId}`)).body);
      expect(after.status).toBe('withdrawn');

      // A German-only harvested draft cannot be published by override.
      const draftId = (
        await writer.upsertCourse(
          ctx,
          harvested({
            ext_id: 'UIBK-DE',
            source_ref: 'c-de',
            status: 'draft',
            texts: {
              de: { ...harvested().texts['en']!, title: 'Nur Deutsch' },
            },
          }),
          { courseId: 'c-de' },
        )
      ).entityId;
      const refused = await as(auth.uibk)
        .post(`${api}/courses/${draftId}/status`, { status: 'published' })
        .expect(422);
      expect(refused.body.errors[0]).toMatchObject({
        code: 'oecp.content.english_missing',
        pointer: '/texts/en',
      });
      // With an English title override it can.
      const ok = await as(auth.uibk)
        .patch(`${api}/courses/${draftId}/overrides`, {
          set: { status: 'published', 'texts.en.title': 'German only' },
        })
        .expect(200);
      expect(ok.body.status).toBe('published');
      const unsupported = await as(auth.uibk)
        .patch(`${api}/courses/${draftId}/overrides`, { set: { 'texts.zz.title': 'x' } })
        .expect(422);
      expect(unsupported.body.errors[0].code).toBe('oecp.content.unsupported_language');
    });

    it('overrides offering values with seat timestamps and the DDL rules', async () => {
      const before = Date.now();
      const res = await as(auth.uibk)
        .patch(`${api}/offerings/${offeringId}/overrides`, {
          set: { seats_available: 5, alliance_seats: 8, delivery_modes: ['presential', 'online'] },
        })
        .expect(200);
      const offering = adminOffering.parse(res.body);
      expect(offering).toMatchObject({
        seats_available: 5,
        alliance_seats: 8,
        delivery_modes: ['online', 'presential'],
        source_values: {
          seats_available: null,
          seats_updated_at: null,
          alliance_seats: null,
          delivery_modes: ['presential'],
        },
      });
      expect(Date.parse(offering.seats_updated_at ?? '')).toBeGreaterThanOrEqual(before - 1000);
      expect(Object.keys(offering.overrides).sort()).toEqual([
        'alliance_seats',
        'delivery_modes',
        'seats_available',
        'seats_updated_at',
      ]);

      const order = await as(auth.uibk)
        .patch(`${api}/offerings/${offeringId}/overrides`, { set: { end_date: '2027-01-01' } })
        .expect(422);
      expect(order.body.errors.map((e: { code: string }) => e.code)).toContain(
        'oecp.content.date_order',
      );
      const capacity = await as(auth.uibk)
        .patch(`${api}/offerings/${offeringId}/overrides`, { set: { max_students: 4 } })
        .expect(422);
      expect(capacity.body.errors[0].code).toBe('oecp.content.seats_exceed_capacity');

      // The next harvest keeps them; clearing restores the source.
      const ctx = await harvestRun();
      await writer.upsertOffering(ctx, harvestedOffering({ campus: 'Innrain' }), { v: 2 });
      const kept = adminOffering.parse(
        (await as(auth.uibk).get(`${api}/offerings/${offeringId}`).expect(200)).body,
      );
      expect(kept).toMatchObject({ campus: 'Innrain', seats_available: 5, alliance_seats: 8 });
      const cleared = adminOffering.parse(
        (
          await as(auth.uibk)
            .patch(`${api}/offerings/${offeringId}/overrides`, {
              clear: ['seats_available', 'delivery_modes'],
            })
            .expect(200)
        ).body,
      );
      expect(cleared).toMatchObject({
        seats_available: null,
        seats_updated_at: null,
        delivery_modes: ['presential'],
        overrides: { alliance_seats: 8 },
      });
      const status = await as(auth.uibk)
        .post(`${api}/offerings/${offeringId}/status`, { status: 'cancelled' })
        .expect(200);
      expect(status.body).toMatchObject({
        status: 'cancelled',
        overrides: { status: 'cancelled' },
      });
    });

    it('keeps an overridden language the source drops, as an override-only language', async () => {
      const ctx = await harvestRun();
      const withFrench = harvested({
        ext_id: 'UIBK-FR',
        source_ref: 'c-fr',
        texts: {
          en: harvested().texts['en']!,
          fr: { ...harvested().texts['en']!, title: 'Apprentissage', abstract: null },
        },
      });
      const id = (await writer.upsertCourse(ctx, withFrench, { v: 1 })).entityId;
      await as(auth.uibk)
        .patch(`${api}/courses/${id}/overrides`, { set: { 'texts.fr.abstract': 'Résumé.' } })
        .expect(200);
      // The source drops French: the row stays, its title becomes an override without source.
      await writer.upsertCourse(
        await harvestRun(),
        harvested({ ext_id: 'UIBK-FR', source_ref: 'c-fr' }),
        { v: 2 },
      );
      const kept = adminCourse.parse((await as(auth.uibk).get(`${api}/courses/${id}`)).body);
      expect(kept.texts['fr']).toMatchObject({ title: 'Apprentissage', abstract: 'Résumé.' });
      expect(kept.overrides).toMatchObject({
        'texts.fr.title': 'Apprentissage',
        'texts.fr.abstract': 'Résumé.',
      });
      expect(kept.source_values).toMatchObject({
        'texts.fr.title': null,
        'texts.fr.abstract': null,
      });
      const gone = adminCourse.parse(
        (
          await as(auth.uibk)
            .patch(`${api}/courses/${id}/overrides`, { clear: ['texts.fr.title'] })
            .expect(200)
        ).body,
      );
      expect(Object.keys(gone.texts)).toEqual(['en']);
    });

    it('resets the hash when an override without recorded source is removed', async () => {
      const ctx = await harvestRun();
      const id = (
        await writer.upsertCourse(ctx, harvested({ ext_id: 'UIBK-OLD', source_ref: 'c-old' }), {})
      ).entityId;
      // An override written before sources were recorded.
      await tdb.db
        .updateTable('courses')
        .set({ ects: 3, overrides: { ects: { value: 3, by: 'x', at: '2026-10-01T00:00:00Z' } } })
        .where('id', '=', id)
        .execute();
      const res = await as(auth.uibk)
        .patch(`${api}/courses/${id}/overrides`, { clear: ['ects'] })
        .expect(200);
      expect(res.body).toMatchObject({ ects: 3, overrides: {} });
      const row = await tdb.db
        .selectFrom('courses')
        .select('content_hash')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.content_hash).toBeNull();
      // The next harvest rewrites the record with the source value.
      await writer.upsertCourse(
        await harvestRun(),
        harvested({ ext_id: 'UIBK-OLD', source_ref: 'c-old' }),
        {},
      );
      expect(adminCourse.parse((await as(auth.uibk).get(`${api}/courses/${id}`)).body).ects).toBe(
        7.5,
      );
    });

    it('records override saves in the history', async () => {
      const history = adminCourseHistory.parse(
        (await as(auth.uibk).get(`${api}/courses/${courseId}/history`).expect(200)).body,
      );
      const overrides = history.items.filter((i) => i.action === 'course.overrides');
      expect(overrides.length).toBe(2);
      expect(overrides[0]?.summary).toMatch(/^Overrides removed|^Overrides set|overrides removed/);
      expect(
        history.items.some((i) => i.kind === 'history' && i.actor === 'system:harvester'),
      ).toBe(true);
      expect(history.items.find((i) => i.action === 'course.status')).toMatchObject({
        actor: UIBK_SUB,
        summary: 'Status published → withdrawn',
      });
    });
  });
});
