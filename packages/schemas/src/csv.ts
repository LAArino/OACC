// SPDX-License-Identifier: EUPL-1.2
/**
 * CSV template 1.1 row schemas (spec §6.3; 1.0 files stay valid). They validate raw cells as parsed
 * by an RFC 4180 reader: every value is a string, an empty optional cell clears
 * the field, and a column absent from the header leaves the field untouched.
 * Issue messages are stable error codes from `errors.json`.
 *
 * Row-local DDL constraints (calendar dates, date order, seats, ISCED duplicates,
 * IANA time zones, BCP 47 tags) are refinements: they run in the browser and on
 * the server through {@link validateCsvRows} but cannot be expressed in the
 * generated JSON Schema. Header, cross-row and reference checks live in
 * `csv-validate.ts`.
 *
 * Template 1.1 (decision 18) adds optional columns: `kind`, `levels` (preferred
 * over `level`) and `attr_<key>` per alliance attribute in `courses.csv`;
 * `application_instructions_<lang>` in `offerings.csv`. Rows using them declare
 * `template_version` 1.1; a 1.0 row simply has none of them.
 */
import { z } from 'zod';
import { syncRunStatus } from './enums.js';
import type { ErrorCode } from './error-codes.js';
import {
  CODE_PATTERN,
  EMAIL_PATTERN,
  HTTPS_URL_PATTERN,
  ianaTimeZone,
  LANGUAGE_TAG_PATTERN,
  languageTag,
  uuid,
} from './primitives.js';

/** Current template version (generated templates); every version of {@link CSV_TEMPLATE_VERSIONS} is accepted. */
export const CSV_TEMPLATE_VERSION = '1.1';
export const CSV_TEMPLATE_VERSIONS = ['1.0', '1.1'] as const;
/** `sync_runs.schema_version` and `ext_metadata_history.schema_version` of Channel B. */
export const CSV_SCHEMA_VERSION = 'csv-1.1';
export const CSV_MAX_CELL_LENGTH = 20_000;
export const CSV_MULTI_VALUE_SEPARATOR = '|';
/** Spec §6.3 limits: 5 MB (MiB) and 5,000 rows per file, 300 columns, 10 uploads per hour. */
export const CSV_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 5_000;
export const CSV_MAX_COLUMNS = 300;
export const CSV_UPLOADS_PER_HOUR = 10;

export const csvFileKind = z.enum(['courses', 'offerings']);
export type CsvFileKind = z.infer<typeof csvFileKind>;

const LANG = '[a-z]{2,3}';
const TAG = LANGUAGE_TAG_PATTERN.source.slice(1, -1);
const DELIVERY_MODE = '(x-)?[a-z][a-z0-9_-]*';

/** Per-language text fields of `courses.csv`, suffixed `_<lang>`. */
export const CSV_COURSE_TEXT_FIELDS = [
  'title',
  'abstract',
  'description',
  'learning_outcomes',
  'prerequisites',
  'assessment',
  'keywords',
] as const;
export type CsvCourseTextField = (typeof CSV_COURSE_TEXT_FIELDS)[number];

/** Per-language text columns, e.g. `abstract_de`; `title_en` is a fixed required column. */
export const CSV_COURSE_LANGUAGE_COLUMN = new RegExp(
  `^(${CSV_COURSE_TEXT_FIELDS.join('|')})_(${LANG})$`,
);

/** `attr_<key>` columns of `courses.csv` (template 1.1); the key is group 1. */
export const CSV_COURSE_ATTRIBUTE_COLUMN = /^attr_([a-z][a-z0-9_]{1,39})$/;
/** `application_instructions_<lang>` columns of `offerings.csv` (template 1.1); the language is group 1. */
export const CSV_OFFERING_LANGUAGE_COLUMN = new RegExp(`^application_instructions_(${LANG})$`);
/** Fixed columns introduced by template 1.1. */
export const CSV_TEMPLATE_1_1_COLUMNS: Readonly<Record<CsvFileKind, readonly string[]>> = {
  courses: ['kind', 'levels'],
  offerings: [],
};

/** Whether a column exists only in template 1.1. */
export function isTemplate11Column(kind: CsvFileKind, column: string): boolean {
  if (CSV_TEMPLATE_1_1_COLUMNS[kind].includes(column)) return true;
  return kind === 'courses'
    ? CSV_COURSE_ATTRIBUTE_COLUMN.test(column)
    : CSV_OFFERING_LANGUAGE_COLUMN.test(column);
}

