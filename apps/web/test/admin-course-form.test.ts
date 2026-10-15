// SPDX-License-Identifier: EUPL-1.2
// Course wizard form logic (app/utils/adminCourseForm.ts): conversions, request
// bodies, overrides patches, validation and server pointer mapping.
import {
  adminCourse,
  adminCourseHistory,
  adminCourseList,
  adminCourseListItem,
  adminReference,
  courseInput,
  courseOverridesPatch,
  offeringInput,
  offeringOverridesPatch,
} from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import {
  adminFieldDomId,
  buildOverridesPatch,
  adminLabel,
  COURSE_FORM_OVERRIDE_FIELDS,
  completenessFieldLabel,
  courseFormFromCourse,
  courseFormValue,
  courseInputFromForm,
  courseOverrideKeyOf,
  courseValueText,
  emptyCourseForm,
  emptyOfferingForm,
  formIssueMessageKey,
  isIsoDate,
  normalizeServerPointer,
  offeringFormFromOffering,
  offeringInputFromForm,
  OTHER_SESSION,
  parseInstructors,
  parseKeywords,
  resolveIssueField,
  serverFormIssues,
  timeZoneOptions,
  validateCourseForm,
  validateOfferingForm,
} from '../app/utils/adminCourseForm';
import {
  course,
  courseList,
  handbookCourse,
  history,
  listItem,
  offering,
  reference,
} from './helpers/adminCourses';

const HANDBOOK_TEXTS = [
  'methods',
  'mode_of_repetition',
  'literature',
  'remarks',
  'privacy_notice',
] as const;
type Json = Record<string, unknown>;
/** Whether the installed schemas declare the DL 21 members yet. */
const declares = (schema: unknown, key: string) =>
  key in ((schema as { shape?: Json }).shape ?? {});
const declaresDl21 = declares(adminCourse, 'instructors');
const declaresListDl21 = declares(adminCourseListItem, 'complete');
/** `missing_count` on list items (0.4 consistency fixes). */
const declaresMissingCount = declares(adminCourseListItem, 'missing_count');
const declaresInputDl21 = declares(courseInput, 'instructors');
/** A body without the DL 21 members, as an API without them accepts it. */
function withoutDl21<T>(body: T): T {
  if (declaresInputDl21) return body;
  const { instructors: _i, texts, ...rest } = body as Json & { texts?: Record<string, Json> };
  return {
    ...rest,
    ...(texts
      ? {
          texts: Object.fromEntries(
            Object.entries(texts).map(([lang, text]) => [
              lang,
              Object.fromEntries(
                Object.entries(text).filter(
                  ([k]) => !(HANDBOOK_TEXTS as readonly string[]).includes(k),
                ),
              ),
            ]),
          ),
        }
      : {}),
  } as T;
}

