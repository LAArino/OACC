// SPDX-License-Identifier: EUPL-1.2
/**
 * CSV template 1.0 row schemas (spec §6.3). They validate raw cells as parsed
 * by an RFC 4180 reader: every value is a string, an empty optional cell clears
 * the field, and a column absent from the header leaves the field untouched.
 * Issue messages are stable error codes from `errors.json`.
 */
import { z } from 'zod';
import type { ErrorCode } from './error-codes.js';
import {
  CODE_PATTERN,
  EMAIL_PATTERN,
  HTTPS_URL_PATTERN,
  LANGUAGE_TAG_PATTERN,
} from './primitives.js';

export const CSV_TEMPLATE_VERSION = '1.0';
export const CSV_MAX_CELL_LENGTH = 20_000;
export const CSV_MULTI_VALUE_SEPARATOR = '|';

const LANG = '[a-z]{2,3}';
const TAG = LANGUAGE_TAG_PATTERN.source.slice(1, -1);
const DELIVERY_MODE = '(x-)?[a-z][a-z0-9_-]*';

/** Per-language text columns, e.g. `abstract_de`; `title_en` is a fixed required column. */
export const CSV_COURSE_LANGUAGE_COLUMN = new RegExp(
  `^(title|abstract|description|learning_outcomes|prerequisites|assessment|keywords)_${LANG}$`,
);

function cell(pattern: RegExp | null, code: ErrorCode) {
  const base = z
    .string({
      error: (iss) => (iss.input === undefined ? 'oecp.csv.missing_column' : code),
    })
    .max(CSV_MAX_CELL_LENGTH, { error: 'oecp.csv.cell_too_long' });
  return pattern ? base.regex(pattern, { error: code }) : base;
}

function required(pattern: RegExp | null, code: ErrorCode) {
  return cell(pattern, code).min(1, { error: 'oecp.csv.missing_value' });
}

function blankOr(pattern: RegExp, code: ErrorCode) {
  return cell(new RegExp(`^(?:|${pattern.source.slice(1, -1)})$`), code).optional();
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const status = cell(/^(draft|published|withdrawn|cancelled)$/, 'oecp.csv.invalid_status');
const templateVersion = cell(/^1\.0$/, 'oecp.csv.invalid_template_version');
const code = required(CODE_PATTERN, 'oecp.csv.invalid_code');

const courseColumns = {
  template_version: templateVersion,
  course_code: code,
  status,
  ects: required(/^\d{1,3}(\.\d{1,2})?$/, 'oecp.csv.invalid_number'),
  isced_codes: required(/^\d{2,6}(\|\d{2,6})*$/, 'oecp.csv.invalid_isced'),
  title_en: required(/^[\s\S]{1,500}$/, 'oecp.content.english_missing'),
  level: blankOr(/^(short_cycle|bachelor|master|doctoral|other)$/, 'oecp.csv.invalid_level'),
  eqf_level: blankOr(/^[1-8]$/, 'oecp.csv.invalid_level'),
  teaching_hours: blankOr(/^\d{1,5}(\.\d)?$/, 'oecp.csv.invalid_number'),
  teaching_unit_code: blankOr(CODE_PATTERN, 'oecp.csv.invalid_code'),
  info_url: blankOr(HTTPS_URL_PATTERN, 'oecp.csv.invalid_url'),
  contact_email: blankOr(EMAIL_PATTERN, 'oecp.csv.invalid_email'),
};

/** One row of `courses.csv`. Extra keys must match {@link CSV_COURSE_LANGUAGE_COLUMN}. */
export const csvCourseRow = z
  .object(courseColumns)
  .catchall(cell(null, 'oecp.csv.cell_too_long'))
  .superRefine((row, ctx) => {
    for (const key of Object.keys(row)) {
      if (!(key in courseColumns) && !CSV_COURSE_LANGUAGE_COLUMN.test(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'oecp.csv.unknown_column' });
      }
    }
    const ects = Number(row.ects);
    if (!(ects > 0 && ects <= 120)) {
      ctx.addIssue({ code: 'custom', path: ['ects'], message: 'oecp.csv.invalid_number' });
    }
  })
  .meta({
    patternProperties: {
      [CSV_COURSE_LANGUAGE_COLUMN.source]: { type: 'string', maxLength: CSV_MAX_CELL_LENGTH },
    },
    additionalProperties: false,
  });
export type CsvCourseRow = z.infer<typeof csvCourseRow>;

const date = required(ISO_DATE, 'oecp.csv.invalid_date');

/** One row of `offerings.csv`. */
export const csvOfferingRow = z
  .strictObject(
    {
      template_version: templateVersion,
      course_code: code,
      offering_code: code,
      status,
      start_date: date,
      end_date: date,
      teaching_languages: required(new RegExp(`^${TAG}(\\|${TAG})*$`), 'oecp.csv.invalid_language'),
      delivery_modes: required(
        new RegExp(`^${DELIVERY_MODE}(\\|${DELIVERY_MODE})*$`),
        'oecp.csv.invalid_delivery_mode',
      ),
      academic_session_code: blankOr(CODE_PATTERN, 'oecp.csv.invalid_code'),
      enrol_start_date: blankOr(ISO_DATE, 'oecp.csv.invalid_date'),
      application_deadline: blankOr(ISO_DATE, 'oecp.csv.invalid_date'),
      timezone: blankOr(
        /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/,
        'oecp.csv.invalid_timezone',
      ),
      campus: blankOr(/^[\s\S]{1,200}$/, 'oecp.content.invalid_value'),
      max_students: blankOr(/^[1-9]\d{0,8}$/, 'oecp.csv.invalid_number'),
      alliance_seats: blankOr(/^\d{1,9}$/, 'oecp.csv.invalid_number'),
      seats_available: blankOr(/^\d{1,9}$/, 'oecp.csv.invalid_number'),
      application_url: blankOr(HTTPS_URL_PATTERN, 'oecp.csv.invalid_url'),
    },
    { error: 'oecp.csv.unknown_column' },
  )
  .superRefine((row, ctx) => {
    if (row.end_date < row.start_date) {
      ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'oecp.content.date_order' });
    }
    if (
      row.alliance_seats &&
      row.max_students &&
      Number(row.alliance_seats) > Number(row.max_students)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['alliance_seats'],
        message: 'oecp.content.seats_exceed_capacity',
      });
    }
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
