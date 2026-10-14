// SPDX-License-Identifier: EUPL-1.2
import { readFileSync } from 'node:fs';
import { attributeDefinitionSeedFile } from '../../src/cli/seed-attribute-definitions.js';
import {
  course as courseSchema,
  courseOffering as courseOfferingSchema,
  type NormalizedCourseRow,
  type NormalizedOfferingRow,
  validateCsvFiles,
  validateCsvRows,
} from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import {
  CsvAdapter,
  type ExistingCourse,
  type ExistingOffering,
} from '../../src/ingestion/csv/csv.adapter.js';

const adapter = new CsvAdapter();
const UPLOADED = new Date('2026-10-14T09:00:00Z');
const ctx = { defaultTimezone: 'Europe/Brussels', uploadedAt: UPLOADED };

function courseRow(row: Record<string, string>): NormalizedCourseRow {
  const result = validateCsvRows('courses', [row]);
  expect(result.errors).toEqual([]);
  return result.normalized[0] as NormalizedCourseRow;
}

function offeringRow(row: Record<string, string>): NormalizedOfferingRow {
  const result = validateCsvRows('offerings', [row]);
  expect(result.errors).toEqual([]);
  return result.normalized[0] as NormalizedOfferingRow;
}

const baseCourse = {
  template_version: '1.0',
  course_code: 'C-1',
  status: 'published',
  ects: '7.5',
  isced_codes: '0613|0611',
  title_en: 'Machine learning',
};

const baseOffering = {
  template_version: '1.0',
  course_code: 'C-1',
  offering_code: '2027S',
  status: 'published',
  start_date: '2027-02-01',
  end_date: '2027-06-30',
  teaching_languages: 'en|de',
  delivery_modes: 'online',
};

const existingCourse: ExistingCourse = {
  kind: 'course',
  level: 'master',
  levels: ['master'],
  attributes: {},
  eqf_level: 7,
  teaching_hours: 42,
  teaching_unit_ext_id: 'FAC',
  info_url: 'https://old.example.org',
  contact_email: 'old@example.org',
  texts: {
    en: {
      title: 'Old',
      abstract: 'Old abstract',
      description: 'Old description',
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: ['old'],
      is_machine_translated: false,
    },
    de: {
      title: 'Alt',
      abstract: null,
      description: null,
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: [],
      is_machine_translated: true,
    },
    fr: {
      title: 'Ancien',
      abstract: null,
      description: null,
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: [],
      is_machine_translated: false,
    },
  },
};