describe('helpers', () => {
  it('reads plain and localized labels', () => {
    expect(adminLabel('Course')).toBe('Course');
    expect(adminLabel({ en: 'Course', ca: 'Curs' }, 'ca')).toBe('Curs');
    expect(adminLabel({ en: 'Course' }, 'de')).toBe('Course');
    expect(adminLabel(null)).toBe('');
  });

  it('derives DOM ids from JSON pointers', () => {
    expect(adminFieldDomId('course', '/texts/en/title')).toBe('course-texts-en-title');
    expect(adminFieldDomId('course', '/isced_codes/0/code')).toBe('course-isced_codes-0-code');
  });

  it('splits instructors on new lines, without blanks and duplicates', () => {
    expect(parseInstructors(' Dr. Ada Lovelace \n\nProf. Alan Turing\nDr. Ada Lovelace\n')).toEqual(
      ['Dr. Ada Lovelace', 'Prof. Alan Turing'],
    );
    expect(parseInstructors('')).toEqual([]);
  });

  it('labels completeness keys, falling back to the key itself', () => {
    const messages: Record<string, string> = {
      'admin.completeness.fields.texts_en_description': 'Content: description (English)',
      'admin.completeness.fields.description': 'Content: description',
      'admin.completeness.fields.offerings_application_deadline': 'Offering application deadline',
    };
    const t = (key: string, params?: Record<string, unknown>) =>
      key === 'admin.completeness.inLanguage'
        ? `${String(params?.field)} (${String(params?.lang)})`
        : (messages[key] ?? key);
    const te = (key: string) => key in messages;
    expect(completenessFieldLabel('texts.en.description', t, te)).toBe(
      'Content: description (English)',
    );
    expect(completenessFieldLabel('offerings.application_deadline', t, te)).toBe(
      'Offering application deadline',
    );
    expect(
      completenessFieldLabel('texts.de.description', t, te, (tag) =>
        tag === 'de' ? 'German' : tag,
      ),
    ).toBe('Content: description (German)');
    expect(completenessFieldLabel('shoe_size', t, te)).toBe('shoe_size');
  });

  it('splits keywords on commas and new lines', () => {
    expect(parseKeywords(' a, b\n\nc ,a,, ')).toEqual(['a', 'b', 'c']);
    expect(parseKeywords('')).toEqual([]);
  });

  it('checks calendar dates and lists time zones with the preferred ones first', () => {
    expect(isIsoDate('2027-02-28')).toBe(true);
    expect(isIsoDate('2027-02-30')).toBe(false);
    expect(isIsoDate('15/02/2027')).toBe(false);
    const zones = timeZoneOptions(['Europe/Vienna', '', 'Europe/Vienna']);
    expect(zones[0]).toBe('Europe/Vienna');
    expect(zones.filter((z) => z === 'Europe/Vienna')).toHaveLength(1);
    expect(zones).toContain('Europe/Madrid');
  });
});

describe('server issues', () => {
  it('normalizes `set` pointers of overrides patches', () => {
    expect(normalizeServerPointer('/set/texts.en.title')).toBe('/texts/en/title');
    expect(normalizeServerPointer('/set/ects')).toBe('/ects');
    expect(normalizeServerPointer('/isced_codes/1/code')).toBe('/isced_codes/1/code');
    expect(normalizeServerPointer('')).toBe('');
    expect(normalizeServerPointer('/a~1b')).toBe('/a/b');
  });

  it('resolves the nearest known field', () => {
    const known = new Set(['/isced_codes', '/isced_codes/0/code', '/ects']);
    expect(resolveIssueField('/isced_codes/0/code', known)).toBe('/isced_codes/0/code');
    expect(resolveIssueField('/isced_codes/3/code', known)).toBe('/isced_codes');
    expect(resolveIssueField('/ects/x', known)).toBe('/ects');
    expect(resolveIssueField('/unknown', known)).toBeNull();
    expect(resolveIssueField('', known)).toBeNull();
  });

  it('reads `json_pointer` (or `pointer`) from problem errors', () => {
    expect(
      serverFormIssues({
        errors: [
          { code: 'oecp.content.date_order', json_pointer: '/end_date', message: 'Order' },
          { code: 'oecp.content.invalid_value', pointer: '/set/campus' },
          { message: 'no code' },
          'junk',
        ],
      }),
    ).toEqual([
      { field: '/end_date', code: 'oecp.content.date_order', message: 'Order' },
      { field: '/campus', code: 'oecp.content.invalid_value' },
    ]);
    expect(serverFormIssues(undefined)).toEqual([]);
  });

  it('translates client checks and known server codes only', () => {
    expect(formIssueMessageKey({ field: '/x', code: 'required' })).toBe(
      'admin.validation.required',
    );
    expect(formIssueMessageKey({ field: '/x', code: 'oecp.content.date_order' })).toBe(
      'admin.validation.dateOrder',
    );
    expect(formIssueMessageKey({ field: '/x', code: 'oecp.content.new_code' })).toBeNull();
  });
});

