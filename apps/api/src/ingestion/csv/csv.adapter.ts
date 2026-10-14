// SPDX-License-Identifier: EUPL-1.2
import { Injectable } from '@nestjs/common';
import {
  type AcademicSession,
  academicSession as academicSessionSchema,
  type Course,
  course as courseSchema,
  type CourseAttributes,
  type CourseKind,
  type CourseLevel,
  type CourseOffering,
  courseOffering as courseOfferingSchema,
  type CourseText,
  CSV_COURSE_TEXT_FIELDS,
  type CsvFileKind,
  type CsvIssue,
  ERROR_CODES,
  type ErrorCode,
  isErrorCode,
  type NormalizedCourseRow,
  type NormalizedOfferingRow,
  resolveLevels,
} from '@oecp/schemas';
import type { z } from 'zod';

/**
 * Current values of a course, for the columns an upload leaves out of its header
 * ("a column absent from the header leaves the field untouched", spec §6.3).
 */
export interface ExistingCourse {
  kind: CourseKind;
  level: Course['level'];
  levels: CourseLevel[];
  attributes: CourseAttributes;
  eqf_level: number | null;
  teaching_hours: number | null;
  teaching_unit_ext_id: string | null;
  info_url: string | null;
  contact_email: string | null;
  /** Keyed by language. */
  texts: Record<string, CourseText>;
}

/** Current values of an offering, for columns absent from the header. */
export interface ExistingOffering {
  academic_session_ext_id: string | null;
  enrol_start_date: string | null;
  application_deadline: string | null;
  timezone: string;
  campus: string | null;
  max_students: number | null;
  alliance_seats: number | null;
  seats_available: number | null;
  seats_updated_at: string | null;
  application_url: string | null;
  application_instructions: Record<string, string>;
}

export interface CsvMappingContext {
  /** `organizations.default_timezone` (offering `timezone` default, spec §6.3). */
  defaultTimezone: string;
  /** Upload time: `seats_updated_at` of rows with `seats_available` (spec §6.3). */
  uploadedAt: Date;
}

export type CsvMappingResult<T> = { ok: true; value: T } | { ok: false; errors: CsvIssue[] };

export interface MappedCsvCourse {
  course: Course;
  /** The row as uploaded: `ext_metadata_history.raw_payload`. */
  raw: Record<string, string>;
}

export interface MappedCsvOffering {
  offering: CourseOffering;
  raw: Record<string, string>;
}

/** Canonical course member → `courses.csv` column. */
const COURSE_COLUMNS: Readonly<Record<string, string>> = {
  ext_id: 'course_code',
  teaching_unit_ext_id: 'teaching_unit_code',
};

/** Canonical offering member → `offerings.csv` column. */
const OFFERING_COLUMNS: Readonly<Record<string, string>> = {
  course_ext_id: 'course_code',
  ext_offering_id: 'offering_code',
  academic_session_ext_id: 'academic_session_code',
  seats_updated_at: 'seats_available',
};

/**
 * Applies per-key cells to the current map: `null` removes the key, a value sets
 * it, keys without a column stay. Keys sorted for a stable hash.
 */