describe('CsvAdapter.mapCourse', () => {
  it('builds the canonical course DTO of a new course', () => {
    const result = adapter.mapCourse(
      courseRow({
        ...baseCourse,
        level: 'master',
        eqf_level: '7',
        abstract_en: 'Intro',
        keywords_en: 'ml|ai',
        title_de: 'Maschinelles Lernen',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.course).toEqual({
      ext_id: 'C-1',
      source_ref: null,
      status: 'published',
      kind: 'course',
      ects: 7.5,
      level: 'master',
      levels: ['master'],
      eqf_level: 7,
      teaching_hours: null,
      teaching_unit_ext_id: null,
      info_url: null,
      contact_email: null,
      isced_codes: ['0613', '0611'],
      texts: {
        de: {
          title: 'Maschinelles Lernen',
          abstract: null,
          description: null,
          learning_outcomes: null,
          prerequisites: null,
          assessment: null,
          keywords: [],
          is_machine_translated: false,
        },
        en: {
          title: 'Machine learning',
          abstract: 'Intro',
          description: null,
          learning_outcomes: null,
          prerequisites: null,
          assessment: null,
          keywords: ['ml', 'ai'],
          is_machine_translated: false,
        },
      },
      attributes: {},
    });
    expect(result.value.raw).toMatchObject({ course_code: 'C-1', abstract_en: 'Intro' });
    expect(courseSchema.safeParse(result.value.course).success).toBe(true);
  });

  it('keeps absent columns and languages, clears empty cells, deletes empty languages', () => {
    const result = adapter.mapCourse(
      courseRow({ ...baseCourse, info_url: '', abstract_en: 'New', title_de: '' }),
      existingCourse,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const course = result.value.course;
    expect(course).toMatchObject({
      level: 'master',
      eqf_level: 7,
      teaching_hours: 42,
      teaching_unit_ext_id: 'FAC',
      contact_email: 'old@example.org',
      info_url: null,
    });
    expect(Object.keys(course.texts)).toEqual(['en', 'fr']);
    expect(course.texts['en']).toMatchObject({
      title: 'Machine learning',
      abstract: 'New',
      description: 'Old description',
      keywords: ['old'],
    });
    expect(course.texts['fr']?.title).toBe('Ancien');
  });
});

describe('CsvAdapter.mapOffering', () => {
  it('builds the canonical offering DTO with defaults', () => {
    const result = adapter.mapOffering(
      offeringRow({ ...baseOffering, seats_available: '4', max_students: '20' }),
      undefined,
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.offering).toEqual({
      course_ext_id: 'C-1',
      ext_offering_id: '2027S',
      source_ref: null,
      status: 'published',
      academic_session_ext_id: null,
      start_date: '2027-02-01',
      end_date: '2027-06-30',
      enrol_start_date: null,
      application_deadline: null,
      timezone: 'Europe/Brussels',
      teaching_languages: ['en', 'de'],
      delivery_modes: ['online'],
      campus: null,
      max_students: 20,
      alliance_seats: null,
      seats_available: 4,
      seats_updated_at: UPLOADED.toISOString(),
      application_url: null,
      application_instructions: {},
    });
    expect(courseOfferingSchema.safeParse(result.value.offering).success).toBe(true);
  });

  it('keeps absent columns, including seats and their timestamp', () => {
    const existing: ExistingOffering = {
      academic_session_ext_id: 'S1',
      enrol_start_date: '2026-11-01',
      application_deadline: '2027-01-10',
      timezone: 'Europe/Vienna',
      campus: 'Innsbruck',
      max_students: 30,
      alliance_seats: 5,
      seats_available: 3,
      seats_updated_at: '2026-09-01T00:00:00.000Z',
      application_url: 'https://apply.example.org',
      application_instructions: { en: 'Old instructions' },
    };
    const result = adapter.mapOffering(offeringRow({ ...baseOffering, campus: '' }), existing, ctx);
    expect(result.ok && result.value.offering).toMatchObject({
      academic_session_ext_id: 'S1',
      timezone: 'Europe/Vienna',
      campus: null,
      seats_available: 3,
      seats_updated_at: '2026-09-01T00:00:00.000Z',
      application_url: 'https://apply.example.org',
    });
  });

  it('reports canonical violations caused by kept values with row and column', () => {
    const existing = { application_deadline: '2027-06-01' } as ExistingOffering;
    const result = adapter.mapOffering(
      offeringRow({ ...baseOffering, end_date: '2027-05-01' }),
      existing,
      ctx,
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: 'oecp.content.date_order',
          file: 'offerings',
          row: 2,
          column: 'application_deadline',
        }),
      ],
    });
  });

  it('derives minimal sessions for unknown codes only', () => {
    const offerings = [
      '2027-02-01:2027-03-01:S2',
      '2027-01-15:2027-06-30:S2',
      '2027-01-01:2027-02-01:OLD',
    ]
      .map((spec) => spec.split(':'))
      .map(([start, end, code]) => {
        const r = adapter.mapOffering(
          offeringRow({
            ...baseOffering,
            start_date: start ?? '',
            end_date: end ?? '',
            academic_session_code: code ?? '',
          }),
          undefined,
          ctx,
        );
        if (!r.ok) throw new Error('unexpected');
        return r.value.offering;
      });
    expect(adapter.sessionsFor(offerings, new Set(['OLD'])).map((s) => s.session)).toEqual([
      {
        ext_id: 'S2',
        parent_ext_id: null,
        session_type: 'period',
        name: { en: 'S2' },
        start_date: '2027-01-15',
        end_date: '2027-06-30',
      },
    ]);
  });
});

