// SPDX-License-Identifier: EUPL-1.2
// Decision 21 (Aurora IT Handbook §3.4): instructors, the five optional texts,
// CSV template 1.2 and the publication rule.
import { describe, expect, it } from 'vitest';
import {
  adminCourse,
  completeness,
  type CompletenessCourse,
  type CompletenessOffering,
  course,
  courseCompleteness,
  courseInput,
  courseOverridesPatch,
  csvColumnVersion,
  csvTemplate,
  ERROR_CODES,
  HANDBOOK_FIELD_LABELS,
  HANDBOOK_MISSING_FIELDS,
  handbookIncompleteMessage,
  oeapiV5Course,
  publishRuleMode,
  syncRunDetail,
  validateCsvText,
} from '../src/index.js';

const codes = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => i.message);

const completeCourse: CompletenessCourse = {
  texts: {
    en: {
      title: 'Machine Learning',
      description: 'Statistics and models.',
      learning_outcomes: 'Train a model.',
      prerequisites: 'Linear algebra.',
      assessment: 'Written exam.',
    },
  },
  ects: 5,
  levels: ['master'],
  contact_email: 'courses@uni.example',
  instructors: ['Course team, University of Iceland'],
};

const completeOffering: CompletenessOffering = {
  status: 'published',
  start_date: '2027-02-01',
  end_date: '2027-06-30',
  enrol_start_date: '2026-11-01',
  application_deadline: '2027-01-15',
  teaching_languages: ['en'],
  delivery_modes: ['online'],
};

describe('completeness (publication rule, decision 21c)', () => {
  it('accepts a course with every obligatory field', () => {
    expect(completeness(completeCourse, [completeOffering])).toEqual({
      complete: true,
      missing: [],
    });
  });

  it('names every missing course field, in a stable order', () => {
    const result = completeness(
      {
        texts: { de: { title: 'Nur Deutsch' } },
        ects: 0,
        levels: [],
        contact_email: null,
        instructors: [],
      },
      [completeOffering],
    );
    expect(result).toEqual({
      complete: false,
      missing: [
        'texts.en.title',
        'texts.en.description',
        'texts.en.learning_outcomes',
        'texts.en.prerequisites',
        'texts.en.assessment',
        'ects',
        'levels',
        'contact_email',
        'instructors',
      ],
    });
    expect(courseCompleteness.parse(result)).toEqual(result);
  });

  it('treats blank texts and blank instructors as missing', () => {
    const result = completeness(
      {
        ...completeCourse,
        texts: { en: { ...completeCourse.texts['en'], assessment: '   ' } },
        instructors: [' '],
      },
      [completeOffering],
    );
    expect(result.missing).toEqual(['texts.en.assessment', 'instructors']);
  });

  it("accepts the organization's contact for a course without one", () => {
    const course = { ...completeCourse, contact_email: null };
    expect(completeness(course, [completeOffering]).missing).toEqual(['contact_email']);
    expect(
      completeness(course, [completeOffering], { organizationContactEmail: 'aurora@uni.example' }),
    ).toEqual({ complete: true, missing: [] });
  });

  it('needs a published offering; drafts and cancelled offerings do not count', () => {
    expect(completeness(completeCourse, []).missing).toEqual(['offerings']);
    expect(
      completeness(completeCourse, [
        { ...completeOffering, status: 'draft' },
        { ...completeOffering, status: 'cancelled' },
      ]).missing,
    ).toEqual(['offerings']);
    // Without a status (e.g. a canonical DTO list) an offering counts as published.
    const { status: _s, ...noStatus } = completeOffering;
    expect(completeness(completeCourse, [noStatus]).complete).toBe(true);
  });

  it('is complete with one complete published offering, else reports the most complete one', () => {
    const partial = { ...completeOffering, enrol_start_date: null, application_deadline: '' };
    const poorer = { ...partial, delivery_modes: [], teaching_languages: [] };
    expect(completeness(completeCourse, [partial, completeOffering]).complete).toBe(true);
    expect(completeness(completeCourse, [poorer, partial]).missing).toEqual([
      'offerings.enrol_start_date',
      'offerings.application_deadline',
    ]);
    expect(completeness(completeCourse, [poorer]).missing).toEqual([
      'offerings.enrol_start_date',
      'offerings.application_deadline',
      'offerings.teaching_languages',
      'offerings.delivery_modes',
    ]);
  });

  it('accepts canonical DTOs as they are', () => {
    const dto = course.parse({
      ext_id: 'C1',
      status: 'published',
      ects: 5,
      levels: ['master'],
      contact_email: 'c@uni.example',
      instructors: ['Dr. A. Example'],
      texts: { en: completeCourse.texts['en'] },
    });
    expect(completeness(dto, [completeOffering]).complete).toBe(true);
  });

  it('labels every field and builds the warning message', () => {
    expect(Object.keys(HANDBOOK_FIELD_LABELS).sort()).toEqual([...HANDBOOK_MISSING_FIELDS].sort());
    expect(ERROR_CODES['oecp.content.handbook_incomplete'].severity).toBe('warning');
    expect(handbookIncompleteMessage(['instructors', 'offerings'])).toBe(
      'Course is missing fields the Aurora IT Handbook requires to publish: instructors, offerings',
    );
  });

  it('parses OECP_PUBLISH_RULE values', () => {
    expect(publishRuleMode.parse('warn')).toBe('warn');
    expect(publishRuleMode.parse('enforce')).toBe('enforce');
    expect(publishRuleMode.safeParse('block').success).toBe(false);
  });
});

