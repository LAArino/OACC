// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { normaliseLanguage } from '../../src/ingestion/oeapi/languages.js';
import {
  type MappedCourse,
  type MappingContext,
  OeapiV5Adapter,
} from '../../src/ingestion/oeapi/oeapi-v5.adapter.js';
import {
  COURSES,
  expandedOffering,
  type FixtureCourse,
  ROOT_ORGANIZATION,
  servedCourse,
} from '../support/oeapi-fixtures.js';

const FETCHED_AT = new Date('2026-10-14T03:00:00Z');
const ctx: MappingContext = {
  organization: {
    id: '0b8f6c1e-6a3d-4c55-9a43-0f3d3c2b9a10',
    extId: null,
    defaultTimezone: 'Europe/Vienna',
    contactEmail: 'aurora@uibk.ac.at',
  },
  iscedBroadFields: new Set([
    '00',
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '99',
  ]),
  fetchedAt: FETCHED_AT,
};
const adapter = new OeapiV5Adapter();

function fixture(courseId: string): FixtureCourse {
  const course = COURSES.find((c) => c.courseId === courseId);
  if (!course) throw new Error(courseId);
  return course;
}

function mapped(courseId: string): MappedCourse {
  const result = adapter.mapCourse(servedCourse(fixture(courseId)), ctx);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

function offering(courseId: string, offeringId: string) {
  const course = fixture(courseId);
  const found = course.offerings.find((o) => o.offeringId === offeringId);
  if (!found) throw new Error(offeringId);
  return adapter.mapOffering(expandedOffering(course, found), mapped(courseId), ctx);
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('language normalisation (spec §6.2.4)', () => {
  it.each([
    ['ger', 'de'],
    ['deu', 'de'],
    ['ice', 'is'],
    ['isl', 'is'],
    ['dut', 'nl'],
    ['nld', 'nl'],
    ['cze', 'cs'],
    ['ces', 'cs'],
    ['fre', 'fr'],
    ['fra', 'fr'],
    ['eng', 'en'],
    ['ita', 'it'],
    ['spa', 'es'],
    ['cat', 'ca'],
    ['dan', 'da'],
    ['gre', 'el'],
    ['rum', 'ro'],
    ['slo', 'sk'],
    ['en-GB', 'en'],
    ['de-AT', 'de'],
    ['EN', 'en'],
    ['haw', 'haw'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseLanguage(input)).toEqual({ kind: 'ok', code: expected });
  });

  it.each(['mul', 'und', 'zxx', 'mis'])('drops %s', (code) => {
    expect(normaliseLanguage(code)).toEqual({ kind: 'dropped', code });
  });

  it.each(['', 'e', 'english', '12', 'x-klingon'])('rejects %j', (code) => {
    expect(normaliseLanguage(code)).toEqual({ kind: 'invalid' });
  });
});

describe('OeapiV5Adapter.mapCourse', () => {
  it('maps a full course (ECTS 7.5, texts per language, level, ISCED, link)', () => {
    const result = adapter.mapCourse(servedCourse(fixture('c-0001')), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    const course = result.value.course;
    expect(course).toMatchObject({
      ext_id: '703001',
      source_ref: 'c-0001',
      status: 'published',
      ects: 7.5,
      level: 'master',
      eqf_level: 7,
      info_url: 'https://lfuonline.uibk.ac.at/public/lfuonline_lv.details?lvnr=703001',
      contact_email: 'aurora@uibk.ac.at',
      isced_codes: ['0613'],
    });
    // en-GB wins over en-US (first variant); de-AT → de.
    expect(Object.keys(course.texts).sort()).toEqual(['de', 'en']);
    expect(course.texts['en']).toMatchObject({
      title: 'Machine Learning for Climate Science',
      description: 'Statistical learning applied to climate data.',
      prerequisites: 'Linear algebra.',
      assessment: 'Project and oral exam.',
      learning_outcomes: 'Select suitable models.\n\nEvaluate forecasts.',
    });
    expect(course.texts['de']?.learning_outcomes).toBe('Geeignete Modelle wählen.');
  });

  it('keeps a German-only course as draft with oecp.content.english_missing', () => {
    const result = adapter.mapCourse(servedCourse(fixture('c-0002')), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.course.status).toBe('draft');
    expect(Object.keys(result.value.course.texts)).toEqual(['de']);
    expect(codes(result.warnings)).toEqual([
      'oecp.oeapi.text_without_title',
      'oecp.content.english_missing',
    ]);
    expect(result.warnings[1]).toMatchObject({
      severity: 'warning',
      pointer: '/name',
      ext_id: '608100',
    });
  });

  it('drops an http link and an invalid ISCED code with warnings', () => {
    const result = adapter.mapCourse(servedCourse(fixture('c-0004')), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.course.info_url).toBeNull();
    expect(result.value.course.isced_codes).toEqual([]);
    expect(result.warnings.map((w) => [w.code, w.pointer])).toEqual([
      ['oecp.oeapi.invalid_isced', '/fieldsOfStudy'],
      ['oecp.oeapi.insecure_link', '/link'],
    ]);
  });

  it('rejects a study load that is not ECTS', () => {
    const result = adapter.mapCourse(servedCourse(fixture('c-0005')), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'oecp.oeapi.study_load_unit',
        pointer: '/studyLoad/studyLoadUnit',
        ext_id: '999001',
      }),
    ]);
    expect(result.identity).toEqual({ extId: '999001', sourceRef: 'c-0005' });
  });

  it.each([
    [{ studyLoad: undefined }, '/studyLoad'],
    [{ studyLoad: { studyLoadUnit: 'ects', value: 0 } }, '/studyLoad/value'],
    [{ studyLoad: { studyLoadUnit: 'ects', value: -3 } }, '/studyLoad/value'],
    [{ studyLoad: { studyLoadUnit: 'ects', value: 121 } }, '/studyLoad/value'],
  ])('rejects study load %j', (patch, at) => {
    const result = adapter.mapCourse({ ...servedCourse(fixture('c-0001')), ...patch }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ pointer: at });
  });

  it('rejects a course without primaryCode', () => {
    const result = adapter.mapCourse(servedCourse(fixture('c-0006')), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'oecp.oeapi.missing_primary_code', pointer: '/primaryCode' }),
    ]);
    expect(result.identity).toEqual({ extId: null, sourceRef: 'c-0006' });
  });

  it('rejects malformed payloads with pointers', () => {
    const result = adapter.mapCourse({ courseId: 'x', name: 'Not an array' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'oecp.oeapi.invalid_payload',
        pointer: '/name',
      });
    }
  });

  it.each([
    ['associate degree', 'short_cycle', 5],
    ['bachelor', 'bachelor', 6],
    ['master', 'master', 7],
    ['doctoral', 'doctoral', 8],
    ['undefined', 'other', null],
    ['secondary vocational education 4', 'other', null],
  ])('maps level %s to %s / EQF %s', (level, expected, eqf) => {
    const result = adapter.mapCourse({ ...servedCourse(fixture('c-0001')), level }, ctx);
    expect(result.ok && [result.value.course.level, result.value.course.eqf_level]).toEqual([
      expected,
      eqf,
    ]);
  });

  it('maps no level to null', () => {
    const { level: _level, ...rest } = servedCourse(fixture('c-0001'));
    const result = adapter.mapCourse(rest, ctx);
    expect(result.ok && [result.value.course.level, result.value.course.eqf_level]).toEqual([
      null,
      null,
    ]);
  });

  it('keeps several valid ISCED codes in order (first is primary) and warns on unknown fields', () => {
    const result = adapter.mapCourse(
      { ...servedCourse(fixture('c-0001')), fieldsOfStudy: '0613, 0611;1234 0613 07' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.course.isced_codes).toEqual(['0613', '0611', '07']);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'oecp.content.unknown_isced_field', severity: 'warning' }),
    ]);
  });

  it('drops text languages mul/und and invalid tags with warnings', () => {
    const result = adapter.mapCourse(
      {
        ...servedCourse(fixture('c-0003')),
        name: [
          { language: 'mul', value: 'Multi' },
          { language: 'en', value: 'European Integration' },
          { language: '!!', value: 'Broken' },
        ],
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.course.texts)).toEqual(['en']);
    expect(result.warnings.map((w) => [w.code, w.pointer])).toEqual([
      ['oecp.oeapi.language_dropped', '/name/0/language'],
      ['oecp.oeapi.invalid_language', '/name/2/language'],
    ]);
  });

  it('truncates titles to 500 characters with a warning', () => {
    const result = adapter.mapCourse(
      { ...servedCourse(fixture('c-0003')), name: [{ language: 'en', value: 'x'.repeat(600) }] },
      ctx,
    );
    expect(result.ok && result.value.course.texts['en']?.title.length).toBe(500);
    expect(result.ok && codes(result.warnings)).toEqual(['oecp.oeapi.value_truncated']);
  });
});