function mergeKeyed<T>(
  current: Readonly<Record<string, T>> | undefined,
  given: Readonly<Record<string, T | null>>,
): Record<string, T> {
  const out: Record<string, T> = { ...current };
  for (const [key, value] of Object.entries(given)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return sortKeys(out);
}

/** Absent column (`undefined`) keeps the current value; empty cell (`null`) clears it. */
function pick<T>(value: T | null | undefined, current: T | null | undefined): T | null {
  return value === undefined ? (current ?? null) : value;
}

function canonicalIssues(
  file: CsvFileKind,
  row: number,
  error: z.ZodError,
  column: (path: readonly PropertyKey[]) => string | undefined,
): CsvIssue[] {
  return error.issues.map((iss) => {
    const code: ErrorCode = isErrorCode(iss.message) ? iss.message : 'oecp.content.invalid_value';
    const base = ERROR_CODES[code].message;
    const out: CsvIssue = {
      code,
      severity: 'error',
      file,
      row,
      message: code === iss.message ? base : `${base}: ${iss.message}`,
    };
    const name = column(iss.path);
    if (name) out.column = name;
    return out;
  });
}

/**
 * Channel B mapping, validated CSV rows → canonical DTOs of the same shape as the
 * OEAPI adapter's (spec §6.1, §6.3). Pure: current database values are passed in.
 * Every DTO is checked against the canonical schema; failures carry row/column.
 */
@Injectable()
export class CsvAdapter {
  mapCourse(
    row: NormalizedCourseRow,
    existing?: ExistingCourse,
  ): CsvMappingResult<MappedCsvCourse> {
    const headerLanguages = new Set([...Object.keys(row.texts), ...row.deleted_languages]);
    const texts: Record<string, CourseText> = {};
    // Languages absent from the header are untouched.
    for (const [lang, text] of Object.entries(existing?.texts ?? {})) {
      if (!headerLanguages.has(lang)) texts[lang] = text;
    }
    for (const [lang, given] of Object.entries(row.texts)) {
      const current = existing?.texts[lang];
      const text: CourseText = {
        title: given.title ?? current?.title ?? '',
        abstract: pick(given.abstract, current?.abstract),
        description: pick(given.description, current?.description),
        learning_outcomes: pick(given.learning_outcomes, current?.learning_outcomes),
        prerequisites: pick(given.prerequisites, current?.prerequisites),
        assessment: pick(given.assessment, current?.assessment),
        keywords: given.keywords === undefined ? (current?.keywords ?? []) : (given.keywords ?? []),
        // Uploaded texts are written by people.
        is_machine_translated: false,
      };
      texts[lang] = text;
    }

    const levels =
      row.levels === undefined
        ? resolveLevels(existing?.level, existing?.levels)
        : resolveLevels(row.level ?? null, row.levels ?? []);
    const candidate: Course = {
      ext_id: row.course_code,
      source_ref: null,
      status: row.status,
      kind: row.kind === undefined ? (existing?.kind ?? 'course') : (row.kind ?? 'course'),
      ects: row.ects,
      level: levels.level,
      levels: levels.levels,
      eqf_level: pick(row.eqf_level, existing?.eqf_level),
      teaching_hours: pick(row.teaching_hours, existing?.teaching_hours),
      teaching_unit_ext_id: pick(row.teaching_unit_code, existing?.teaching_unit_ext_id),
      info_url: pick(row.info_url, existing?.info_url),
      contact_email: pick(row.contact_email, existing?.contact_email),
      isced_codes: row.isced_codes,
      texts: sortKeys(texts),
      attributes: mergeKeyed(existing?.attributes, row.attributes),
    };
    const checked = courseSchema.safeParse(candidate);
    if (!checked.success) {
      return {
        ok: false,
        errors: canonicalIssues('courses', row.row, checked.error, (path) => {
          const [member, lang, field] = path.map(String);
          if (member === 'texts') {
            const name = CSV_COURSE_TEXT_FIELDS.find((f) => f === field) ?? 'title';
            return lang ? `${name}_${lang}` : undefined;
          }
          if (member === 'attributes') return lang ? `attr_${lang}` : undefined;
          if (member === 'level' && row.levels !== undefined) return 'levels';
          return member ? (COURSE_COLUMNS[member] ?? member) : undefined;
        }),
      };
    }
    return { ok: true, value: { course: checked.data, raw: row.source } };
  }

  mapOffering(
    row: NormalizedOfferingRow,
    existing: ExistingOffering | undefined,
    ctx: CsvMappingContext,
  ): CsvMappingResult<MappedCsvOffering> {
    const seatsAvailable = pick(row.seats_available, existing?.seats_available);
    let seatsUpdatedAt: string | null;
    if (row.seats_available === undefined) {
      seatsUpdatedAt = seatsAvailable === null ? null : (existing?.seats_updated_at ?? null);
    } else {
      seatsUpdatedAt = row.seats_available === null ? null : ctx.uploadedAt.toISOString();
    }
    const timezone =
      row.timezone === undefined
        ? (existing?.timezone ?? ctx.defaultTimezone)
        : (row.timezone ?? ctx.defaultTimezone);

    const candidate: CourseOffering = {
      course_ext_id: row.course_code,
      ext_offering_id: row.offering_code,
      source_ref: null,
      status: row.status,
      academic_session_ext_id: pick(row.academic_session_code, existing?.academic_session_ext_id),
      start_date: row.start_date,
      end_date: row.end_date,
      enrol_start_date: pick(row.enrol_start_date, existing?.enrol_start_date),
      application_deadline: pick(row.application_deadline, existing?.application_deadline),
      timezone,
      teaching_languages: row.teaching_languages,
      delivery_modes: row.delivery_modes,
      campus: pick(row.campus, existing?.campus),
      max_students: pick(row.max_students, existing?.max_students),
      alliance_seats: pick(row.alliance_seats, existing?.alliance_seats),
      seats_available: seatsAvailable,
      seats_updated_at: seatsUpdatedAt,
      application_url: pick(row.application_url, existing?.application_url),
      application_instructions: mergeKeyed(
        existing?.application_instructions,
        row.application_instructions,
      ),
    };
    const checked = courseOfferingSchema.safeParse(candidate);
    if (!checked.success) {
      return {
        ok: false,
        errors: canonicalIssues('offerings', row.row, checked.error, (path) => {
          const member = path[0] === undefined ? undefined : String(path[0]);
          if (member === 'application_instructions') {
            return path[1] === undefined
              ? undefined
              : `application_instructions_${String(path[1])}`;
          }
          return member ? (OFFERING_COLUMNS[member] ?? member) : undefined;
        }),
      };
    }
    return { ok: true, value: { offering: checked.data, raw: row.source } };
  }

  /**
   * Minimal academic sessions for codes not yet in the catalogue (spec §6.3:
   * `academic_session_code` upserts by `ext_id`): name = code, type `period`,
   * dates spanning the offerings that use it. Known sessions are left untouched.
   */
  sessionsFor(
    offerings: readonly CourseOffering[],
    known: ReadonlySet<string>,
  ): { session: AcademicSession; raw: Record<string, string> }[] {
    const spans = new Map<string, { start: string; end: string }>();
    for (const o of offerings) {
      const code = o.academic_session_ext_id;
      if (!code || known.has(code)) continue;
      const span = spans.get(code);
      spans.set(code, {
        start: span && span.start < o.start_date ? span.start : o.start_date,
        end: span && span.end > o.end_date ? span.end : o.end_date,
      });
    }
    return [...spans].map(([code, span]) => ({
      session: academicSessionSchema.parse({
        ext_id: code,
        parent_ext_id: null,
        session_type: 'period',
        name: { en: code },
        start_date: span.start,
        end_date: span.end,
      }),
      raw: {
        academic_session_code: code,
        start_date: span.start,
        end_date: span.end,
        derived_from: 'offerings',
      },
    }));
  }
}

/** Stable key order, so equal texts hash equally (RFC 8785 sorts anyway). */
function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