describe('course form', () => {
  it('round-trips a course into the PUT body', () => {
    const form = courseFormFromCourse(course(), reference());
    expect(form.teaching_unit_ext_id).toBe('ETSE');
    expect(form.texts.en!.keywords).toBe('statistics, data');
    expect(courseInputFromForm(form)).toMatchObject({
      ext_id: 'TEST-101',
      ects: 6,
      teaching_unit_ext_id: 'ETSE',
      isced_codes: [{ code: '0541', is_primary: true }],
      texts: { en: { title: 'Applied statistics', keywords: ['statistics', 'data'] } },
      status: 'draft',
    });
  });

  it('round-trips instructors and the IT Handbook texts [DL 21]', () => {
    const form = courseFormFromCourse(handbookCourse(), reference());
    expect(form.instructors).toBe('Dr. Ada Lovelace\nProf. Alan Turing');
    expect(form.texts.en!.methods).toBe('Lectures and computer labs.');
    const input = courseInputFromForm(form);
    expect(input.instructors).toEqual(['Dr. Ada Lovelace', 'Prof. Alan Turing']);
    expect(input.texts.en).toMatchObject({
      methods: 'Lectures and computer labs.',
      mode_of_repetition: 'Every autumn semester.',
      literature: null,
      remarks: null,
      privacy_notice: 'Applicant data is processed for admission only.',
    });
    expect(courseFormValue(form, 'instructors')).toEqual(['Dr. Ada Lovelace', 'Prof. Alan Turing']);
    expect(courseFormValue(form, 'texts.en.methods')).toBe('Lectures and computer labs.');
    const t = (key: string) => key;
    expect(courseValueText('instructors', input.instructors, null, t, 'en')).toBe(
      'Dr. Ada Lovelace; Prof. Alan Turing',
    );
    expect(COURSE_FORM_OVERRIDE_FIELDS).toContain('instructors');
    expect(courseOverrideKeyOf('/instructors')).toBe('instructors');
    expect(courseOverrideKeyOf('/texts/en/privacy_notice')).toBe('texts.en.privacy_notice');
  });

  it('reads a course from an older API without instructors or the new texts', () => {
    const form = courseFormFromCourse(course(), reference());
    expect(form.instructors).toBe('');
    expect(form.texts.en!.remarks).toBe('');
    const input = courseInputFromForm(form);
    expect(input.instructors).toEqual([]);
    expect(input.texts.en).toMatchObject({ methods: null, privacy_notice: null });
  });

  it('validates the number and length of instructors', () => {
    const form = courseFormFromCourse(course(), reference());
    const check = () =>
      validateCourseForm(form, { reference: reference(), creating: false }).map((i) => [
        i.field,
        i.code,
      ]);
    form.instructors = Array.from({ length: 50 }, (_, i) => `Instructor ${i}`).join('\n');
    expect(check()).toEqual([]);
    form.instructors += '\nOne too many';
    expect(check()).toEqual([['/instructors', 'tooManyInstructors']]);
    form.instructors = `Short\n${'x'.repeat(201)}`;
    expect(check()).toEqual([['/instructors', 'instructorTooLong']]);
    form.instructors = 'x'.repeat(200);
    expect(check()).toEqual([]);
  });

  it('drops empty optional values, empty languages and unset attributes', () => {
    const form = emptyCourseForm();
    form.ext_id = 'X-1';
    form.ects = '5,5';
    form.isced = [{ code: '' }, { code: '0613' }];
    form.texts.en!.title = 'Title';
    form.texts.ca = { ...form.texts.en!, title: '' };
    form.attributes = { a: undefined, b: [], c: '', d: false };
    const input = courseInputFromForm(form);
    expect(input.ects).toBe(5.5);
    expect(input.teaching_hours).toBeNull();
    expect(input.isced_codes).toEqual([{ code: '0613', is_primary: true }]);
    expect(Object.keys(input.texts)).toEqual(['en']);
    expect(input.attributes).toEqual({ d: false });
  });

  it('validates per step and against the reference', () => {
    const form = emptyCourseForm();
    const ref = reference();
    expect(
      validateCourseForm(form, { reference: ref, creating: true, step: 1 }).map((i) => i.field),
    ).toEqual(['/texts/en/title']);
    form.isced = [{ code: '0541' }, { code: '0541' }, { code: '9' }];
    form.texts.es = { ...form.texts.en!, description: 'Sin título' };
    expect(
      validateCourseForm(form, { reference: ref, creating: true }).map((i) => [i.field, i.code]),
    ).toEqual([
      ['/ext_id', 'required'],
      ['/levels', 'chooseLevel'],
      ['/ects', 'required'],
      ['/isced_codes/1/code', 'iscedDuplicate'],
      ['/isced_codes/2/code', 'isced'],
      ['/texts/en/title', 'englishTitle'],
      ['/texts/es/title', 'title'],
    ]);
    // Existing courses never validate the immutable code.
    expect(
      validateCourseForm(form, { reference: ref, creating: false }).some(
        (i) => i.field === '/ext_id',
      ),
    ).toBe(false);
  });

  it('keeps only the issues of toggled override keys', () => {
    const form = emptyCourseForm();
    const issues = validateCourseForm(form, {
      reference: reference(),
      creating: false,
      only: (key) => key === 'texts.en.title',
    });
    expect(issues.map((i) => i.field)).toEqual(['/texts/en/title']);
    expect(courseOverrideKeyOf('/isced_codes/2/code')).toBe('isced_codes');
    expect(courseOverrideKeyOf('/texts/en')).toBeNull();
    expect(courseOverrideKeyOf('/ext_id')).toBeNull();
  });
});