describe('instructors and handbook texts in the canonical model', () => {
  const base = {
    ext_id: 'C1',
    status: 'draft',
    ects: 5,
    texts: { en: { title: 'T' } },
  } as const;

  it('defaults instructors to [] and trims entries', () => {
    expect(course.parse(base).instructors).toEqual([]);
    expect(course.parse({ ...base, instructors: ['  Course team  '] }).instructors).toEqual([
      'Course team',
    ]);
  });

  it.each([
    ['an empty entry', ['']],
    ['an entry over 200 characters', ['x'.repeat(201)]],
    ['more than 50 entries', Array.from({ length: 51 }, (_, i) => `Teacher ${i}`)],
    ['duplicates', ['A', 'A']],
  ])('refuses %s', (_label, instructors) => {
    expect(codes(course.safeParse({ ...base, instructors }))).toContain(
      'oecp.content.invalid_value',
    );
  });

  it('accepts the five optional texts per language', () => {
    const parsed = course.parse({
      ...base,
      texts: {
        en: {
          title: 'T',
          mode_of_repetition: 'Every winter semester.',
          methods: 'Seminars.',
          literature: 'Reading list.',
          privacy_notice: 'See the university privacy notice.',
          remarks: null,
        },
      },
    });
    expect(parsed.texts['en']).toMatchObject({ methods: 'Seminars.', remarks: null });
  });
});

