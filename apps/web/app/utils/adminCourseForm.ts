// SPDX-License-Identifier: EUPL-1.2
// Course wizard and offering form state (spec §6.4, §8.1): conversion between the
// admin API records and editable form state, the request bodies (`CourseInput`,
// `OfferingInput`, overrides patches) and client-side validation mirroring the
// canonical schema. Fields are identified by RFC 6901 JSON Pointers into the
// request body, which is also how server validation errors (`json_pointer`)
// are mapped back to fields.
import {
  ATTRIBUTE_TEXT_MAX,
  CODE_PATTERN,
  COURSE_OVERRIDE_FIELDS,
  EMAIL_PATTERN,
  HTTPS_URL_PATTERN,
  ISCED_CODE_PATTERN,
  OFFERING_OVERRIDE_FIELDS,
} from '@oecp/schemas';
import type {
  AdminAttributeDefinitionRef,
  AdminAttributeValue,
  AdminCourse,
  AdminCourseReference,
  AdminHandbookTextField,
  AdminLabel,
  AdminOffering,
  CourseInput,
  CourseTextInput,
  OfferingInput,
} from '~/types/admin';

/** `CourseInput` as the form builds it (texts and attributes always present). */
export type CourseFormBody = CourseInput & Required<Pick<CourseInput, 'texts' | 'attributes'>>;

/** `PATCH …/overrides` body as the form builds it. */
export interface FormOverridesPatch {
  set: Record<string, unknown>;
  clear: string[];
}

// ---------------------------------------------------------------------------
// Shared helpers

/** Text of an API label (plain string or `{bcp47: text}` map), English as fallback. */
export function adminLabel(label: AdminLabel | null | undefined, locale = 'en'): string {
  if (!label) return '';
  if (typeof label === 'string') return label;
  return label[locale] ?? label.en ?? Object.values(label)[0] ?? '';
}

/** A client or server validation finding about one field (`field`: JSON Pointer). */
export interface FormIssue {
  field: string;
  /** Client check name (`required`, `https`…) or a stable server code (`oecp.…`). */
  code: string;
  /** Server message, shown when the code has no translation. */
  message?: string;
}