describe('overrides patch', () => {
  const keys = ['a', 'b', 'c', 'd'];
  it('sets new or changed overrides and clears untoggled stored ones', () => {
    const current: Record<string, unknown> = { a: 1, b: 2, c: 3, d: 4 };
    const initial: Record<string, unknown> = { a: 1, b: 9, c: 3, d: 4 };
    expect(
      buildOverridesPatch(
        keys,
        { a: true, b: true, c: false },
        new Set(['b', 'c', 'a']),
        (k) => current[k],
        (k) => initial[k],
      ),
    ).toEqual({ set: { b: 2 }, clear: ['c'] });
    expect(
      buildOverridesPatch(
        keys,
        { d: true },
        new Set(),
        (k) => current[k],
        (k) => initial[k],
      ),
    ).toEqual({ set: { d: 4 }, clear: [] });
  });
});

describe('offering form', () => {
  it('round-trips an offering and keeps unknown session codes as typed codes', () => {
    const ref = reference();
    const form = offeringFormFromOffering(offering(), ref);
    expect(form.session).toBe('2026-27-S2');
    expect(offeringInputFromForm(form)).toMatchObject({
      ext_offering_id: '2027S',
      academic_session_ext_id: '2026-27-S2',
      max_students: 30,
      alliance_seats: 5,
      seats_available: null,
    });
    const other = offeringFormFromOffering(
      offering({
        academic_session_ext_id: 'OLD-1',
        academic_session: {
          id: '5e0c0000-0000-4000-8000-000000000009',
          ext_id: 'OLD-1',
          name: { en: 'Old' },
        },
      }),
      ref,
    );
    expect([other.session, other.session_other]).toEqual([OTHER_SESSION, 'OLD-1']);
    expect(offeringInputFromForm(other).academic_session_ext_id).toBe('OLD-1');
  });

  it('validates dates, seats, URL and the time zone', () => {
    const form = emptyOfferingForm('Not/AZone');
    Object.assign(form, {
      ext_offering_id: '2027',
      start_date: '2027-06-01',
      end_date: '2027-05-01',
      application_deadline: '2027-07-01',
      enrol_start_date: '2027-08-01',
      teaching_languages: ['en'],
      delivery_modes: ['online'],
      max_students: '10',
      alliance_seats: '11',
      seats_available: '-1',
      application_url: 'http://x',
    });
    expect(validateOfferingForm(form, { creating: true }).map((i) => [i.field, i.code])).toEqual([
      ['/end_date', 'endBeforeStart'],
      ['/application_deadline', 'deadlineAfterEnd'],
      ['/enrol_start_date', 'enrolAfterDeadline'],
      ['/timezone', 'timezone'],
      ['/seats_available', 'nonNegativeInteger'],
      ['/alliance_seats', 'seatsExceedCapacity'],
      ['/application_url', 'https'],
    ]);
    expect(
      validateOfferingForm(form, { creating: false, only: (k) => k === 'timezone' }).map(
        (i) => i.field,
      ),
    ).toEqual(['/timezone']);
  });
});