export const CSV_COURSE_REQUIRED_COLUMNS = [
  'template_version',
  'course_code',
  'status',
  'ects',
  'isced_codes',
  'title_en',
] as const;
export const CSV_COURSE_OPTIONAL_COLUMNS = [
  'kind',
  'levels',
  'level',
  'eqf_level',
  'teaching_hours',
  'teaching_unit_code',
  'info_url',
  'contact_email',
] as const;
export const CSV_OFFERING_REQUIRED_COLUMNS = [
  'template_version',
  'course_code',
  'offering_code',
  'status',
  'start_date',
  'end_date',
  'teaching_languages',
  'delivery_modes',
] as const;
export const CSV_OFFERING_OPTIONAL_COLUMNS = [
  'academic_session_code',
  'enrol_start_date',
  'application_deadline',
  'timezone',
  'campus',
  'max_students',
  'alliance_seats',
  'seats_available',
  'application_url',
] as const;

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `YYYY-MM-DD` that exists in the Gregorian calendar (rejects 2027-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * A string cell. Checks abort on the first failure so that a cell yields one
 * issue: missing column, then empty (required cells), length, pattern, refinement.
 */
function cell(pattern: RegExp | null, code: ErrorCode, nonEmpty = false) {
  let base = z.string({
    error: (iss) => (iss.input === undefined ? 'oecp.csv.missing_column' : code),
  });
  if (nonEmpty) base = base.min(1, { error: 'oecp.csv.missing_value', abort: true });
  base = base.max(CSV_MAX_CELL_LENGTH, { error: 'oecp.csv.cell_too_long', abort: true });
  return pattern ? base.regex(pattern, { error: code, abort: true }) : base;
}

function required(pattern: RegExp | null, code: ErrorCode, check?: (v: string) => boolean) {
  const base = cell(pattern, code, true);
  return check ? base.refine(check, { error: code }) : base;
}

function blankOr(pattern: RegExp, code: ErrorCode, check?: (v: string) => boolean) {
  const base = cell(new RegExp(`^(?:|${pattern.source.slice(1, -1)})$`), code);
  return (check ? base.refine((v) => v === '' || check(v), { error: code }) : base).optional();
}

const isTimeZone = (v: string) => ianaTimeZone.safeParse(v).success;
const areLanguageTags = (v: string) =>
  splitMultiValue(v).every((tag) => languageTag.safeParse(tag).success);

const status = cell(/^(draft|published|withdrawn|cancelled)$/, 'oecp.csv.invalid_status');
const templateVersion = cell(/^1\.[01]$/, 'oecp.csv.invalid_template_version');
const LEVEL = '(short_cycle|bachelor|master|doctoral|other)';
const code = required(CODE_PATTERN, 'oecp.csv.invalid_code');

const courseColumns = {
  template_version: templateVersion,
  course_code: code,
  status,
  ects: required(/^\d{1,3}(\.\d{1,2})?$/, 'oecp.csv.invalid_number'),
  isced_codes: required(/^\d{2,6}(\|\d{2,6})*$/, 'oecp.csv.invalid_isced'),
  title_en: required(/^[\s\S]{1,500}$/, 'oecp.content.english_missing'),
  kind: blankOr(/^(course|bip|lecture_series|other)$/, 'oecp.csv.invalid_kind'),
  levels: blankOr(new RegExp(`^${LEVEL}(\\|${LEVEL})*$`), 'oecp.csv.invalid_level'),
  level: blankOr(new RegExp(`^${LEVEL}$`), 'oecp.csv.invalid_level'),
  eqf_level: blankOr(/^[1-8]$/, 'oecp.csv.invalid_level'),
  teaching_hours: blankOr(/^\d{1,5}(\.\d)?$/, 'oecp.csv.invalid_number', (v) => Number(v) > 0),
  teaching_unit_code: blankOr(CODE_PATTERN, 'oecp.csv.invalid_code'),
  info_url: blankOr(HTTPS_URL_PATTERN, 'oecp.csv.invalid_url', (v) => v.length <= 2048),
  contact_email: blankOr(EMAIL_PATTERN, 'oecp.csv.invalid_email', (v) => v.length <= 320),
};

/** Template 1.0 rows must not use 1.1 columns (non-empty or not: the header decides). */
function checkTemplateVersion(
  kind: CsvFileKind,
  row: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  if (row['template_version'] !== '1.0') return;
  const newer = Object.keys(row).filter((key) => isTemplate11Column(kind, key));
  if (newer.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['template_version'],
      message: 'oecp.csv.invalid_template_version',
    });
  }
}

/**
 * One row of `courses.csv`. Extra keys must match {@link CSV_COURSE_LANGUAGE_COLUMN}
 * or {@link CSV_COURSE_ATTRIBUTE_COLUMN}; attribute values are checked against the
 * alliance's definitions in `csv-validate.ts`.
 */