/** DOM id of the control of a field, e.g. `course` + `/texts/en/title` → `course-texts-en-title`. */
export function adminFieldDomId(prefix: string, pointer: string): string {
  return `${prefix}${pointer.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

/** i18n key (under `admin.validation.`) for a client check or a known server code. */
const SERVER_CODES: Readonly<Record<string, string>> = {
  'oecp.content.english_missing': 'englishTitle',
  'oecp.content.date_order': 'dateOrder',
  'oecp.content.seats_exceed_capacity': 'seatsExceedCapacity',
  'oecp.content.duplicate_isced': 'iscedDuplicate',
  'oecp.content.unknown_isced_field': 'iscedBroad',
  'oecp.content.unknown_delivery_mode': 'unknownOption',
  'oecp.content.unknown_teaching_unit': 'unknownOption',
  'oecp.content.unknown_session': 'unknownOption',
  'oecp.content.unknown_attribute_option': 'unknownOption',
  'oecp.content.invalid_attribute_value': 'invalid',
  'oecp.content.duplicate_ext_id': 'duplicateCode',
  'oecp.content.ext_id_immutable': 'codeImmutable',
  'oecp.content.override_not_allowed': 'overrideNotAllowed',
  'oecp.content.invalid_code': 'code',
  'oecp.content.unsupported_language': 'unknownOption',
};

export function formIssueMessageKey(issue: FormIssue): string | null {
  if (!issue.code.startsWith('oecp.')) return `admin.validation.${issue.code}`;
  const key = SERVER_CODES[issue.code];
  return key ? `admin.validation.${key}` : null;
}

/** Splits a JSON Pointer into unescaped segments. */
function segments(pointer: string): string[] {
  if (!pointer || pointer === '/') return [];
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * Server pointer → form pointer. Overrides patches point into `set`, whose keys
 * are field names with dotted text paths (`/set/texts.en.title` → `/texts/en/title`).
 */
export function normalizeServerPointer(pointer: string | undefined): string {
  const parts = segments(pointer ?? '');
  if (parts[0] === 'set' && parts.length > 1) {
    parts.shift();
    const head = parts.shift() ?? '';
    parts.unshift(...head.split('.'));
  }
  return parts.length ? `/${parts.join('/')}` : '';
}

/**
 * Maps a server pointer to the nearest known field: `/isced_codes/0/code/x` falls
 * back to `/isced_codes/0/code`, then `/isced_codes`. Null when nothing matches.
 */
export function resolveIssueField(pointer: string, known: ReadonlySet<string>): string | null {
  const parts = segments(pointer);
  while (parts.length) {
    const candidate = `/${parts.join('/')}`;
    if (known.has(candidate)) return candidate;
    parts.pop();
  }
  return null;
}

/** Server `errors[]` of a problem (`json_pointer`, or `pointer` as the shared schema names it). */
export function serverFormIssues(problem: unknown): FormIssue[] {
  if (typeof problem !== 'object' || problem === null) return [];
  const errors = (problem as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((e): FormIssue[] => {
    if (typeof e !== 'object' || e === null) return [];
    const item = e as {
      code?: unknown;
      json_pointer?: unknown;
      pointer?: unknown;
      message?: unknown;
    };
    if (typeof item.code !== 'string') return [];
    const raw =
      typeof item.json_pointer === 'string'
        ? item.json_pointer
        : typeof item.pointer === 'string'
          ? item.pointer
          : '';
    return [
      {
        field: normalizeServerPointer(raw),
        code: item.code,
        ...(typeof item.message === 'string' ? { message: item.message } : {}),
      },
    ];
  });
}

const trimmed = (value: string) => value.trim();
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

function parseNumber(value: string): number | null {
  const v = value.trim().replace(',', '.');
  if (v === '' || !/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

function parseInteger(value: string): number | null {
  const v = value.trim();
  if (v === '' || !/^-?\d+$/.test(v)) return null;
  return Number(v);
}

const numberText = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

/** Limits of `instructors` [DL 21] (mirroring the API contract). */
export const INSTRUCTORS_MAX = 50;
export const INSTRUCTOR_NAME_MAX = 200;

/** Instructors typed one per line → list without blanks and duplicates. */
export function parseInstructors(value: string): string[] {
  return [
    ...new Set(
      value
        .split('\n')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

/** Keywords typed comma- or newline-separated → list without blanks and duplicates. */
export function parseKeywords(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
}

/** Stable comparison of JSON-like values. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** `YYYY-MM-DD` that is a real calendar date. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function isTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** IANA time zones for the select, the organization default first. */
export function timeZoneOptions(preferred: readonly string[]): string[] {
  let all: string[];
  try {
    all =
      (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ??
      [];
  } catch {
    all = [];
  }
  const first = [...new Set(preferred.filter(Boolean))];
  return [...first, ...all.filter((z) => !first.includes(z))];
}

// ---------------------------------------------------------------------------
// Courses

/** Texts every course has had since v0.1, shown first on the Texts step. */
export const COURSE_MAIN_TEXT_FIELDS = [
  'title',
  'abstract',
  'description',
  'learning_outcomes',
  'prerequisites',
  'assessment',
  'keywords',
] as const;
/** Optional texts of the Aurora IT Handbook [DL 21] ("More texts"), in course page order. */
export const COURSE_MORE_TEXT_FIELDS = [
  'methods',
  'mode_of_repetition',
  'literature',
  'remarks',
  'privacy_notice',
] as const satisfies readonly AdminHandbookTextField[];
export const COURSE_TEXT_FIELDS = [...COURSE_MAIN_TEXT_FIELDS, ...COURSE_MORE_TEXT_FIELDS] as const;
export type CourseTextField = (typeof COURSE_TEXT_FIELDS)[number];

export type CourseTextForm = Record<CourseTextField, string>;

export interface CourseForm {
  ext_id: string;
  kind: string;
  levels: string[];
  ects: string;
  teaching_hours: string;
  teaching_unit_ext_id: string;
  info_url: string;
  contact_email: string;
  /** One name per line. */
  instructors: string;
  isced: { code: string }[];
  /** Index into `isced` of the primary code. */
  isced_primary: number;
  texts: Record<string, CourseTextForm>;
  attributes: Record<string, AdminAttributeValue | undefined>;
  /** Empty when the stored status is neither draft nor published: a save keeps it. */
  status: 'draft' | 'published' | '';
}

/** Course wizard steps (0-based) and the step that owns a field. */
export const COURSE_STEPS = ['basics', 'texts', 'attributes', 'review'] as const;
export type CourseStep = (typeof COURSE_STEPS)[number];

export function courseFieldStep(pointer: string): number {
  if (pointer.startsWith('/texts')) return 1;
  if (pointer.startsWith('/attributes')) return 2;
  if (pointer.startsWith('/status')) return 3;
  return 0;
}

export function emptyCourseText(): CourseTextForm {
  return {
    title: '',
    abstract: '',
    description: '',
    learning_outcomes: '',
    prerequisites: '',
    assessment: '',
    keywords: '',
    methods: '',
    mode_of_repetition: '',
    literature: '',
    remarks: '',
    privacy_notice: '',
  };
}

export function emptyCourseForm(): CourseForm {
  return {
    ext_id: '',
    kind: 'course',
    levels: [],
    ects: '',
    teaching_hours: '',
    teaching_unit_ext_id: '',
    info_url: '',
    contact_email: '',
    instructors: '',
    isced: [{ code: '' }],
    isced_primary: 0,
    texts: { en: emptyCourseText() },
    attributes: {},
    status: 'draft',
  };
}

/**
 * Course fields the form overrides on harvested records: the schema's override
 * fields except `status`, which the status actions change, plus `instructors`
 * [DL 21] (added here as long as the installed schemas do not list it).
 */
export const COURSE_FORM_OVERRIDE_FIELDS: readonly string[] = [
  ...new Set([...COURSE_OVERRIDE_FIELDS.filter((f: string) => f !== 'status'), 'instructors']),
];

/** Override key of a form pointer: `/texts/en/title` → `texts.en.title`, `/isced_codes/1/code` → `isced_codes`. */
export function courseOverrideKeyOf(pointer: string): string | null {
  const parts = segments(pointer);
  if (parts[0] === 'texts') {
    return parts.length >= 3 ? `texts.${parts[1]}.${parts[2]}` : null;
  }
  const head = parts[0];
  return head && COURSE_FORM_OVERRIDE_FIELDS.includes(head) ? head : null;
}

/** Teaching unit natural key of a course (else `teaching_unit_id` → reference `ext_id`). */
function teachingUnitExtId(course: AdminCourse, reference: AdminCourseReference | null): string {
  if (course.teaching_unit_ext_id) return course.teaching_unit_ext_id;
  if (!course.teaching_unit_id) return '';
  return reference?.teaching_units.find((u) => u.id === course.teaching_unit_id)?.ext_id ?? '';
}

/** Value of a course field as the API holds it (effective value, overrides merged). */
export function courseApiValue(
  course: AdminCourse,
  key: string,
  reference: AdminCourseReference | null,
): unknown {
  if (key.startsWith('texts.')) {
    const [, lang, field] = key.split('.');
    const text = lang ? course.texts[lang] : undefined;
    return text && field ? ((text as unknown as Record<string, unknown>)[field] ?? null) : null;
  }
  switch (key) {
    case 'teaching_unit_ext_id':
      return teachingUnitExtId(course, reference) || null;
    default:
      return (course as unknown as Record<string, unknown>)[key] ?? null;
  }
}

/** Unwraps a stored override (`{value, by, at}` as stored, or the bare value). */
export function overrideValue(stored: unknown): unknown {
  if (
    typeof stored === 'object' &&
    stored !== null &&
    !Array.isArray(stored) &&
    'value' in stored &&
    'at' in stored
  ) {
    return (stored as { value: unknown }).value;
  }
  return stored;
}

/** Source (harvested) value of a field: `source_values` when overridden, else the effective value. */
export function courseSourceValue(
  course: AdminCourse,
  key: string,
  reference: AdminCourseReference | null,
): unknown {
  if (key in course.overrides) return course.source_values[key] ?? null;
  return courseApiValue(course, key, reference);
}

/** Sets one field of the form from an API value (inverse of {@link courseFormValue}). */
export function applyCourseValue(form: CourseForm, key: string, value: unknown): void {
  if (key.startsWith('texts.')) {
    const [, lang, field] = key.split('.') as [string, string, CourseTextField];
    if (!lang || !COURSE_TEXT_FIELDS.includes(field)) return;
    const text = (form.texts[lang] ??= emptyCourseText());
    text[field] =
      field === 'keywords'
        ? Array.isArray(value)
          ? value.join(', ')
          : ''
        : typeof value === 'string'
          ? value
          : '';
    return;
  }
  switch (key) {
    case 'kind':
      form.kind = typeof value === 'string' ? value : 'course';
      break;
    case 'levels':
      form.levels = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
      break;
    case 'ects':
    case 'teaching_hours':
      form[key] = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
      break;
    case 'teaching_unit_ext_id':
    case 'info_url':
    case 'contact_email':
      form[key] = typeof value === 'string' ? value : '';
      break;
    case 'instructors':
      form.instructors = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string').join('\n')
        : '';
      break;
    case 'isced_codes': {
      const list = Array.isArray(value)
        ? (value as unknown[]).map((v) =>
            typeof v === 'string'
              ? { code: v, is_primary: false }
              : (v as { code: string; is_primary?: boolean }),
          )
        : [];
      form.isced = list.length ? list.map((c) => ({ code: c.code })) : [{ code: '' }];
      const primary = list.findIndex((c) => c.is_primary);
      form.isced_primary = primary === -1 ? 0 : primary;
      break;
    }
    case 'attributes':
      form.attributes =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? { ...(value as Record<string, AdminAttributeValue>) }
          : {};
      break;
  }
}

export function courseFormFromCourse(
  course: AdminCourse,
  reference: AdminCourseReference | null,
): CourseForm {
  const form = emptyCourseForm();
  form.ext_id = course.ext_id;
  applyCourseValue(form, 'teaching_unit_ext_id', teachingUnitExtId(course, reference));
  for (const key of COURSE_FORM_OVERRIDE_FIELDS) {
    applyCourseValue(form, key, courseApiValue(course, key, reference));
  }
  form.texts = {};
  for (const lang of Object.keys(course.texts)) {
    for (const field of COURSE_TEXT_FIELDS) {
      applyCourseValue(
        form,
        `texts.${lang}.${field}`,
        courseApiValue(course, `texts.${lang}.${field}`, reference),
      );
    }
  }
  if (!form.texts.en) form.texts = { en: emptyCourseText(), ...form.texts };
  form.status = course.status === 'draft' || course.status === 'published' ? course.status : '';
  return form;
}

const textValue = (form: CourseForm, lang: string, field: CourseTextField) => {
  const text = form.texts[lang];
  if (!text) return field === 'keywords' ? [] : null;
  if (field === 'keywords') return parseKeywords(text.keywords);
  if (field === 'title') return trimmed(text.title);
  return orNull(text[field]);
};

function attributesValue(form: CourseForm): Record<string, AdminAttributeValue> {
  const out: Record<string, AdminAttributeValue> = {};
  for (const [key, value] of Object.entries(form.attributes)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

function iscedValue(form: CourseForm) {
  const primary = form.isced[form.isced_primary]?.code.trim();
  const codes = form.isced.map((c) => c.code.trim()).filter(Boolean);
  const primaryCode = primary && codes.includes(primary) ? primary : codes[0];
  return codes.map((code) => ({ code, is_primary: code === primaryCode }));
}

/** Value of one overridable field from the form, as sent in `set`. */
export function courseFormValue(form: CourseForm, key: string): unknown {
  if (key.startsWith('texts.')) {
    const [, lang, field] = key.split('.') as [string, string, CourseTextField];
    return textValue(form, lang, field);
  }
  switch (key) {
    case 'kind':
      return form.kind;
    case 'levels':
      return [...form.levels];
    case 'ects':
      return parseNumber(form.ects);
    case 'teaching_hours':
      return parseNumber(form.teaching_hours);
    case 'teaching_unit_ext_id':
    case 'info_url':
    case 'contact_email':
      return orNull(form[key]);
    case 'instructors':
      return parseInstructors(form.instructors);
    case 'isced_codes':
      return iscedValue(form);
    case 'attributes':
      return attributesValue(form);
    default:
      return null;
  }
}

/** Languages whose texts have any content (English always). */
function usedLanguages(form: CourseForm): string[] {
  return Object.keys(form.texts).filter(
    (lang) =>
      lang === 'en' || COURSE_TEXT_FIELDS.some((f) => (form.texts[lang]?.[f] ?? '').trim() !== ''),
  );
}

/** `POST …/courses` / `PUT /courses/{id}` body. */
export function courseInputFromForm(form: CourseForm): CourseFormBody {
  const texts: CourseFormBody['texts'] = {};
  for (const lang of usedLanguages(form)) {
    const text: CourseTextInput = {
      title: textValue(form, lang, 'title') as string,
      abstract: textValue(form, lang, 'abstract') as string | null,
      description: textValue(form, lang, 'description') as string | null,
      learning_outcomes: textValue(form, lang, 'learning_outcomes') as string | null,
      prerequisites: textValue(form, lang, 'prerequisites') as string | null,
      assessment: textValue(form, lang, 'assessment') as string | null,
      keywords: textValue(form, lang, 'keywords') as string[],
    };
    for (const field of COURSE_MORE_TEXT_FIELDS) {
      text[field] = textValue(form, lang, field) as string | null;
    }
    texts[lang] = text;
  }
  return {
    ext_id: form.ext_id.trim(),
    ...(form.status ? { status: form.status } : {}),
    kind: form.kind as CourseInput['kind'],
    levels: [...form.levels] as CourseInput['levels'],
    ects: parseNumber(form.ects) ?? 0,
    teaching_hours: parseNumber(form.teaching_hours),
    info_url: orNull(form.info_url),
    contact_email: orNull(form.contact_email),
    teaching_unit_ext_id: orNull(form.teaching_unit_ext_id),
    instructors: parseInstructors(form.instructors),
    isced_codes: iscedValue(form),
    attributes: attributesValue(form),
    texts,
  };
}

/** Override keys the form can address for a course (texts of every language in the form). */
export function courseOverrideKeys(form: CourseForm): string[] {
  const keys: string[] = [...COURSE_FORM_OVERRIDE_FIELDS];
  for (const lang of Object.keys(form.texts)) {
    for (const field of COURSE_TEXT_FIELDS) keys.push(`texts.${lang}.${field}`);
  }
  return keys;
}

/**
 * `PATCH …/overrides` body: `set` for fields toggled on whose value is new or
 * changed, `clear` for stored overrides toggled off. Untouched fields are omitted.
 */
export function buildOverridesPatch(
  keys: readonly string[],
  on: Readonly<Record<string, boolean>>,
  stored: ReadonlySet<string>,
  current: (key: string) => unknown,
  initial: (key: string) => unknown,
): FormOverridesPatch {
  const set: Record<string, unknown> = {};
  const clear: string[] = [];
  for (const key of keys) {
    if (on[key]) {
      const value = current(key);
      if (!stored.has(key) || !sameValue(value, initial(key))) set[key] = value;
    } else if (stored.has(key)) {
      clear.push(key);
    }
  }
  return { set, clear };
}

function validateNumber(
  issues: FormIssue[],
  field: string,
  value: string,
  opts: { required: boolean; max: number; code: string },
) {
  if (value.trim() === '') {
    if (opts.required) issues.push({ field, code: 'required' });
    return;
  }
  const n = parseNumber(value);
  if (n === null || n <= 0 || n > opts.max) issues.push({ field, code: opts.code });
}

/**
 * Client validation of the course form, mirroring the canonical schema. `step`
 * limits the checks to one wizard step; `only` keeps the issues of the given
 * override keys (overrides mode).
 */
export function validateCourseForm(
  form: CourseForm,
  context: {
    reference: AdminCourseReference | null;
    creating: boolean;
    step?: number;
    only?: (overrideKey: string) => boolean;
  },
): FormIssue[] {
  const issues: FormIssue[] = [];
  if (context.creating) {
    if (!form.ext_id.trim()) issues.push({ field: '/ext_id', code: 'required' });
    else if (!CODE_PATTERN.test(form.ext_id.trim()))
      issues.push({ field: '/ext_id', code: 'code' });
  }
  if (!form.kind) issues.push({ field: '/kind', code: 'required' });
  if (!form.levels.length) issues.push({ field: '/levels', code: 'chooseLevel' });
  validateNumber(issues, '/ects', form.ects, { required: true, max: 120, code: 'ects' });
  validateNumber(issues, '/teaching_hours', form.teaching_hours, {
    required: false,
    max: 99999.9,
    code: 'positiveNumber',
  });
  if (form.info_url.trim() && !HTTPS_URL_PATTERN.test(form.info_url.trim())) {
    issues.push({ field: '/info_url', code: 'https' });
  }
  if (form.contact_email.trim() && !EMAIL_PATTERN.test(form.contact_email.trim())) {
    issues.push({ field: '/contact_email', code: 'email' });
  }
  const instructors = parseInstructors(form.instructors);
  if (instructors.length > INSTRUCTORS_MAX) {
    issues.push({ field: '/instructors', code: 'tooManyInstructors' });
  } else if (instructors.some((name) => name.length > INSTRUCTOR_NAME_MAX)) {
    issues.push({ field: '/instructors', code: 'instructorTooLong' });
  }
  const broad = new Set((context.reference?.isced_broad_fields ?? []).map((f) => f.code));
  const seen = new Set<string>();
  form.isced.forEach((row, i) => {
    const code = row.code.trim();
    const field = `/isced_codes/${i}/code`;
    if (!code) return;
    if (!ISCED_CODE_PATTERN.test(code)) issues.push({ field, code: 'isced' });
    else if (broad.size && !broad.has(code.slice(0, 2))) issues.push({ field, code: 'iscedBroad' });
    else if (seen.has(code)) issues.push({ field, code: 'iscedDuplicate' });
    seen.add(code);
  });
  if (!form.isced.some((r) => r.code.trim())) {
    issues.push({ field: '/isced_codes/0/code', code: 'iscedRequired' });
  }

  for (const [lang, text] of Object.entries(form.texts)) {
    const used = COURSE_TEXT_FIELDS.some((f) => text[f].trim() !== '');
    if ((lang === 'en' || used) && !text.title.trim()) {
      issues.push({
        field: `/texts/${lang}/title`,
        code: lang === 'en' ? 'englishTitle' : 'title',
      });
    } else if (text.title.trim().length > 500) {
      issues.push({ field: `/texts/${lang}/title`, code: 'tooLong' });
    }
  }

  for (const definition of context.reference?.attribute_definitions ?? []) {
    const value = form.attributes[definition.key];
    if (definition.value_type === 'text' && typeof value === 'string') {
      if (value.trim().length > ATTRIBUTE_TEXT_MAX) {
        issues.push({ field: `/attributes/${definition.key}`, code: 'tooLong' });
      }
    }
  }
  return issues.filter((issue) => {
    if (context.step !== undefined && courseFieldStep(issue.field) !== context.step) return false;
    if (context.only) {
      const key = courseOverrideKeyOf(issue.field);
      return key !== null && context.only(key);
    }
    return true;
  });
}

/** Display text of a course field value (review step, source values). */
export function courseValueText(
  key: string,
  value: unknown,
  reference: AdminCourseReference | null,
  t: (key: string, params?: Record<string, unknown>) => string,
  locale: string,
): string {
  if (value === null || value === undefined || value === '') return t('admin.override.empty');
  if (Array.isArray(value) && value.length === 0) return t('admin.override.empty');
  switch (key) {
    case 'kind':
      return t(`kind.${String(value)}`);
    case 'levels':
      return (value as string[]).map((l) => t(`level.${l}`)).join(', ');
    case 'isced_codes':
      return (value as { code: string; is_primary?: boolean }[])
        .map((c) =>
          c.is_primary ? t('admin.courses.iscedPrimaryValue', { code: c.code }) : c.code,
        )
        .join(', ');
    case 'teaching_unit_ext_id': {
      const unit = reference?.teaching_units.find((u) => u.ext_id === value);
      return unit ? adminLabel(unit.name, locale) : String(value);
    }
    case 'attributes':
      return attributesText(value as Record<string, AdminAttributeValue>, reference, t, locale);
    case 'instructors':
      return Array.isArray(value) ? value.join('; ') : String(value);
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/**
 * Human label of a `completeness.missing` key [DL 21], e.g. `texts.en.description`
 * or `offerings.application_deadline` (→ `admin.completeness.fields.offerings_application_deadline`).
 * A text of another language reads "field (language)"; unknown keys are shown as sent.
 */
export function completenessFieldLabel(
  key: string,
  t: (key: string, params?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
  languageLabel: (tag: string) => string = (tag) => tag,
): string {
  const i18nKey = `admin.completeness.fields.${key.replace(/[^A-Za-z0-9_]/g, '_')}`;
  if (te(i18nKey)) return t(i18nKey);
  const text = /^texts\.([a-z]{2,3})\.([a-z_]+)$/.exec(key);
  if (text) {
    return t('admin.completeness.inLanguage', {
      field: completenessFieldLabel(text[2] ?? '', t, te),
      lang: languageLabel(text[1] ?? ''),
    });
  }
  return key;
}

/** `Label: value; …` of attribute values, in definition order. */
export function attributesText(
  attributes: Record<string, AdminAttributeValue>,
  reference: AdminCourseReference | null,
  t: (key: string, params?: Record<string, unknown>) => string,
  locale: string,
): string {
  const definitions = reference?.attribute_definitions ?? [];
  const parts: string[] = [];
  for (const definition of sortedDefinitions(definitions)) {
    const value = attributes[definition.key];
    if (value === undefined) continue;
    parts.push(
      `${adminLabel(definition.label, locale)}: ${attributeValueText(definition, value, t, locale)}`,
    );
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (!definitions.some((d) => d.key === key)) parts.push(`${key}: ${String(value)}`);
  }
  return parts.length ? parts.join('; ') : t('admin.override.empty');
}

export function attributeValueText(
  definition: AdminAttributeDefinitionRef,
  value: AdminAttributeValue,
  t: (key: string) => string,
  locale: string,
): string {
  if (typeof value === 'boolean') return value ? t('admin.yes') : t('admin.no');
  const label = (v: string) =>
    adminLabel(definition.options?.find((o) => o.value === v)?.label, locale) || v;
  return Array.isArray(value) ? value.map(label).join(', ') : label(value);
}

export function sortedDefinitions<T extends { key: string; sort_order: number }>(
  list: readonly T[],
): T[] {
  return [...list].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Offerings

/** Session select value for a code typed by hand. */
export const OTHER_SESSION = '__other__';

export interface OfferingForm {
  ext_offering_id: string;
  status: 'draft' | 'published' | '';
  /** Reference session `ext_id`, '' for none, {@link OTHER_SESSION} for a typed code. */
  session: string;
  session_other: string;
  start_date: string;
  end_date: string;
  enrol_start_date: string;
  application_deadline: string;
  timezone: string;
  teaching_languages: string[];
  delivery_modes: string[];
  campus: string;
  max_students: string;
  alliance_seats: string;
  seats_available: string;
  application_url: string;
  application_instructions: Record<string, string>;
}

/** Offering fields the form overrides on harvested records (`status`: status actions). */
export const OFFERING_FORM_OVERRIDE_FIELDS: readonly string[] = OFFERING_OVERRIDE_FIELDS.filter(
  (f) => f !== 'status',
);

export function offeringOverrideKeyOf(pointer: string): string | null {
  const head = segments(pointer)[0];
  return head && OFFERING_FORM_OVERRIDE_FIELDS.includes(head) ? head : null;
}

export function emptyOfferingForm(timezone: string): OfferingForm {
  return {
    ext_offering_id: '',
    status: 'draft',
    session: '',
    session_other: '',
    start_date: '',
    end_date: '',
    enrol_start_date: '',
    application_deadline: '',
    timezone,
    teaching_languages: [],
    delivery_modes: [],
    campus: '',
    max_students: '',
    alliance_seats: '',
    seats_available: '',
    application_url: '',
    application_instructions: { en: '' },
  };
}

export function offeringApiValue(offering: AdminOffering, key: string): unknown {
  if (key === 'academic_session_ext_id') {
    return offering.academic_session_ext_id ?? offering.academic_session?.ext_id ?? null;
  }
  return (offering as unknown as Record<string, unknown>)[key] ?? null;
}

export function offeringSourceValue(offering: AdminOffering, key: string): unknown {
  if (key in offering.overrides) return offering.source_values[key] ?? null;
  return offeringApiValue(offering, key);
}

export function applyOfferingValue(
  form: OfferingForm,
  key: string,
  value: unknown,
  reference: AdminCourseReference | null,
): void {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (key) {
    case 'academic_session_ext_id': {
      const code = text(value);
      const known = reference?.academic_sessions.some((s) => s.ext_id === code);
      form.session = !code ? '' : known ? code : OTHER_SESSION;
      form.session_other = code && !known ? code : '';
      break;
    }
    case 'start_date':
    case 'end_date':
    case 'enrol_start_date':
    case 'application_deadline':
    case 'timezone':
    case 'campus':
    case 'application_url':
      form[key] = text(value);
      break;
    case 'teaching_languages':
    case 'delivery_modes':
      form[key] = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
      break;
    case 'max_students':
    case 'alliance_seats':
    case 'seats_available':
      form[key] = typeof value === 'number' ? numberText(value) : text(value);
      break;
    case 'application_instructions': {
      const map =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? { ...(value as Record<string, string>) }
          : {};
      form.application_instructions = { en: '', ...map };
      break;
    }
  }
}

export function offeringFormFromOffering(
  offering: AdminOffering,
  reference: AdminCourseReference | null,
): OfferingForm {
  const form = emptyOfferingForm(offering.timezone);
  form.ext_offering_id = offering.ext_offering_id;
  form.status =
    offering.status === 'draft' || offering.status === 'published' ? offering.status : '';
  for (const key of ['academic_session_ext_id', ...OFFERING_FORM_OVERRIDE_FIELDS]) {
    applyOfferingValue(form, key, offeringApiValue(offering, key), reference);
  }
  return form;
}

function instructionsValue(form: OfferingForm): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [lang, value] of Object.entries(form.application_instructions)) {
    if (value.trim()) out[lang] = value.trim();
  }
  return out;
}

export function offeringFormValue(form: OfferingForm, key: string): unknown {
  switch (key) {
    case 'academic_session_ext_id':
      return form.session === OTHER_SESSION ? orNull(form.session_other) : orNull(form.session);
    case 'start_date':
    case 'end_date':
      return trimmed(form[key]);
    case 'enrol_start_date':
    case 'application_deadline':
    case 'campus':
    case 'application_url':
      return orNull(form[key]);
    case 'timezone':
      return form.timezone;
    case 'teaching_languages':
    case 'delivery_modes':
      return [...form[key]];
    case 'max_students':
    case 'alliance_seats':
    case 'seats_available':
      return parseInteger(form[key]);
    case 'application_instructions':
      return instructionsValue(form);
    default:
      return null;
  }
}

export function offeringInputFromForm(form: OfferingForm): OfferingInput {
  return {
    ext_offering_id: form.ext_offering_id.trim(),
    ...(form.status ? { status: form.status } : {}),
    academic_session_ext_id: offeringFormValue(form, 'academic_session_ext_id') as string | null,
    start_date: trimmed(form.start_date),
    end_date: trimmed(form.end_date),
    enrol_start_date: orNull(form.enrol_start_date),
    application_deadline: orNull(form.application_deadline),
    timezone: form.timezone,
    teaching_languages: [...form.teaching_languages] as OfferingInput['teaching_languages'],
    delivery_modes: [...form.delivery_modes],
    campus: orNull(form.campus),
    max_students: parseInteger(form.max_students),
    alliance_seats: parseInteger(form.alliance_seats),
    seats_available: parseInteger(form.seats_available),
    application_url: orNull(form.application_url),
    application_instructions: instructionsValue(form),
  };
}

export function validateOfferingForm(
  form: OfferingForm,
  context: { creating: boolean; only?: (overrideKey: string) => boolean },
): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (field: string, code: string) => issues.push({ field, code });
  if (context.creating) {
    const code = form.ext_offering_id.trim();
    if (!code) add('/ext_offering_id', 'required');
    else if (!CODE_PATTERN.test(code)) add('/ext_offering_id', 'code');
  }
  if (form.session === OTHER_SESSION) {
    const code = form.session_other.trim();
    if (!code) add('/academic_session_ext_id', 'required');
    else if (!CODE_PATTERN.test(code)) add('/academic_session_ext_id', 'code');
  }
  for (const key of ['start_date', 'end_date'] as const) {
    if (!form[key]) add(`/${key}`, 'required');
    else if (!isIsoDate(form[key])) add(`/${key}`, 'date');
  }
  for (const key of ['enrol_start_date', 'application_deadline'] as const) {
    if (form[key] && !isIsoDate(form[key])) add(`/${key}`, 'date');
  }
  const valid = (v: string) => v !== '' && isIsoDate(v);
  if (valid(form.start_date) && valid(form.end_date) && form.end_date < form.start_date) {
    add('/end_date', 'endBeforeStart');
  }
  if (valid(form.application_deadline) && valid(form.end_date)) {
    if (form.application_deadline > form.end_date) add('/application_deadline', 'deadlineAfterEnd');
  }
  if (valid(form.enrol_start_date) && valid(form.application_deadline)) {
    if (form.enrol_start_date > form.application_deadline) {
      add('/enrol_start_date', 'enrolAfterDeadline');
    }
  }
  if (!form.timezone) add('/timezone', 'required');
  else if (!isTimeZone(form.timezone)) add('/timezone', 'timezone');
  if (!form.teaching_languages.length) add('/teaching_languages', 'chooseLanguage');
  if (!form.delivery_modes.length) add('/delivery_modes', 'chooseMode');
  if (form.campus.trim().length > 200) add('/campus', 'tooLong');

  const integer = (key: 'max_students' | 'alliance_seats' | 'seats_available', min: number) => {
    const raw = form[key].trim();
    if (!raw) return null;
    const n = parseInteger(raw);
    if (n === null || n < min) {
      add(`/${key}`, min > 0 ? 'positiveInteger' : 'nonNegativeInteger');
      return null;
    }
    return n;
  };
  const max = integer('max_students', 1);
  const alliance = integer('alliance_seats', 0);
  const available = integer('seats_available', 0);
  if (max !== null && alliance !== null && alliance > max) {
    add('/alliance_seats', 'seatsExceedCapacity');
  }
  if (max !== null && available !== null && available > max) {
    add('/seats_available', 'seatsExceedCapacity');
  }
  if (form.application_url.trim() && !HTTPS_URL_PATTERN.test(form.application_url.trim())) {
    add('/application_url', 'https');
  }
  for (const [lang, value] of Object.entries(form.application_instructions)) {
    if (value.length > 20_000) add(`/application_instructions/${lang}`, 'tooLong');
  }

  if (!context.only) return issues;
  return issues.filter((issue) => {
    const key = offeringOverrideKeyOf(issue.field);
    return key !== null && context.only!(key);
  });
}

/** Display text of an offering field value (source values). */
export function offeringValueText(
  key: string,
  value: unknown,
  reference: AdminCourseReference | null,
  t: (key: string, params?: Record<string, unknown>) => string,
  locale: string,
): string {
  if (value === null || value === undefined || value === '') return t('admin.override.empty');
  if (Array.isArray(value) && value.length === 0) return t('admin.override.empty');
  switch (key) {
    case 'academic_session_ext_id': {
      const session = reference?.academic_sessions.find((s) => s.ext_id === value);
      return session ? `${adminLabel(session.name, locale)} (${session.ext_id})` : String(value);
    }
    case 'teaching_languages':
      return (value as string[])
        .map(
          (tag) =>
            adminLabel(reference?.languages.find((l) => l.tag === tag)?.label, locale) || tag,
        )
        .join(', ');
    case 'delivery_modes':
      return (value as string[])
        .map(
          (code) =>
            adminLabel(reference?.delivery_modes.find((m) => m.code === code)?.label, locale) ||
            code,
        )
        .join(', ');
    case 'application_instructions': {
      const entries = Object.entries(value as Record<string, string>);
      return entries.length
        ? entries.map(([lang, text]) => `${lang}: ${text}`).join(' · ')
        : t('admin.override.empty');
    }
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