describe('OeapiV5Adapter.mapOffering', () => {
  it('maps dates, seats, modes, language, session and application URL', () => {
    const result = offering('c-0001', 'o-0001-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.value.offering).toEqual({
      course_ext_id: '703001',
      ext_offering_id: '703001-2026S',
      source_ref: 'o-0001-a',
      status: 'published',
      academic_session_ext_id: 'as-ss2026',
      start_date: '2026-03-02',
      end_date: '2026-06-30',
      enrol_start_date: '2026-01-15',
      application_deadline: '2026-02-20',
      timezone: 'Europe/Vienna',
      teaching_languages: ['en'],
      delivery_modes: ['presential', 'online'],
      campus: null,
      max_students: 30,
      alliance_seats: null,
      seats_available: 5,
      seats_updated_at: FETCHED_AT.toISOString(),
      application_url: 'https://lfuonline.uibk.ac.at/apply/703001-2026S',
    });
    expect(result.value.session).toEqual({
      ext_id: 'as-ss2026',
      parent_ext_id: null,
      session_type: 'semester',
      name: { en: 'Summer semester 2026', de: 'Sommersemester 2026' },
      start_date: '2026-03-01',
      end_date: '2026-09-30',
    });
  });

  it('accepts a past enrolment deadline and clamps seats at 0 when over-enrolled', () => {
    const result = offering('c-0001', 'o-0001-b');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.offering).toMatchObject({
      application_deadline: '2026-09-15',
      max_students: 25,
      seats_available: 0,
      teaching_languages: ['en'],
      delivery_modes: ['presential'],
    });
    // German-only session name: English label falls back to it.
    expect(result.value.session?.name).toEqual({
      en: 'Wintersemester 2026/27',
      de: 'Wintersemester 2026/27',
    });
  });

  it('uses the course language and mode when the offering has none; no seats without enrolled', () => {
    const result = offering('c-0002', 'o-0002-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.offering).toMatchObject({
      teaching_languages: ['de'],
      delivery_modes: ['presential'],
      max_students: 40,
      seats_available: null,
      seats_updated_at: null,
      academic_session_ext_id: null,
    });
  });

  it('drops teachingLanguage mul with a warning and falls back to the course language', () => {
    const result = offering('c-0003', 'o-0003-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.offering.teaching_languages).toEqual(['en']);
    expect(result.value.offering.delivery_modes).toEqual(['hybrid']);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'oecp.oeapi.language_dropped',
        pointer: '/teachingLanguage',
      }),
    ]);
  });

  it('rejects an offering when neither it nor its course has a usable language', () => {
    const course = { ...mapped('c-0003') };
    course.source = { ...course.source, teachingLanguage: 'und' };
    const result = adapter.mapOffering(
      {
        ...expandedOffering(fixture('c-0003'), fixture('c-0003').offerings[0]!),
        teachingLanguage: 'mul',
      },
      course,
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['oecp.oeapi.missing_teaching_language']);
      expect(codes(result.warnings)).toEqual([
        'oecp.oeapi.language_dropped',
        'oecp.oeapi.language_dropped',
      ]);
    }
  });

  it('reports a mul course inherited by its offering once (mock 620050)', () => {
    const course = { ...mapped('c-0003') };
    course.source = { ...course.source, teachingLanguage: 'mul' };
    const result = adapter.mapOffering(
      {
        ...expandedOffering(fixture('c-0003'), fixture('c-0003').offerings[0]!),
        teachingLanguage: 'mul',
      },
      course,
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['oecp.oeapi.missing_teaching_language']);
      expect(codes(result.warnings)).toEqual(['oecp.oeapi.language_dropped']);
    }
  });

  it('warns about unmappable modes next to mappable ones and drops http links', () => {
    const result = offering('c-0004', 'o-0004-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.offering.delivery_modes).toEqual(['presential']);
    expect(result.value.offering.application_url).toBeNull();
    expect(result.warnings.map((w) => [w.code, w.pointer])).toEqual([
      ['oecp.oeapi.unmappable_delivery_mode', '/modeOfDelivery'],
      ['oecp.oeapi.insecure_link', '/link'],
    ]);
  });

  it('rejects an offering without any mappable delivery mode', () => {
    const result = offering('c-0007', 'o-0007-b');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          code: 'oecp.oeapi.unmappable_delivery_mode',
          pointer: '/modeOfDelivery',
          ext_id: '120500-X',
        }),
      ]);
    }
  });

  it('falls back to offeringId as natural key and maps ice → is, distance-learning → online', () => {
    const result = offering('c-0007', 'o-0007-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.offering).toMatchObject({
      ext_offering_id: 'o-0007-a',
      teaching_languages: ['is'],
      delivery_modes: ['online'],
    });
  });

  it.each([
    ['online', 'online'],
    ['distance-learning', 'online'],
    ['on campus', 'presential'],
    ['situated', 'presential'],
    ['hybrid', 'hybrid'],
    ['On Campus', 'presential'],
  ])('maps modeOfDelivery %s → %s', (mode, code) => {
    const course = fixture('c-0001');
    const result = adapter.mapOffering(
      { ...expandedOffering(course, course.offerings[0]!), modeOfDelivery: [mode] },
      mapped('c-0001'),
      ctx,
    );
    expect(result.ok && result.value.offering.delivery_modes).toEqual([code]);
  });

  it('ignores maxNumberStudents 0 with a warning', () => {
    const course = fixture('c-0001');
    const result = adapter.mapOffering(
      { ...expandedOffering(course, course.offerings[0]!), maxNumberStudents: 0 },
      mapped('c-0001'),
      ctx,
    );
    expect(result.ok && result.value.offering.max_students).toBeNull();
    expect(result.ok && result.value.offering.seats_available).toBeNull();
    expect(result.ok && codes(result.warnings)).toEqual(['oecp.oeapi.invalid_student_counts']);
  });

  it('rejects offerings whose dates are out of order, pointing at the source member', () => {
    const course = fixture('c-0001');
    const result = adapter.mapOffering(
      { ...expandedOffering(course, course.offerings[0]!), endDate: '2026-01-01' },
      mapped('c-0001'),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'oecp.content.date_order', pointer: '/endDate' }),
      );
    }
  });

  it('keeps an unexpanded academic session reference for the writer to resolve', () => {
    const course = fixture('c-0001');
    const result = adapter.mapOffering(
      { ...course.offerings[0]!, course: course.courseId },
      mapped('c-0001'),
      ctx,
    );
    expect(result.ok && result.value.offering.academic_session_ext_id).toBe('as-ss2026');
    expect(result.ok && result.value.session).toBeNull();
  });

  it('rejects offerings without startDate', () => {
    const course = fixture('c-0001');
    const { startDate: _s, ...rest } = expandedOffering(course, course.offerings[0]!);
    const result = adapter.mapOffering(rest, mapped('c-0001'), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        code: 'oecp.oeapi.invalid_payload',
        pointer: '/startDate',
      });
    }
  });
});

describe('OeapiV5Adapter.mapRootOrganization', () => {
  it('accepts the root organization when the partner has no ext_id', () => {
    expect(adapter.mapRootOrganization(ROOT_ORGANIZATION, ctx).ok).toBe(true);
  });

  it('matches the partner ext_id against primaryCode.code or organizationId', () => {
    const withExt = (extId: string) => ({ ...ctx, organization: { ...ctx.organization, extId } });
    expect(adapter.mapRootOrganization(ROOT_ORGANIZATION, withExt('uibk.ac.at')).ok).toBe(true);
    expect(
      adapter.mapRootOrganization(ROOT_ORGANIZATION, withExt(ROOT_ORGANIZATION.organizationId)).ok,
    ).toBe(true);
    const mismatch = adapter.mapRootOrganization(ROOT_ORGANIZATION, withExt('hi.is'));
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(codes(mismatch.errors)).toEqual(['oecp.oeapi.root_not_matched']);
  });

  it('rejects a non-root organization', () => {
    const result = adapter.mapRootOrganization(
      { ...ROOT_ORGANIZATION, organizationType: 'faculty' },
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});