describe('template 1.1 columns', () => {
  const definitions = attributeDefinitionSeedFile.parse(
    JSON.parse(
      readFileSync(
        new URL('../../db/seed/attribute-definitions.aurora.json', import.meta.url),
        'utf8',
      ),
    ),
  ).attribute_definitions;
  const rows = (row: Record<string, string>) => {
    const result = validateCsvRows('courses', [row], {
      referenceData: { attributeDefinitions: definitions },
    });
    expect(result.errors).toEqual([]);
    return result.normalized[0] as NormalizedCourseRow;
  };

  it('merges attribute columns into the current attributes; absent keys stay', () => {
    const existing: ExistingCourse = {
      ...existingCourse,
      kind: 'bip',
      levels: ['master', 'bachelor'],
      attributes: { free_course: true, sdg: ['sdg01'] },
    };
    const result = adapter.mapCourse(
      rows({
        ...baseCourse,
        template_version: '1.1',
        attr_sdg: 'sdg13|sdg04',
        attr_free_course: '',
        attr_micro_credential: 'no',
      }),
      existing,
    );
    expect(result.ok && result.value.course).toMatchObject({
      kind: 'bip',
      level: 'master',
      levels: ['master', 'bachelor'],
      attributes: { micro_credential: false, sdg: ['sdg04', 'sdg13'] },
    });
    expect(result.ok && Object.keys(result.value.course.attributes)).toEqual([
      'micro_credential',
      'sdg',
    ]);
  });

  it('sets kind and levels; empty cells reset them', () => {
    const set = adapter.mapCourse(
      rows({
        ...baseCourse,
        template_version: '1.1',
        kind: 'lecture_series',
        levels: 'bachelor|master',
      }),
      existingCourse,
    );
    expect(set.ok && set.value.course).toMatchObject({
      kind: 'lecture_series',
      level: 'bachelor',
      levels: ['bachelor', 'master'],
    });
    const cleared = adapter.mapCourse(
      rows({ ...baseCourse, template_version: '1.1', kind: '', levels: '' }),
      { ...existingCourse, kind: 'bip' },
    );
    expect(cleared.ok && cleared.value.course).toMatchObject({
      kind: 'course',
      level: null,
      levels: [],
    });
  });

  it('merges application instructions per language', () => {
    const result = adapter.mapOffering(
      offeringRow({
        ...baseOffering,
        template_version: '1.1',
        application_instructions_de: 'Bewerbung über das Aurora-Büro.',
        application_instructions_fr: '',
      }),
      {
        academic_session_ext_id: null,
        enrol_start_date: null,
        application_deadline: null,
        timezone: 'Europe/Vienna',
        campus: null,
        max_students: null,
        alliance_seats: null,
        seats_available: null,
        seats_updated_at: null,
        application_url: null,
        application_instructions: { en: 'Apply via your Aurora office.', fr: 'Postulez.' },
      },
      ctx,
    );
    expect(result.ok && result.value.offering.application_instructions).toEqual({
      de: 'Bewerbung über das Aurora-Büro.',
      en: 'Apply via your Aurora office.',
    });
  });
});

describe('Aurora Virtual Campus fixture', () => {
  const read = (file: string) =>
    readFileSync(
      new URL(`../fixtures/csv/aurora-virtual-campus.${file}.csv`, import.meta.url),
      'utf8',
    );

  it('validates and maps without issues', () => {
    const result = validateCsvFiles(
      { courses: read('courses'), offerings: read('offerings') },
      {
        referenceData: {
          iscedCodes: ['01', '02', '03', '04', '05', '06'],
          deliveryModes: ['online', 'blended', 'hybrid', 'presential'],
          teachingUnitCodes: [],
          courseCodes: [],
          attributeDefinitions: attributeDefinitionSeedFile.parse(
            JSON.parse(
              readFileSync(
                new URL('../../db/seed/attribute-definitions.aurora.json', import.meta.url),
                'utf8',
              ),
            ),
          ).attribute_definitions,
        },
      },
    );
    expect(result.courses?.errors).toEqual([]);
    expect(result.offerings?.errors).toEqual([]);
    expect(result.warningCount).toBe(0);
    expect(result.courses?.normalized).toHaveLength(8);
    expect(result.offerings?.normalized).toHaveLength(8);
    const courses = (result.courses?.normalized ?? []).map((row) => {
      const mapped = adapter.mapCourse(row);
      expect(mapped.ok).toBe(true);
      return mapped.ok ? mapped.value.course : null;
    });
    const byCode = new Map(courses.map((c) => [c?.ext_id, c]));
    expect(byCode.get('AVC-BIP-AI-ETHICS')).toMatchObject({
      kind: 'bip',
      levels: ['bachelor', 'master'],
      attributes: { educational_hub: ['digital_society_global_citizenship'], free_course: true },
    });
    expect(byCode.get('AVC-IDENT-DIV')?.kind).toBe('lecture_series');
    expect(courses.filter((c) => c?.kind === 'bip')).toHaveLength(2);
    for (const row of result.offerings?.normalized ?? []) {
      const mapped = adapter.mapOffering(row, undefined, ctx);
      expect(mapped.ok && mapped.value.offering.application_url).toBeNull();
      expect(mapped.ok && mapped.value.offering.application_instructions.en).toMatch(
        /^Apply through the Aurora office of your home university/,
      );
    }
  });
});
