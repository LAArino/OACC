// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  adminCourseListQuery,
  courseInput,
  courseOverridesPatch,
  courseOverrideKey,
  csvReferenceDataFromAdminReference,
  ERROR_CODES,
  FORM_LANGUAGE_TAGS,
  offeringInput,
  offeringOverridesPatch,
  parseCourseOverrideKey,
  statusChangeRequest,
} from '../src/index.js';

const codes = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => i.message);

const minimalCourse = {
  ext_id: 'AUR-101',
  levels: ['master'],
  ects: 5,
  isced_codes: [{ code: '0613' }],
};

const minimalOffering = {
  ext_offering_id: 'AUR-101-2027S',
  start_date: '2027-03-01',
  end_date: '2027-06-30',
  teaching_languages: ['en'],
  delivery_modes: ['online'],
};

describe('courseInput', () => {
  it('accepts a minimal draft without texts and applies defaults', () => {
    const parsed = courseInput.parse(minimalCourse);
    expect(parsed).toMatchObject({
      kind: 'course',
      attributes: {},
      texts: {},
      isced_codes: [{ code: '0613', is_primary: true }],
    });
    expect(parsed.status).toBeUndefined();
  });

  it('requires English to publish, a title per language and supported languages', () => {
    expect(codes(courseInput.safeParse({ ...minimalCourse, status: 'published' }))).toContain(
      'oecp.content.english_missing',
    );
    const published = courseInput.safeParse({
      ...minimalCourse,
      status: 'published',
      texts: { en: { title: 'Data', abstract: '  ', keywords: ['ml'] } },
    });
    expect(published.success).toBe(true);
    expect(published.data?.texts.en).toMatchObject({ title: 'Data', abstract: null });
    expect(
      courseInput.safeParse({ ...minimalCourse, texts: { de: { abstract: 'x' } } }).success,
    ).toBe(false);
    expect(
      codes(courseInput.safeParse({ ...minimalCourse, texts: { xx: { title: 'Nope' } } })),
    ).toContain('oecp.content.unsupported_language');
  });

  it('checks codes, levels, ECTS precision, URLs and unknown members', () => {
    expect(codes(courseInput.safeParse({ ...minimalCourse, ext_id: '-bad' }))).toContain(
      'oecp.content.invalid_code',
    );
    expect(courseInput.safeParse({ ...minimalCourse, levels: [] }).success).toBe(false);
    expect(courseInput.safeParse({ ...minimalCourse, levels: ['master', 'master'] }).success).toBe(
      false,
    );
    expect(courseInput.safeParse({ ...minimalCourse, ects: 7.5 }).success).toBe(true);
    expect(courseInput.safeParse({ ...minimalCourse, ects: 7.555 }).success).toBe(false);
    expect(courseInput.safeParse({ ...minimalCourse, ects: 0 }).success).toBe(false);
    expect(courseInput.safeParse({ ...minimalCourse, info_url: 'http://x.org' }).success).toBe(
      false,
    );
    expect(courseInput.safeParse({ ...minimalCourse, level: 'master' }).success).toBe(false);
    expect(courseInput.safeParse({ ...minimalCourse, status: 'withdrawn' }).success).toBe(false);
  });

  it('checks ISCED codes: pattern, broad field, duplicates, one primary', () => {
    expect(courseInput.safeParse({ ...minimalCourse, isced_codes: [] }).success).toBe(false);
    expect(
      codes(courseInput.safeParse({ ...minimalCourse, isced_codes: [{ code: '1x' }] })),
    ).toEqual(['oecp.content.invalid_value']);
    expect(
      codes(courseInput.safeParse({ ...minimalCourse, isced_codes: [{ code: '1201' }] })),
    ).toEqual(['oecp.content.unknown_isced_field']);
    expect(
      codes(
        courseInput.safeParse({
          ...minimalCourse,
          isced_codes: [{ code: '0613' }, { code: '0613' }],
        }),
      ),
    ).toContain('oecp.content.duplicate_isced');
    expect(
      courseInput.safeParse({
        ...minimalCourse,
        isced_codes: [
          { code: '0613', is_primary: true },
          { code: '0611', is_primary: true },
        ],
      }).success,
    ).toBe(false);
    const parsed = courseInput.parse({
      ...minimalCourse,
      isced_codes: [{ code: '0611' }, { code: '0613', is_primary: true }],
    });
    expect(parsed.isced_codes).toEqual([
      { code: '0611', is_primary: false },
      { code: '0613', is_primary: true },
    ]);
  });
});

describe('offeringInput', () => {
  it('accepts a minimal offering', () => {
    const parsed = offeringInput.parse(minimalOffering);
    expect(parsed.application_instructions).toEqual({});
    expect(parsed.timezone).toBeUndefined();
  });

  it('enforces the DDL date and seat rules', () => {
    const issues = (patch: Record<string, unknown>) =>
      codes(offeringInput.safeParse({ ...minimalOffering, ...patch }));
    expect(issues({ end_date: '2027-02-01' })).toEqual(['oecp.content.date_order']);
    expect(issues({ application_deadline: '2027-07-01' })).toEqual(['oecp.content.date_order']);
    expect(issues({ enrol_start_date: '2027-02-10', application_deadline: '2027-02-01' })).toEqual([
      'oecp.content.date_order',
    ]);
    expect(issues({ max_students: 10, alliance_seats: 11 })).toEqual([
      'oecp.content.seats_exceed_capacity',
    ]);
    expect(issues({ max_students: 10, seats_available: 11 })).toEqual([
      'oecp.content.seats_exceed_capacity',
    ]);
    expect(issues({ timezone: 'Mars/Olympus' }).length).toBe(1);
    expect(issues({ teaching_languages: ['en', 'en'] }).length).toBe(1);
    expect(issues({ teaching_languages: ['en-GB'] })).toEqual([
      'oecp.content.unsupported_language',
    ]);
    expect(issues({ delivery_modes: [] }).length).toBe(1);
    expect(issues({ application_instructions: { de: 'Bewerbung' } })).toEqual([]);
  });
});