export const csvCourseRow = z
  .object(courseColumns)
  .catchall(cell(null, 'oecp.csv.cell_too_long'))
  .superRefine((row, ctx) => {
    checkTemplateVersion('courses', row, ctx);
    for (const key of Object.keys(row)) {
      if (
        !(key in courseColumns) &&
        !CSV_COURSE_LANGUAGE_COLUMN.test(key) &&
        !CSV_COURSE_ATTRIBUTE_COLUMN.test(key)
      ) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'oecp.csv.unknown_column' });
      } else if (key.startsWith('title_') && String(row[key]).length > 500) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'oecp.content.invalid_value' });
      }
    }
    const ects = Number(row.ects);
    if (!(ects > 0 && ects <= 120)) {
      ctx.addIssue({ code: 'custom', path: ['ects'], message: 'oecp.csv.invalid_number' });
    }
    const isced = splitMultiValue(row.isced_codes);
    if (new Set(isced).size !== isced.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['isced_codes'],
        message: 'oecp.content.duplicate_isced',
      });
    }
  })
  .meta({
    patternProperties: {
      [CSV_COURSE_LANGUAGE_COLUMN.source]: { type: 'string', maxLength: CSV_MAX_CELL_LENGTH },
      [CSV_COURSE_ATTRIBUTE_COLUMN.source]: { type: 'string', maxLength: CSV_MAX_CELL_LENGTH },
    },
    additionalProperties: false,
  });
export type CsvCourseRow = z.infer<typeof csvCourseRow>;

const date = required(ISO_DATE, 'oecp.csv.invalid_date', isCalendarDate);
const optionalDate = blankOr(ISO_DATE, 'oecp.csv.invalid_date', isCalendarDate);

const offeringColumns = {
  template_version: templateVersion,
  course_code: code,
  offering_code: code,
  status,
  start_date: date,
  end_date: date,
  teaching_languages: required(
    new RegExp(`^${TAG}(\\|${TAG})*$`),
    'oecp.csv.invalid_language',
    areLanguageTags,
  ),
  delivery_modes: required(
    new RegExp(`^${DELIVERY_MODE}(\\|${DELIVERY_MODE})*$`),
    'oecp.csv.invalid_delivery_mode',
  ),
  academic_session_code: blankOr(CODE_PATTERN, 'oecp.csv.invalid_code'),
  enrol_start_date: optionalDate,
  application_deadline: optionalDate,
  timezone: blankOr(
    /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/,
    'oecp.csv.invalid_timezone',
    isTimeZone,
  ),
  campus: blankOr(/^[\s\S]{1,200}$/, 'oecp.content.invalid_value'),
  max_students: blankOr(/^[1-9]\d{0,8}$/, 'oecp.csv.invalid_number'),
  alliance_seats: blankOr(/^\d{1,9}$/, 'oecp.csv.invalid_number'),
  seats_available: blankOr(/^\d{1,9}$/, 'oecp.csv.invalid_number'),
  application_url: blankOr(HTTPS_URL_PATTERN, 'oecp.csv.invalid_url', (v) => v.length <= 2048),
};

/** One row of `offerings.csv`. Extra keys must match {@link CSV_OFFERING_LANGUAGE_COLUMN}. */
export const csvOfferingRow = z
  .object(offeringColumns)
  .catchall(cell(null, 'oecp.csv.cell_too_long'))
  .superRefine((row, ctx) => {
    const issue = (path: string, message: ErrorCode) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    checkTemplateVersion('offerings', row, ctx);
    for (const key of Object.keys(row)) {
      if (!(key in offeringColumns) && !CSV_OFFERING_LANGUAGE_COLUMN.test(key)) {
        issue(key, 'oecp.csv.unknown_column');
      }
    }
    if (row.end_date < row.start_date) issue('end_date', 'oecp.content.date_order');
    if (row.application_deadline && row.application_deadline > row.end_date) {
      issue('application_deadline', 'oecp.content.date_order');
    }
    if (
      row.enrol_start_date &&
      row.application_deadline &&
      row.enrol_start_date > row.application_deadline
    ) {
      issue('enrol_start_date', 'oecp.content.date_order');
    }
    const max = row.max_students ? Number(row.max_students) : null;
    if (row.alliance_seats && max !== null && Number(row.alliance_seats) > max) {
      issue('alliance_seats', 'oecp.content.seats_exceed_capacity');
    }
    if (row.seats_available && max !== null && Number(row.seats_available) > max) {
      issue('seats_available', 'oecp.content.seats_exceed_capacity');
    }
  })
  .meta({
    patternProperties: {
      [CSV_OFFERING_LANGUAGE_COLUMN.source]: { type: 'string', maxLength: CSV_MAX_CELL_LENGTH },
    },
    additionalProperties: false,
  });
export type CsvOfferingRow = z.infer<typeof csvOfferingRow>;

/** Splits a `|`-separated multi-value cell; empty cell → empty list. */
export function splitMultiValue(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(CSV_MULTI_VALUE_SEPARATOR)
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * `POST /api/admin/v1/organizations/{orgId}/uploads` → 201 (processed inline) or
 * 202 (queued). An inline run that fails validation answers 422 problem+json
 * whose `errors` carry file/row/column, with these members as extensions.
 */
export const csvUploadResponse = z.object({
  sync_run_id: uuid,
  status: syncRunStatus,
  processed_inline: z.boolean(),
});
export type CsvUploadResponse = z.infer<typeof csvUploadResponse>;
