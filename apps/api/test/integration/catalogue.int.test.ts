// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  courseSearchResponse,
  publicCourseDetail,
  referenceResponse,
  suggestResponse,
} from '@oecp/schemas';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COURSE,
  FIXTURE_NOW,
  insertCatalogueFixture,
  OFFERING,
  SESSION,
} from '../support/catalogue-fixture.js';
import { createReadApiApp, PUBLIC_BASE_URL } from '../support/read-api-app.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

describe.runIf(describeWithDatabase === 'run')('public catalogue API (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  /** Parses a search response with the published contract and returns its ids. */
  async function search(query: string) {
    const res = await http().get(`/api/public/v1/courses${query}`).expect(200);
    return courseSearchResponse.parse(res.body);
  }
  const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

  beforeAll(async () => {
    tdb = await createTestDatabase();
    await insertCatalogueFixture(tdb.db);
    app = await createReadApiApp(tdb.db, FIXTURE_NOW);
  });

  afterAll(async () => {
    await app?.close();
    await tdb?.drop();
  });

  describe('GET /courses', () => {
    it('lists published courses with an upcoming offering, by next start date', async () => {
      const res = await http().get('/api/public/v1/courses').expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.headers['etag']).toMatch(/^W\//);
      expect(res.headers['set-cookie']).toBeUndefined();
      const body = courseSearchResponse.parse(res.body);
      expect(ids(body)).toEqual([COURSE.B, COURSE.A]);
      expect(body).toMatchObject({ page: 1, page_size: 20, total: 2 });
    });

    it('answers a matching If-None-Match with 304', async () => {
      const first = await http().get('/api/public/v1/courses').expect(200);
      await http()
        .get('/api/public/v1/courses')
        .set('If-None-Match', first.headers['etag'] as string)
        .expect(304);
    });

    it('builds compact cards', async () => {
      const body = await search('');
      const a = body.items.find((i) => i.id === COURSE.A)!;
      expect(a).toEqual({
        id: COURSE.A,
        ext_id: '703001',
        organization: {
          id: ORG.uibk,
          slug: 'uibk',
          name: { en: 'University of Innsbruck', de: 'Universität Innsbruck' },
          country_code: null,
        },
        title: 'Introduction to Quantum Computing',
        title_lang: 'en',
        abstract:
          'Qubits, quantum gates and algorithms for students of physics and computer science.',
        abstract_lang: 'en',
        ects: 6,
        kind: 'course',
        level: 'master',
        levels: ['master'],
        attributes: [
          {
            key: 'educational_hub',
            label: { en: 'Educational hub' },
            values: [
              {
                value: 'digital_society_global_citizenship',
                label: { en: 'Digital Society & Global Citizenship' },
              },
            ],
          },
          {
            key: 'sdg',
            label: { en: 'Sustainable Development Goals' },
            values: [
              { value: 'sdg04', label: { en: 'SDG 4: Quality education' } },
              { value: 'sdg09', label: { en: 'SDG 9: Industry, innovation and infrastructure' } },
            ],
          },
          {
            key: 'free_course',
            label: { en: 'Free course' },
            values: [{ value: 'true', label: { en: 'Yes' } }],
          },
        ],
        isced_broad_fields: [
          { code: '05', label: { en: 'Natural sciences, mathematics and statistics' } },
          { code: '06', label: { en: 'Information and Communication Technologies (ICTs)' } },
        ],
        delivery_modes: ['presential', 'online'],
        teaching_languages: ['de', 'en'],
        next_offering: {
          id: OFFERING.A3,
          start_date: '2026-12-01',
          end_date: '2027-01-31',
          application_deadline: null,
          enrol_start_date: null,
          timezone: 'Europe/Vienna',
          seats_available: null,
          alliance_seats: null,
          seats_updated_at: null,
          application_instructions: null,
        },
        offerings_count: 2,
        image: null,
      });
      const b = body.items.find((i) => i.id === COURSE.B)!;
      expect([...b.abstract!].length).toBeLessThanOrEqual(300);
      expect(b.abstract).toMatch(/\w…$/);
    });

    it('counts facets for the current filters, each ignoring its own filter', async () => {
      const body = await search('');
      expect(body.facets).toEqual({
        partner: [
          { value: 'uibk', count: 1 },
          { value: 'urv', count: 1 },
        ],
        mode: [
          { value: 'presential', count: 2 },
          { value: 'hybrid', count: 1 },
          { value: 'online', count: 1 },
        ],
        lang: [
          { value: 'ca', count: 1 },
          { value: 'de', count: 1 },
          { value: 'en', count: 1 },
          { value: 'es', count: 1 },
        ],
        isced: [
          { value: '02', count: 1 },
          { value: '05', count: 1 },
          { value: '06', count: 1 },
        ],
        level: [
          { value: 'master', count: 2 },
          { value: 'bachelor', count: 1 },
        ],
        kind: [
          { value: 'bip', count: 1 },
          { value: 'course', count: 1 },
        ],
        attributes: {
          educational_hub: [
            {
              value: 'digital_society_global_citizenship',
              count: 1,
              label: { en: 'Digital Society & Global Citizenship' },
            },
          ],
          sdg: [
            { value: 'sdg04', count: 2, label: { en: 'SDG 4: Quality education' } },
            {
              value: 'sdg09',
              count: 1,
              label: { en: 'SDG 9: Industry, innovation and infrastructure' },
            },
          ],
          micro_credential: [],
          free_course: [
            { value: 'false', count: 1, label: { en: 'No' } },
            { value: 'true', count: 1, label: { en: 'Yes' } },
          ],
          open_to_alliance: [{ value: 'true', count: 1, label: { en: 'Yes' } }],
          target_audience: [],
        },
      });
      const filtered = await search('?partner=uibk&mode=online');
      expect(ids(filtered)).toEqual([COURSE.A]);
      expect(filtered.facets.partner).toEqual([{ value: 'uibk', count: 1 }]); // urv has no online offering
      expect(filtered.facets.mode).toEqual([
        { value: 'online', count: 1 },
        { value: 'presential', count: 1 },
      ]);
      expect(filtered.facets.level).toEqual([{ value: 'master', count: 1 }]);
    });

    it('lists every published course with upcoming=false (or includeUnscheduled=true)', async () => {
      const all = await search('?upcoming=false');
      expect(all.total).toBe(4);
      expect(new Set(ids(all))).toEqual(new Set([COURSE.A, COURSE.B, COURSE.C, COURSE.F]));
      // Courses without an upcoming offering sort last, by title.
      expect(ids(all).slice(2)).toEqual([COURSE.F, COURSE.C]);
      const c = all.items.find((i) => i.id === COURSE.C)!;
      expect(c).toMatchObject({ next_offering: null, offerings_count: 0, delivery_modes: [] });
      expect(ids(await search('?includeUnscheduled=true'))).toEqual(ids(all));
      expect((await search('?includeUnscheduled=true&upcoming=true')).total).toBe(2);
    });

    it('never lists draft or deleted courses, nor courses with only draft offerings', async () => {
      const all = await search('?upcoming=false&q=quantum');
      expect(ids(all)).toEqual([COURSE.A]);
    });

    it.each([
      ['?partner=urv', [COURSE.B]],
      ['?partner=urv&partner=uibk', [COURSE.B, COURSE.A]],
      ['?mode=online', [COURSE.A]],
      ['?mode=hybrid&mode=online', [COURSE.B, COURSE.A]],
      ['?lang=ca', [COURSE.B]],
      ['?lang=en', [COURSE.A]],
      ['?isced=06', [COURSE.A]],
      ['?isced=02&upcoming=false', [COURSE.B, COURSE.C]],
      ['?level=master', [COURSE.B, COURSE.A]],
      ['?level=bachelor&upcoming=false', [COURSE.B, COURSE.C]],
      ['?kind=bip', [COURSE.B]],
      ['?kind=lecture_series&kind=course&upcoming=false', [COURSE.A, COURSE.F, COURSE.C]],
      ['?attr_free_course=true', [COURSE.A]],
      ['?attr_free_course=true&upcoming=false', [COURSE.A, COURSE.C]],
      ['?attr_free_course=false', [COURSE.B]],
      ['?attr_free_course=yes', []],
      ['?attr_sdg=sdg04', [COURSE.B, COURSE.A]],
      ['?attr_sdg=sdg09', [COURSE.A]],
      ['?attr_sdg=sdg09&attr_sdg=sdg13', [COURSE.A]],
      ['?attr_sdg=sdg04&attr_open_to_alliance=true', [COURSE.B]],
      ['?attr_competence_framework=louis', [COURSE.A]],
      ['?attr_not_defined=x', [COURSE.B, COURSE.A]],
      ['?sort=deadline', [COURSE.B, COURSE.A]],
      ['?sort=deadline&upcoming=false', [COURSE.B, COURSE.A, COURSE.F, COURSE.C]],
      ['?sort=deadline&mode=online', [COURSE.A]],
      ['?ectsMin=5.5', [COURSE.A]],
      ['?ects_min=5&ects_max=5', [COURSE.B]],
      ['?ectsMax=3&upcoming=false', [COURSE.C]],
      ['?partner=uibk&lang=ca', []],
      ['?sort=title', [COURSE.A, COURSE.B]],
      ['?sort=title&upcoming=false', [COURSE.F, COURSE.C, COURSE.A, COURSE.B]],
    ])('filters %s', async (query, expected) => {
      expect(ids(await search(query))).toEqual(expected);
    });

    it('keeps attribute facets disjunctive', async () => {
      const body = await search('?attr_free_course=true&upcoming=false');
      expect(body.facets.attributes['free_course']).toEqual([
        { value: 'true', count: 2, label: { en: 'Yes' } },
        { value: 'false', count: 1, label: { en: 'No' } },
      ]);
      expect(body.facets.attributes['sdg']).toEqual([
        { value: 'sdg04', count: 1, label: { en: 'SDG 4: Quality education' } },
        {
          value: 'sdg09',
          count: 1,
          label: { en: 'SDG 9: Industry, innovation and infrastructure' },
        },
      ]);
      expect(body.facets.kind).toEqual([
        { value: 'course', count: 1 },
        { value: 'lecture_series', count: 1 },
      ]);
    });

    it('resolves the next offering’s application instructions for the locale', async () => {
      const en = await search('?partner=urv');
      expect(en.items[0]!.next_offering!.application_instructions).toBe(
        'Apply through the Aurora office of your home university.',
      );
      const ca = await search('?partner=urv&locale=ca');
      expect(ca.items[0]!.next_offering!.application_instructions).toMatch(/^Sol·liciteu-ho/);
      const de = await search('?partner=urv&locale=de');
      expect(de.items[0]!.next_offering!.application_instructions).toMatch(/^Apply through/);
      // Booleans that are false are not shown as tags.
      expect(en.items[0]!.attributes.map((a) => a.key)).toEqual(['sdg', 'open_to_alliance']);
    });

    it('takes the next offering among those matching the offering filters', async () => {
      const body = await search('?mode=online');
      expect(body.items[0]!.next_offering).toMatchObject({
        id: OFFERING.A1,
        alliance_seats: 5,
        seats_available: 12,
        seats_updated_at: '2026-10-13T08:00:00.000Z',
        application_deadline: '2027-01-31',
        enrol_start_date: '2026-12-01',
      });
    });

    it('resolves texts in the requested locale with English fallback', async () => {
      const body = await search('?locale=de&partner=uibk');
      expect(body.items[0]).toMatchObject({
        title: 'Einführung in die Quanteninformatik',
        title_lang: 'de',
        abstract_lang: 'en',
      });
      const ca = await search('?locale=ca&partner=urv');
      expect(ca.items[0]).toMatchObject({
        title: 'Història de la Mediterrània',
        title_lang: 'ca',
        abstract_lang: 'ca',
      });
    });

    it('pages results', async () => {
      const page2 = await search('?pageSize=1&page=2');
      expect(page2).toMatchObject({ page: 2, page_size: 1, total: 2 });
      expect(ids(page2)).toEqual([COURSE.A]);
      expect((await search('?page_size=1')).items).toHaveLength(1);
      const past = await search('?page=3&pageSize=1');
      expect(past.items).toEqual([]);
      expect(past.total).toBe(2);
    });

    describe('full-text search', () => {
      it.each([
        ['English stemming', 'computers', [COURSE.A]],
        ['several words (AND)', 'quantum algorithms', [COURSE.A]],
        ['German stemming and umlauts', 'Universität', [COURSE.C]],
        ['German without umlauts', 'universitaten', [COURSE.C]],
        ['German prefix of a compound', 'Quanten', [COURSE.A]],
        ['Catalan stemming without accents', 'mediterrania', [COURSE.B]],
        ['Catalan with accents', 'ciutats portuàries', [COURSE.B]],
        ['keywords', 'entanglement', [COURSE.A]],
        ['handbook methods (weight C)', 'photonic', [COURSE.A]],
        ['handbook literature', 'textbook', [COURSE.A]],
        ['handbook remarks', 'cryostat', [COURSE.A]],
        ['privacy notice is not indexed', 'zebrafish', []],
        ['mode of repetition is not indexed', 'winter', []],
        ['typo via trigram similarity', 'quantm', [COURSE.A]],
        ['nothing', 'zzzxxy', []],
      ])('%s: %s', async (_name, q, expected) => {
        const body = await search(`?upcoming=false&q=${encodeURIComponent(q)}`);
        expect(ids(body)).toEqual(expected);
      });

      it('ranks title matches above description matches', async () => {
        const body = await search('?upcoming=false&q=history');
        expect(ids(body)).toHaveLength(3);
        expect(ids(body)[2]).toBe(COURSE.A); // only in A's description
      });

      it('restricts facets to the matches', async () => {
        const body = await search('?q=history');
        expect(body.facets.partner).toEqual([
          { value: 'uibk', count: 1 },
          { value: 'urv', count: 1 },
        ]);
        expect(body.total).toBe(2);
      });
    });

    it('rejects malformed parameters with problem+json', async () => {
      const res = await http().get('/api/public/v1/courses?isced=1').expect(400);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.body).toMatchObject({ status: 400, type: '/problems/validation-failed' });
      await http().get('/api/public/v1/courses?level=phd').expect(400);
      await http().get('/api/public/v1/courses?upcoming=yes').expect(400);
      await http().get('/api/public/v1/courses?kind=seminar').expect(400);
      await http().get('/api/public/v1/courses?sort=popularity').expect(400);
    });
  });

  describe('GET /courses/{id}', () => {
    it('returns the full course page', async () => {
      const res = await http().get(`/api/public/v1/courses/${COURSE.A}`).expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers['etag']).toBeDefined();
      expect(res.headers['set-cookie']).toBeUndefined();
      const body = publicCourseDetail.parse(res.body);
      expect(Object.keys(body.texts)).toEqual(['en', 'de']);
      expect(body.texts['de']).toMatchObject({
        title: 'Einführung in die Quanteninformatik',
        abstract: null,
        keywords: [],
        is_machine_translated: false,
      });
      expect(body).toMatchObject({
        ext_id: '703001',
        ects: 6,
        level: 'master',
        eqf_level: 7,
        teaching_hours: 45,
        info_url: 'https://uibk.example/courses/703001',
        contact_email: 'aurora@uibk.example', // organization fallback
        instructors: ['Course team, University of Innsbruck'],
        teaching_unit: null,
        organization: { id: ORG.uibk, slug: 'uibk', logo_url: null, website_url: null },
      });
      expect(body.texts['en']).toMatchObject({
        mode_of_repetition: 'Every winter semester.',
        methods: 'Exercises on a photonic simulator.',
        literature: 'Selected chapters of a standard textbook.',
        privacy_notice: 'Recordings follow the zebrafish policy.',
        remarks: 'Includes a cryostat laboratory visit.',
      });
      expect(body.texts['de']).toMatchObject({ methods: null, remarks: null });
      expect(body.isced_codes).toEqual([
        {
          code: '0533',
          broad_code: '05',
          is_primary: true,
          label: { en: 'Natural sciences, mathematics and statistics' },
        },
        {
          code: '0613',
          broad_code: '06',
          is_primary: false,
          label: { en: 'Information and Communication Technologies (ICTs)' },
        },
      ]);
      expect(body.offerings.map((o) => o.id)).toEqual([OFFERING.A2, OFFERING.A3, OFFERING.A1]);
      expect(body.offerings[2]).toEqual({
        id: OFFERING.A1,
        ext_offering_id: '703001-2027S',
        status: 'published',
        academic_session: {
          id: SESSION.summer,
          name: { en: 'Summer semester 2027' },
          start_date: '2027-03-01',
          end_date: '2027-09-30',
        },
        start_date: '2027-03-01',
        end_date: '2027-06-30',
        enrol_start_date: '2026-12-01',
        application_deadline: '2027-01-31',
        timezone: 'Europe/Vienna',
        teaching_languages: ['en'],
        delivery_modes: ['online'],
        campus: null,
        max_students: 30,
        alliance_seats: 5,
        seats_available: 12,
        seats_updated_at: '2026-10-13T08:00:00.000Z',
        application_url: 'https://uibk.example/apply/703001-2027S',
        application_instructions: {},
        updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
      });
      // Per-field dates of the course page: never later than the page's own date.
      for (const stamp of [
        ...Object.values(body.texts).map((t) => t.updated_at),
        ...body.offerings.map((o) => o.updated_at),
      ]) {
        expect(Date.parse(stamp)).toBeLessThanOrEqual(Date.parse(body.updated_at));
      }
      expect(body).toMatchObject({ kind: 'course', levels: ['master'] });
      expect(body.attributes.map((a) => [a.key, a.values.map((v) => v.value)])).toEqual([
        ['educational_hub', ['digital_society_global_citizenship']],
        ['sdg', ['sdg04', 'sdg09']],
        ['competence_framework', ['louis']],
        ['free_course', ['true']],
      ]);
    });

    it('lists cancelled offerings until they start, and the teaching unit', async () => {
      const b = publicCourseDetail.parse(
        (await http().get(`/api/public/v1/courses/${COURSE.B}`).expect(200)).body,
      );
      expect(b.offerings.map((o) => [o.id, o.status])).toEqual([
        [OFFERING.B1, 'published'],
        [OFFERING.B2, 'cancelled'],
      ]);
      expect(b.offerings[0]!.delivery_modes).toEqual(['presential', 'hybrid']);
      expect(b.offerings[0]!.application_instructions).toEqual({
        en: 'Apply through the Aurora office of your home university.',
        ca: 'Sol·liciteu-ho a l’oficina Aurora de la vostra universitat.',
      });
      expect(b).toMatchObject({ kind: 'bip', level: 'bachelor', levels: ['bachelor', 'master'] });
      expect(b.attributes.map((a) => [a.key, a.values.map((v) => v.value)])).toEqual([
        ['sdg', ['sdg04']],
        ['free_course', ['false']],
        ['open_to_alliance', ['true']],
      ]);
      expect(b.contact_email).toBe('history@urv.example');
      const c = publicCourseDetail.parse(
        (await http().get(`/api/public/v1/courses/${COURSE.C}`).expect(200)).body,
      );
      expect(c.teaching_unit).toEqual({
        id: ORG.uibkFaculty,
        slug: 'uibk-informatik',
        name: { en: 'Faculty of Computer Science' },
      });
    });

    it.each([
      ['draft', COURSE.D],
      ['deleted', COURSE.E],
      ['unknown', '0c000000-0000-4000-8000-0000000000ff'],
      ['malformed', 'not-a-uuid'],
    ])('404s a %s course with problem+json', async (_kind, id) => {
      const res = await http().get(`/api/public/v1/courses/${id}`).expect(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.headers['cache-control']).toBeUndefined();
      expect(res.body).toMatchObject({ status: 404, title: 'Resource not found' });
    });
  });

  describe('GET /suggest', () => {
    const suggest = async (q: string) => {
      const res = await http()
        .get(`/api/public/v1/suggest?q=${encodeURIComponent(q)}`)
        .expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      return suggestResponse.parse(res.body).items;
    };

    it('suggests titles by prefix, accent- and case-insensitively', async () => {
      expect(await suggest('quan')).toEqual([
        {
          id: COURSE.A,
          title: 'Introduction to Quantum Computing',
          lang: 'en',
          organization_slug: 'uibk',
        },
      ]);
      expect(await suggest('EINFUHRUNG')).toEqual([
        {
          id: COURSE.A,
          title: 'Einführung in die Quanteninformatik',
          lang: 'de',
          organization_slug: 'uibk',
        },
      ]);
    });

    it('tolerates typos via trigram similarity', async () => {
      expect((await suggest('quantm')).map((s) => s.id)).toEqual([COURSE.A]);
      expect((await suggest('histry')).map((s) => s.id).sort()).toEqual(
        [COURSE.B, COURSE.C].sort(),
      );
    });

    it('prefers the locale, then English titles, ranks title prefixes first, skips drafts', async () => {
      expect(await suggest('hist')).toEqual([
        { id: COURSE.C, title: 'History of Universities', lang: 'en', organization_slug: 'uibk' },
        { id: COURSE.B, title: 'Mediterranean History', lang: 'en', organization_slug: 'urv' },
      ]);
      const ca = await http().get('/api/public/v1/suggest?q=hist&locale=ca').expect(200);
      expect(ca.body.items[0]).toMatchObject({
        id: COURSE.B,
        title: 'Història de la Mediterrània',
      });
      const de = await http().get('/api/public/v1/suggest?q=univ&lang=de').expect(200);
      expect(de.body.items).toEqual([
        {
          id: COURSE.C,
          title: 'Geschichte der Universitäten',
          lang: 'de',
          organization_slug: 'uibk',
        },
      ]);
      expect((await suggest('quantum')).map((i) => i.id)).not.toContain(COURSE.D);
    });

    it('needs at least 2 characters and caps the limit at 10', async () => {
      await http().get('/api/public/v1/suggest?q=a').expect(400);
      await http().get('/api/public/v1/suggest?q=ab&limit=11').expect(400);
      expect(await suggest('st')).toEqual([
        expect.objectContaining({ id: COURSE.F, title: 'Applied Statistics' }),
      ]);
    });
  });

  it('GET /reference returns filter vocabularies', async () => {
    const res = await http().get('/api/public/v1/reference').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    const body = referenceResponse.parse(res.body);
    expect(body.organizations.map((o) => o.slug)).toEqual([
      'aurora',
      'uibk',
      'urv',
      'uibk-informatik',
    ]);
    expect(body.organizations[1]).toMatchObject({ is_partner: true, org_type: 'institution' });
    // Only aliases of enabled Keycloak identity providers are published.
    expect(body.organizations.map((o) => o.idp_alias)).toEqual([null, 'uibk', null, null]);
    expect(body.delivery_modes.map((m) => m.code)).toEqual([
      'presential',
      'online',
      'hybrid',
      'blended',
      'coil',
      'joint_delivery',
    ]);
    expect(body.delivery_modes[0]).toEqual({
      code: 'presential',
      label: { en: 'On campus' },
      schema_org: 'Onsite',
    });
    expect(body.isced_broad_fields).toHaveLength(12);
    expect(body.teaching_languages).toEqual(['ca', 'de', 'en', 'es']);
    expect(body.levels).toEqual(['short_cycle', 'bachelor', 'master', 'doctoral', 'other']);
    expect(body.kinds).toEqual([
      { code: 'course', label: { en: 'Course' } },
      { code: 'bip', label: { en: 'Blended Intensive Programme (BIP)' } },
      { code: 'lecture_series', label: { en: 'Lecture series' } },
      { code: 'other', label: { en: 'Other' } },
    ]);
    expect(body.attribute_definitions.map((d) => d.key)).toEqual([
      'educational_hub',
      'sdg',
      'competence_framework',
      'micro_credential',
      'free_course',
      'enrolled_only',
      'open_to_alliance',
      'target_audience',
    ]);
    expect(body.attribute_definitions[1]).toMatchObject({
      key: 'sdg',
      value_type: 'multi_enum',
      label: { en: 'Sustainable Development Goals' },
      filterable: true,
      show_as_tag: true,
    });
    expect(body.attribute_definitions[1]!.options).toHaveLength(17);
    expect(body.attribute_definitions[4]).toMatchObject({ value_type: 'boolean', options: [] });
  });

  it('GET /sitemap.xml lists published course pages', async () => {
    const res = await http().get('/api/public/v1/sitemap.xml').expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/xml/);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(
      [COURSE.A, COURSE.B, COURSE.C, COURSE.F].map((id) => `${PUBLIC_BASE_URL}/en/courses/${id}`),
    );
    expect(res.text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/lastmod>/);
  });
});