describe('override keys and patches', () => {
  it('parses and formats course override keys', () => {
    expect(parseCourseOverrideKey('ects')).toEqual({ kind: 'course', field: 'ects' });
    expect(parseCourseOverrideKey('texts.de.title')).toEqual({
      kind: 'text',
      lang: 'de',
      field: 'title',
    });
    expect(parseCourseOverrideKey('texts.de.is_machine_translated')).toBeNull();
    expect(parseCourseOverrideKey('texts.de-AT.title')).toBeNull();
    expect(parseCourseOverrideKey('ext_id')).toBeNull();
    expect(parseCourseOverrideKey('level')).toBeNull();
    expect(courseOverrideKey({ kind: 'text', lang: 'ca', field: 'keywords' })).toBe(
      'texts.ca.keywords',
    );
    expect(courseOverrideKey({ kind: 'course', field: 'status' })).toBe('status');
  });

  it('validates values per key and normalises them', () => {
    const parsed = courseOverridesPatch.parse({
      set: {
        ects: 6,
        info_url: null,
        isced_codes: [{ code: '0511' }, { code: '0613', is_primary: true }],
        'texts.en.abstract': '  ',
        'texts.de.title': 'Daten',
      },
      clear: ['status', 'status'],
    });
    expect(parsed).toEqual({
      set: {
        ects: 6,
        info_url: null,
        isced_codes: [
          { code: '0511', is_primary: false },
          { code: '0613', is_primary: true },
        ],
        'texts.en.abstract': null,
        'texts.de.title': 'Daten',
      },
      clear: ['status'],
    });
  });

  it('refuses unknown keys, invalid values, a key in set and clear, and empty patches', () => {
    expect(codes(courseOverridesPatch.safeParse({ set: { ext_id: 'X' } }))).toEqual([
      'oecp.content.override_not_allowed',
    ]);
    expect(codes(courseOverridesPatch.safeParse({ clear: ['source_ref'] }))).toEqual([
      'oecp.content.override_not_allowed',
    ]);
    expect(courseOverridesPatch.safeParse({ set: { ects: -1 } }).success).toBe(false);
    expect(courseOverridesPatch.safeParse({ set: { 'texts.en.title': '' } }).success).toBe(false);
    expect(courseOverridesPatch.safeParse({ set: { status: 'gone' } }).success).toBe(false);
    expect(courseOverridesPatch.safeParse({ set: { ects: 5 }, clear: ['ects'] }).success).toBe(
      false,
    );
    expect(courseOverridesPatch.safeParse({}).success).toBe(false);
    expect(courseOverridesPatch.safeParse({ set: {}, clear: [], x: 1 }).success).toBe(false);
  });

  it('validates offering override values', () => {
    expect(
      offeringOverridesPatch.parse({ set: { seats_available: 3, campus: ' ' }, clear: [] }),
    ).toEqual({ set: { seats_available: 3, campus: null }, clear: [] });
    expect(offeringOverridesPatch.safeParse({ set: { seats_updated_at: null } }).success).toBe(
      false,
    );
    expect(offeringOverridesPatch.safeParse({ set: { teaching_languages: [] } }).success).toBe(
      false,
    );
    expect(offeringOverridesPatch.safeParse({ set: { start_date: '2027-02-30' } }).success).toBe(
      false,
    );
  });
});

describe('other admin course contracts', () => {
  it('reads repeated and bracketed list parameters', () => {
    expect(
      adminCourseListQuery.parse({ 'status[]': ['draft', 'published'], kind: 'bip', page: '2' }),
    ).toEqual({
      status: ['draft', 'published'],
      kind: ['bip'],
      source_channel: [],
      page: 2,
      page_size: 20,
    });
    expect(adminCourseListQuery.safeParse({ page_size: '101' }).success).toBe(false);
    expect(adminCourseListQuery.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('accepts every lifecycle status for status changes', () => {
    expect(statusChangeRequest.safeParse({ status: 'cancelled' }).success).toBe(true);
    expect(statusChangeRequest.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('turns the admin reference into CSV reference data', () => {
    expect(
      csvReferenceDataFromAdminReference({
        isced_broad_fields: [{ code: '06', label: { en: 'ICT' } }],
        delivery_modes: [{ code: 'online', label: { en: 'Online' } }],
        teaching_units: [
          { id: '0a000000-0000-4000-8000-000000000003', ext_id: 'FAC', name: { en: 'F' } },
        ],
        attribute_definitions: [],
      }),
    ).toEqual({
      iscedCodes: ['06'],
      deliveryModes: ['online'],
      teachingUnitCodes: ['FAC'],
      attributeDefinitions: [],
    });
  });

  it('lists 29 languages and registers the new error codes', () => {
    expect(FORM_LANGUAGE_TAGS).toHaveLength(29);
    expect(new Set(FORM_LANGUAGE_TAGS).size).toBe(29);
    for (const code of [
      'oecp.content.duplicate_ext_id',
      'oecp.content.ext_id_immutable',
      'oecp.content.override_not_allowed',
      'oecp.content.has_published_offerings',
    ] as const) {
      expect(ERROR_CODES[code].severity).toBe('error');
    }
  });
});