describe('CSV template 1.2', () => {
  const header12 =
    'template_version,course_code,status,ects,isced_codes,title_en,instructors,methods_en,literature_en,mode_of_repetition_de,title_de';

  it('reads instructors (trimmed, distinct) and the per-language texts', () => {
    const result = validateCsvText(
      'courses',
      `${header12}\n1.2,C1,published,5,0613,T," Course team, University of Iceland | Dr. A. Example |Dr. A. Example",Seminars.,,Jedes Wintersemester.,Titel\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.normalized[0]).toMatchObject({
      instructors: ['Course team, University of Iceland', 'Dr. A. Example'],
      texts: {
        en: { title: 'T', methods: 'Seminars.', literature: null },
        de: { title: 'Titel', mode_of_repetition: 'Jedes Wintersemester.' },
      },
    });
  });

  it('clears instructors with an empty cell and leaves them untouched without the column', () => {
    const cleared = validateCsvText('courses', `${header12}\n1.2,C1,draft,5,0613,T,,,,,\n`);
    expect(cleared.errors).toEqual([]);
    expect(cleared.normalized[0]?.instructors).toBeNull();
    const absent = validateCsvText(
      'courses',
      'template_version,course_code,status,ects,isced_codes,title_en\n1.2,C1,draft,5,0613,T\n',
    );
    expect(absent.normalized[0]?.instructors).toBeUndefined();
  });

  it.each([
    ['an entry over 200 characters', 'x'.repeat(201)],
    ['more than 50 entries', Array.from({ length: 51 }, (_, i) => `T${i}`).join('|')],
    ['an empty entry', 'A||B'],
  ])('refuses instructors with %s', (_label, cell) => {
    const result = validateCsvText(
      'courses',
      `template_version,course_code,status,ects,isced_codes,title_en,instructors\n1.2,C1,draft,5,0613,T,${cell}\n`,
    );
    expect(result.errors.map((e) => [e.code, e.column])).toEqual([
      ['oecp.content.invalid_value', 'instructors'],
    ]);
  });

  it('refuses 1.2 columns in 1.0 and 1.1 rows', () => {
    for (const [version, column, cell] of [
      ['1.1', 'instructors', 'A'],
      ['1.0', 'instructors', 'A'],
      ['1.1', 'methods_en', 'Seminars.'],
      ['1.1', 'privacy_notice_en', ''],
    ] as const) {
      const result = validateCsvText(
        'courses',
        `template_version,course_code,status,ects,isced_codes,title_en,${column}\n${version},C1,draft,5,0613,T,${cell}\n`,
      );
      expect(
        result.errors.map((e) => [e.code, e.column]),
        `${version} ${column}`,
      ).toEqual([['oecp.csv.invalid_template_version', 'template_version']]);
    }
  });

  it('still accepts 1.0 and 1.1 files', () => {
    const v10 = validateCsvText(
      'courses',
      'template_version,course_code,status,ects,isced_codes,title_en,level,abstract_en\n1.0,C1,draft,5,0613,T,master,A\n',
    );
    expect(v10.errors).toEqual([]);
    const v11 = validateCsvText(
      'courses',
      'template_version,course_code,status,ects,isced_codes,title_en,kind,levels\n1.1,C1,draft,5,0613,T,bip,master|bachelor\n',
    );
    expect(v11.errors).toEqual([]);
    expect(v11.normalized[0]).toMatchObject({ kind: 'bip', levels: ['master', 'bachelor'] });
    expect(v11.normalized[0]?.instructors).toBeUndefined();
  });

  it('knows the version of every column', () => {
    expect(csvColumnVersion('courses', 'title_en')).toBe('1.0');
    expect(csvColumnVersion('courses', 'levels')).toBe('1.1');
    expect(csvColumnVersion('courses', 'attr_sdg')).toBe('1.1');
    expect(csvColumnVersion('courses', 'instructors')).toBe('1.2');
    expect(csvColumnVersion('courses', 'remarks_ca')).toBe('1.2');
    expect(csvColumnVersion('offerings', 'application_instructions_en')).toBe('1.1');
    expect(csvColumnVersion('offerings', 'start_date')).toBe('1.0');
  });

  it('generates a 1.2 template with instructors and the handbook texts', () => {
    const [header, example] = csvTemplate('courses').replace('﻿', '').split('\r\n');
    expect(header?.split(',')).toEqual(
      expect.arrayContaining([
        'instructors',
        'mode_of_repetition_en',
        'methods_en',
        'literature_en',
        'privacy_notice_en',
        'remarks_en',
      ]),
    );
    expect(example?.startsWith('1.2,')).toBe(true);
  });
});

describe('admin and OEAPI contracts', () => {
  it('takes instructors and the handbook texts in the course form', () => {
    const parsed = courseInput.parse({
      ext_id: 'AUR-101',
      levels: ['master'],
      ects: 5,
      isced_codes: [{ code: '0613' }],
      instructors: ['Course team'],
      texts: { en: { title: 'T', methods: ' Seminars ', remarks: '  ' } },
    });
    expect(parsed.instructors).toEqual(['Course team']);
    expect(parsed.texts.en).toMatchObject({ methods: 'Seminars', remarks: null, literature: null });
    expect(
      courseInput.parse({ ext_id: 'A', levels: ['master'], ects: 5, isced_codes: [{ code: '06' }] })
        .instructors,
    ).toEqual([]);
    expect(
      codes(
        courseInput.safeParse({
          ext_id: 'A',
          levels: ['master'],
          ects: 5,
          isced_codes: [{ code: '06' }],
          instructors: ['A', 'A'],
        }),
      ),
    ).toContain('oecp.content.invalid_value');
  });

  it('accepts overrides of instructors and of the handbook texts', () => {
    const patch = courseOverridesPatch.parse({
      set: { instructors: ['Course team'], 'texts.en.literature': 'Reading list.' },
      clear: ['texts.de.privacy_notice'],
    });
    expect(patch.set).toEqual({
      instructors: ['Course team'],
      'texts.en.literature': 'Reading list.',
    });
    expect(
      codes(courseOverridesPatch.safeParse({ set: { instructors: [''] } })).length,
    ).toBeGreaterThan(0);
  });

  it('exposes completeness on the admin course and a count on the sync run', () => {
    expect(adminCourse.shape.completeness).toBe(courseCompleteness);
    expect(syncRunDetail.shape.handbook_incomplete.safeParse(2).success).toBe(true);
  });

  it('never rejects a v5 course because of its coordinators', () => {
    const v5 = {
      courseId: 'c',
      name: [{ language: 'en', value: 'T' }],
    };
    for (const coordinators of [['p-1'], [{ personId: 'p-1', displayName: 'A' }], 'odd', 3]) {
      expect(oeapiV5Course.safeParse({ ...v5, coordinators }).success).toBe(true);
    }
  });
});