describe('contract (@oecp/schemas admin-courses)', () => {
  it('the test fixtures are valid API responses', () => {
    expect(() => adminReference.parse(reference())).not.toThrow();
    // Fixtures with the DL 21 members once the installed schemas declare them.
    expect(adminCourse.safeParse(declaresDl21 ? handbookCourse() : course()).error).toBeUndefined();
    const items = declaresListDl21
      ? [
          listItem(1, { complete: true, ...(declaresMissingCount ? { missing_count: 0 } : {}) }),
          listItem(2, { complete: false, ...(declaresMissingCount ? { missing_count: 2 } : {}) }),
        ]
      : [listItem(1), listItem(2)];
    expect(adminCourseList.safeParse(courseList(items)).error).toBeUndefined();
    expect(() => adminCourseHistory.parse(history())).not.toThrow();
  });

  it('the bodies the form sends are valid requests', () => {
    const ref = reference();
    const edited = courseInputFromForm(courseFormFromCourse(course(), ref));
    expect(courseInput.safeParse(withoutDl21(edited)).error).toBeUndefined();
    const handbook = courseInputFromForm(courseFormFromCourse(handbookCourse(), ref));
    expect(courseInput.safeParse(withoutDl21(handbook)).error).toBeUndefined();

    const created = emptyCourseForm();
    Object.assign(created, { ext_id: 'NEW-1', ects: '5', levels: ['master'] });
    created.isced = [{ code: '0613' }];
    created.texts.en!.title = 'New';
    created.texts.en!.keywords = 'a, b';
    expect(courseInput.safeParse(withoutDl21(courseInputFromForm(created))).error).toBeUndefined();

    const withdrawn = courseFormFromCourse(course({ status: 'withdrawn' }), ref);
    expect(courseInputFromForm(withdrawn)).not.toHaveProperty('status');
    expect(
      courseInput.safeParse(withoutDl21(courseInputFromForm(withdrawn))).error,
    ).toBeUndefined();

    const offeringBody = offeringInputFromForm(offeringFormFromOffering(offering(), ref));
    expect(offeringInput.safeParse(offeringBody).error).toBeUndefined();

    const patch = buildOverridesPatch(
      ['ects', 'isced_codes', 'texts.en.title', 'texts.en.keywords'],
      { ects: true, isced_codes: true, 'texts.en.keywords': true },
      new Set(['texts.en.title']),
      (key) =>
        ({
          ects: 7.5,
          isced_codes: [{ code: '0541', is_primary: true }],
          'texts.en.keywords': ['a'],
        })[key],
      () => undefined,
    );
    expect(courseOverridesPatch.safeParse(patch).error).toBeUndefined();
    if (declaresInputDl21) {
      const dl21 = {
        set: { instructors: ['Dr. Ada Lovelace'], 'texts.en.methods': 'Labs.' },
        clear: [],
      };
      expect(courseOverridesPatch.safeParse(dl21).error).toBeUndefined();
    }
    expect(
      offeringOverridesPatch.safeParse({ set: { alliance_seats: 3, campus: null }, clear: [] })
        .error,
    ).toBeUndefined();
  });
});
