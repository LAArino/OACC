// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COURSE,
  FIXTURE_NOW,
  insertCatalogueFixture,
  OFFERING,
  SESSION,
} from '../support/catalogue-fixture.js';
import { responseErrors, schemaErrors } from '../support/oeapi-v5-validator.js';
import { createReadApiApp, SMTP_FROM } from '../support/read-api-app.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

interface Page {
  pageSize: number;
  pageNumber: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  totalPages: number;
  items: Record<string, unknown>[];
}

describe.runIf(describeWithDatabase === 'run')('OEAPI v5 read API (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  /** GETs `/oeapi/v5{path}`, checks headers and validates against the v5 path schema. */
  async function get(path: string, specPath: string, query = '') {
    const res = await http().get(`/oeapi/v5${path}${query}`).expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers['etag']).toBeDefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(responseErrors(specPath, res.body)).toEqual([]);
    return res.body as Record<string, unknown>;
  }
  const list = async (path: string, specPath: string, query = '') =>
    (await get(path, specPath, query)) as unknown as Page;
  const ids = (page: Page, key: string) => page.items.map((i) => i[key]);

  beforeAll(async () => {
    tdb = await createTestDatabase();
    await insertCatalogueFixture(tdb.db);
    app = await createReadApiApp(tdb.db, FIXTURE_NOW);
  });

  afterAll(async () => {
    await app?.close();
    await tdb?.drop();
  });

  it('validator sanity: rejects a non-conforming course', () => {
    expect(responseErrors('/courses/{courseId}', { courseId: 'x' })).not.toEqual([]);
    expect(schemaErrors('Problem', { status: 404, title: 'x' })).not.toEqual([]);
  });

  it('GET / is the service document', async () => {
    const body = await get('/', '/');
    expect(body).toMatchObject({
      contactEmail: SMTP_FROM, // the alliance has no contact e-mail in the fixture
      specification: 'https://open-education-api.github.io/specification/v5/docs.html',
      documentation: 'https://openonderwijsapi.nl/v5/',
      ext: { oecp: { alliance: 'aurora' } },
    });
  });

  describe('organizations', () => {
    it('lists the alliance as root with partners and sub-units below it', async () => {
      const page = await list('/organizations', '/organizations');
      expect(page).toMatchObject({
        pageSize: 10,
        pageNumber: 1,
        hasPreviousPage: false,
        hasNextPage: false,
        totalPages: 1,
      });
      const byId = new Map(page.items.map((o) => [o['organizationId'], o]));
      expect(byId.get(ORG.aurora)).toMatchObject({
        organizationType: 'root',
        primaryCode: { codeType: 'identifier', code: 'aurora' },
        name: [{ language: 'en', value: 'Aurora' }],
        shortName: 'aurora',
        children: [ORG.uibk, ORG.urv],
      });
      expect(byId.get(ORG.aurora)).not.toHaveProperty('parent');
      expect(byId.get(ORG.uibk)).toMatchObject({
        organizationType: 'institute',
        parent: ORG.aurora,
        children: [ORG.uibkFaculty],
        name: [
          { language: 'en', value: 'University of Innsbruck' },
          { language: 'de', value: 'Universität Innsbruck' },
        ],
      });
      expect(byId.get(ORG.uibkFaculty)).toMatchObject({
        organizationType: 'faculty',
        parent: ORG.uibk,
      });
      const roots = await list('/organizations', '/organizations', '?organizationType=root');
      expect(ids(roots, 'organizationId')).toEqual([ORG.aurora]);
    });

    it('GET /organizations/{id} expands parent and children', async () => {
      const body = await get(
        `/organizations/${ORG.uibk}`,
        '/organizations/{organizationId}',
        '?expand=parent,children',
      );
      expect(body['parent']).toMatchObject({ organizationId: ORG.aurora });
      expect(body['children']).toEqual([
        expect.objectContaining({ organizationId: ORG.uibkFaculty }),
      ]);
    });

    it.each([
      [ORG.aurora, [COURSE.F, COURSE.C, COURSE.A, COURSE.B]],
      [ORG.uibk, [COURSE.C, COURSE.A]],
      [ORG.uibkFaculty, [COURSE.C]],
      [ORG.urv, [COURSE.F, COURSE.B]],
    ])('GET /organizations/%s/courses', async (org, expected) => {
      const page = await list(
        `/organizations/${org}/courses`,
        '/organizations/{organizationId}/courses',
      );
      expect(ids(page, 'courseId')).toEqual(expected);
    });
  });

  describe('courses', () => {
    it('pages published courses sorted by name', async () => {
      const first = await list('/courses', '/courses', '?pageSize=2');
      expect(first).toMatchObject({
        pageSize: 2,
        pageNumber: 1,
        hasPreviousPage: false,
        hasNextPage: true,
        totalPages: 2,
      });
      expect(ids(first, 'courseId')).toEqual([COURSE.F, COURSE.C]);
      const second = await list('/courses', '/courses', '?pageSize=2&pageNumber=2');
      expect(second).toMatchObject({ hasPreviousPage: true, hasNextPage: false });
      expect(ids(second, 'courseId')).toEqual([COURSE.A, COURSE.B]);
      const beyond = await list('/courses', '/courses', '?pageSize=2&pageNumber=3');
      expect(beyond).toMatchObject({ items: [], hasNextPage: false, totalPages: 2 });
      const desc = await list('/courses', '/courses', '?sort=-name');
      expect(ids(desc, 'courseId')).toEqual([COURSE.B, COURSE.A, COURSE.C, COURSE.F]);
    });

    it.each([
      ['?teachingLanguage=deu', [COURSE.A]],
      ['?teachingLanguage=ger', [COURSE.A]],
      ['?teachingLanguage=cat', [COURSE.B]],
      ['?teachingLanguage=fra', []], // only a draft offering is in French
      ['?level=master', [COURSE.A]],
      ['?level=bachelor', [COURSE.C, COURSE.B]],
      ['?level=undefined', [COURSE.F]],
      ['?modeOfDelivery=online', [COURSE.A]],
      ['?modeOfDelivery=hybrid', [COURSE.B]],
      ['?modeOfDelivery=on%20campus', [COURSE.C, COURSE.A, COURSE.B]],
      ['?modeOfDelivery=hybrid,online', [COURSE.A, COURSE.B]],
      ['?q=quantum', [COURSE.A]],
      ['?q=HIST-210', [COURSE.B]],
      ['?q=100%25', []],
      ['?consumer=oecp', [COURSE.F, COURSE.C, COURSE.A, COURSE.B]],
      ['?consumer=eduxchange', []],
    ])('filters %s', async (query, expected) => {
      expect(ids(await list('/courses', '/courses', query), 'courseId')).toEqual(expected);
    });

    it('maps a course to v5', async () => {
      const body = await get(`/courses/${COURSE.A}`, '/courses/{courseId}');
      expect(body).toEqual({
        courseId: COURSE.A,
        primaryCode: { codeType: 'identifier', code: '703001' },
        name: [
          { language: 'en', value: 'Introduction to Quantum Computing' },
          { language: 'de', value: 'Einführung in die Quanteninformatik' },
        ],
        abbreviation: '703001',
        description: [
          { language: 'en', value: 'We also look at the history of quantum mechanics.' },
          { language: 'de', value: 'Qubits und Quantengatter für Studierende der Physik.' },
        ],
        teachingLanguage: 'deu', // first language of the next offering (A3)
        level: 'master',
        studyLoad: { studyLoadUnit: 'ects', value: 6 },
        modeOfDelivery: ['on campus', 'online'],
        firstStartDate: '2026-12-01',
        fieldsOfStudy: '0533',
        learningOutcomes: [
          [
            { language: 'en', value: 'Explain superposition.' },
            { language: 'de', value: 'Superposition erklären.' },
          ],
          [
            { language: 'en', value: 'Implement Grover search.' },
            { language: 'de', value: 'Grover-Suche implementieren.' },
          ],
        ],
        admissionRequirements: [{ language: 'en', value: 'Linear algebra.' }],
        assessment: [{ language: 'en', value: 'Written exam.' }],
        link: 'https://uibk.example/courses/703001',
        consumers: [{ consumerKey: 'oecp', alliances: [{ name: 'aurora' }] }],
        organization: ORG.uibk,
        ext: {
          oecp: {
            level: 'master',
            eqfLevel: 7,
            teachingHours: 45,
            iscedCodes: ['0533', '0613'],
            abstract: [
              {
                language: 'en',
                value:
                  'Qubits, quantum gates and algorithms for students of physics and computer science.',
              },
            ],
            keywords: [{ language: 'en', value: ['qubits', 'entanglement'] }],
            teachingUnit: null,
            contactEmail: null,
            updatedAt: expect.any(String),
          },
        },
      });
    });

    it('expands the organization and maps sparse courses validly', async () => {
      const body = await get(`/courses/${COURSE.F}`, '/courses/{courseId}', '?expand=organization');
      expect(body).toMatchObject({
        teachingLanguage: 'eng', // no visible offering: language of the texts
        level: 'undefined',
        description: [{ language: 'en', value: 'Applied Statistics' }],
        organization: { organizationId: ORG.urv, organizationType: 'institute' },
      });
      expect(body).not.toHaveProperty('modeOfDelivery');
    });

    it.each([
      ['draft', COURSE.D],
      ['deleted', COURSE.E],
      ['unknown', '0c000000-0000-4000-8000-0000000000ff'],
    ])('404s a %s course with a v5 Problem', async (_kind, id) => {
      const res = await http().get(`/oeapi/v5/courses/${id}`).expect(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.headers['cache-control']).toBeUndefined();
      expect(res.body).toEqual({
        status: '404',
        title: 'Resource not found',
        detail: 'Course not found',
      });
      expect(schemaErrors('Problem', res.body)).toEqual([]);
    });

    it('400s malformed ids and parameters with a v5 Problem', async () => {
      const bad = await http().get('/oeapi/v5/courses/not-a-uuid').expect(400);
      expect(bad.body).toMatchObject({ status: '400' });
      expect(schemaErrors('Problem', bad.body)).toEqual([]);
      const size = await http().get('/oeapi/v5/courses?pageSize=251').expect(400);
      expect(size.body).toMatchObject({ status: '400', title: 'Request validation failed' });
      await http().get('/oeapi/v5/courses?level=phd').expect(400);
      await http().get('/oeapi/v5/courses?modeOfDelivery=teleport').expect(400);
    });
  });

  describe('offerings', () => {
    it('lists offerings starting today or later by default (v5 since)', async () => {
      const page = await list(`/courses/${COURSE.A}/offerings`, '/courses/{courseId}/offerings');
      expect(ids(page, 'offeringId')).toEqual([OFFERING.A3, OFFERING.A1]);
      const all = await list(
        `/courses/${COURSE.A}/offerings`,
        '/courses/{courseId}/offerings',
        '?since=2025-01-01',
      );
      expect(ids(all, 'offeringId')).toEqual([OFFERING.A2, OFFERING.A3, OFFERING.A1]);
      const window = await list(
        `/courses/${COURSE.A}/offerings`,
        '/courses/{courseId}/offerings',
        '?since=2025-01-01&until=2027-01-31&sort=-startDate',
      );
      expect(ids(window, 'offeringId')).toEqual([OFFERING.A3, OFFERING.A2]);
    });

    it('includes cancelled offerings, flagged in ext.oecp', async () => {
      const page = await list(`/courses/${COURSE.B}/offerings`, '/courses/{courseId}/offerings');
      const status = (o: Record<string, unknown>) =>
        (o['ext'] as { oecp: { status: string } }).oecp.status;
      expect(page.items.map((o) => [o['offeringId'], status(o)])).toEqual([
        [OFFERING.B1, 'published'],
        [OFFERING.B2, 'cancelled'],
      ]);
      expect(page.items[0]).toMatchObject({
        teachingLanguage: 'cat',
        modeOfDelivery: ['on campus', 'hybrid'],
        enrollEndDate: '2026-10-20',
      });
    });

    it('GET /offerings/{id}?expand=academicSession,course', async () => {
      const res = await http()
        .get(`/oeapi/v5/offerings/${OFFERING.A1}?expand=academicSession,course`)
        .expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      // The v5 path schema is a oneOf that a course offering can never satisfy
      // (CourseOffering and ProgramOffering share their required members; see
      // tools/oeapi-mock/README.md), so validate against CourseOffering directly.
      expect(schemaErrors('CourseOffering', res.body)).toEqual([]);
      expect(res.body).toMatchObject({
        offeringId: OFFERING.A1,
        primaryCode: { codeType: 'offeringCode', code: '703001-2027S' },
        offeringType: 'course',
        name: [
          { language: 'en', value: 'Introduction to Quantum Computing' },
          { language: 'de', value: 'Einführung in die Quanteninformatik' },
        ],
        teachingLanguage: 'eng',
        modeOfDelivery: ['online'],
        resultExpected: true,
        startDate: '2027-03-01',
        endDate: '2027-06-30',
        enrollStartDate: '2026-12-01',
        enrollEndDate: '2027-01-31',
        maxNumberStudents: 30,
        link: 'https://uibk.example/apply/703001-2027S',
        academicSession: {
          academicSessionId: SESSION.summer,
          academicSessionType: 'semester',
          primaryCode: { codeType: 'identifier', code: '2027S' },
          startDate: '2027-03-01',
          endDate: '2027-09-30',
          parent: SESSION.year,
        },
        course: { courseId: COURSE.A, primaryCode: { codeType: 'identifier', code: '703001' } },
        organization: ORG.uibk,
        ext: {
          oecp: {
            status: 'published',
            timezone: 'Europe/Vienna',
            teachingLanguages: ['en'],
            deliveryModes: ['online'],
            campus: null,
            allianceSeats: 5,
            seatsAvailable: 12,
            seatsUpdatedAt: '2026-10-13T08:00:00.000Z',
          },
        },
      });
      const plain = await http().get(`/oeapi/v5/offerings/${OFFERING.A1}`).expect(200);
      expect(plain.body).toMatchObject({ academicSession: SESSION.summer, course: COURSE.A });
      expect(schemaErrors('CourseOffering', plain.body)).toEqual([]);
    });

    it.each([
      ['draft offering', OFFERING.F1],
      ['offering of a draft course', OFFERING.D1],
      ['offering of a deleted course', OFFERING.E1],
    ])('404s a %s', async (_kind, id) => {
      const res = await http().get(`/oeapi/v5/offerings/${id}`).expect(404);
      expect(res.body).toMatchObject({ status: '404' });
    });

    it('404s offerings of an unpublished course', async () => {
      await http().get(`/oeapi/v5/courses/${COURSE.D}/offerings`).expect(404);
    });
  });

  describe('academic sessions', () => {
    it('lists sessions by start date', async () => {
      const page = await list('/academic-sessions', '/academic-sessions');
      expect(ids(page, 'academicSessionId')).toEqual([SESSION.year, SESSION.summer]);
      expect(page.items[0]).toMatchObject({
        academicSessionType: 'academic year',
        name: [
          { language: 'en', value: 'Academic year 2026/27' },
          { language: 'de', value: 'Studienjahr 2026/27' },
        ],
        children: [SESSION.summer],
      });
      const semesters = await list(
        '/academic-sessions',
        '/academic-sessions',
        '?academicSessionType=semester',
      );
      expect(ids(semesters, 'academicSessionId')).toEqual([SESSION.summer]);
    });

    it('GET /academic-sessions/{id} expands children and parent', async () => {
      const year = await get(
        `/academic-sessions/${SESSION.year}`,
        '/academic-sessions/{academicSessionId}',
        '?expand=children',
      );
      expect(year['children']).toEqual([
        expect.objectContaining({ academicSessionId: SESSION.summer }),
      ]);
      const summer = await get(
        `/academic-sessions/${SESSION.summer}`,
        '/academic-sessions/{academicSessionId}',
        '?expand=parent',
      );
      expect(summer['parent']).toMatchObject({ academicSessionId: SESSION.year });
      await http()
        .get('/oeapi/v5/academic-sessions/0c000000-0000-4000-8000-0000000000ff')
        .expect(404);
    });
  });
});
