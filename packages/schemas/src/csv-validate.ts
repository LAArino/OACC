// SPDX-License-Identifier: EUPL-1.2
/**
 * Channel B validation shared by the browser (CSV console, in a Web Worker) and
 * the server, which always revalidates (spec §6.3). Pure and dependency-free
 * apart from Zod: no Node.js modules, no I/O.
 *
 * Pipeline: {@link decodeCsvBytes} (UTF-8, BOM) → {@link parseCsvText} (RFC 4180,
 * separator detection, limits) → {@link validateCsvRows} (header checks, the Zod
 * row schemas of `csv.ts`, cross-row and reference checks) → normalized rows that
 * the server maps to canonical DTOs. Rows are numbered as a spreadsheet shows
 * them: the header is row 1, the first data record row 2 (a quoted cell spanning
 * several lines is still one row).
 */
import type { z } from 'zod';
import {
  CSV_COURSE_LANGUAGE_COLUMN,
  CSV_COURSE_OPTIONAL_COLUMNS,
  CSV_COURSE_REQUIRED_COLUMNS,
  CSV_MAX_CELL_LENGTH,
  CSV_MAX_COLUMNS,
  CSV_MAX_ROWS,
  CSV_OFFERING_OPTIONAL_COLUMNS,
  CSV_OFFERING_REQUIRED_COLUMNS,
  type CsvCourseTextField,
  type CsvFileKind,
  csvCourseRow,
  csvOfferingRow,
  splitMultiValue,
} from './csv.js';
import type { CourseLevel, LifecycleStatus } from './enums.js';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';
import { issuesToProblemErrors } from './problem.js';

/** One validation finding; the shape of an RFC 9457 `errors[]` member (spec §6.6). */
export interface CsvIssue {
  code: ErrorCode;
  severity: 'error' | 'warning';
  file: CsvFileKind;
  /** 1-based row; the header is row 1. Absent for file-level issues (e.g. encoding). */
  row?: number;
  column?: string;
  message: string;
}

export type CsvSeparator = ',' | ';';

export interface CsvParseOptions {
  /** Labels the issues; defaults to `courses`. */
  file?: CsvFileKind;
  /** Data rows (header excluded); default 5,000. */
  maxRows?: number;
  /** Header columns; default 300. */
  maxCols?: number;
  /** Characters per cell; default 20,000. Longer cells are reported and truncated. */
  maxCell?: number;
}

export interface ParsedCsv {
  separator: CsvSeparator;
  /** Header names, verbatim. Empty when the file has no header. */
  header: string[];
  /** Data rows keyed by header name; blank and malformed records are left out. */
  rows: Record<string, string>[];
  /** Spreadsheet row number of each entry of `rows` (header = 1). */
  rowNumbers: number[];
  /** Structural problems: malformed quoting, cell counts, limits. */
  errors: CsvIssue[];
}

/**
 * Reference data for the checks the JSON Schema cannot express. Each check runs
 * only when its list is given: the server passes them all from the database, the
 * browser what `/api/admin/v1/reference` returned.
 */
export interface CsvReferenceData {
  /** ISCED-F broad fields (`isced_broad_fields.code`); a code is valid if its first two digits are listed. */
  iscedCodes?: Iterable<string>;
  /** Active `delivery_modes.code` values. */
  deliveryModes?: Iterable<string>;
  /** Allowed primary language subtags of `teaching_languages` (any well-formed tag when absent). */
  languageTags?: Iterable<string>;
  /** `ext_id` of the organization's sub-units, for `teaching_unit_code`. */
  teachingUnitCodes?: Iterable<string>;
  /** Course codes already in the catalogue; `offerings.csv` may also use those of `courses.csv`. */
  courseCodes?: Iterable<string>;
}

export interface CsvValidateOptions {
  /** Header of the file; defaults to the keys of the first row. Enables header-level checks. */
  header?: readonly string[];
  /** Row number of each row; defaults to index + 2. */
  rowNumbers?: readonly number[];
  referenceData?: CsvReferenceData;
  /** Issues kept per severity (default 1,000); the counts are always exact. */
  maxIssues?: number;
}

/** Per-language texts of a course row; a field is `undefined` when its column is absent. */
export type NormalizedCourseText = {
  [K in Exclude<CsvCourseTextField, 'keywords'>]?: string | null;
} & { keywords?: string[] | null };

/**
 * A valid `courses.csv` row. Optional members are `undefined` when the column is
 * absent from the header (field untouched) and `null` when the cell is empty
 * (field cleared).
 */
export interface NormalizedCourseRow {
  row: number;
  course_code: string;
  status: LifecycleStatus;
  ects: number;
  /** First is primary. */
  isced_codes: string[];
  level?: CourseLevel | null;
  eqf_level?: number | null;
  teaching_hours?: number | null;
  teaching_unit_code?: string | null;
  info_url?: string | null;
  contact_email?: string | null;
  /** Languages with at least one column in the header and one non-empty cell. */
  texts: Record<string, NormalizedCourseText>;
  /** Header languages whose cells are all empty: deleted (never `en`). */
  deleted_languages: string[];
  /** The row as parsed (cells verbatim). */
  source: Record<string, string>;
}

/** A valid `offerings.csv` row; `undefined`/`null` as in {@link NormalizedCourseRow}. */
export interface NormalizedOfferingRow {
  row: number;
  course_code: string;
  offering_code: string;
  status: LifecycleStatus;
  start_date: string;
  end_date: string;
  teaching_languages: string[];
  delivery_modes: string[];
  academic_session_code?: string | null;
  enrol_start_date?: string | null;
  application_deadline?: string | null;
  timezone?: string | null;
  campus?: string | null;
  max_students?: number | null;
  alliance_seats?: number | null;
  seats_available?: number | null;
  application_url?: string | null;
  source: Record<string, string>;
}

export interface CsvValidationResult<T> {
  errors: CsvIssue[];
  warnings: CsvIssue[];
  /** Totals, including issues beyond `maxIssues`. */
  errorCount: number;
  warningCount: number;
  /** Rows without errors, in file order. Use them only when `errorCount === 0`. */
  normalized: T[];
}

export interface CsvFilesValidation {
  courses?: CsvValidationResult<NormalizedCourseRow> & { parsed: ParsedCsv };
  offerings?: CsvValidationResult<NormalizedOfferingRow> & { parsed: ParsedCsv };
  errorCount: number;
  warningCount: number;
  /** Data rows of both files. */
  rowCount: number;
}

const DEFAULT_MAX_ISSUES = 1_000;
/** Cells starting with these characters are formulas in spreadsheet software. */
const INJECTION_PREFIX = /^[=+\-@\t\r]/;

function issue(
  file: CsvFileKind,
  code: ErrorCode,
  at: { row?: number | undefined; column?: string | undefined } = {},
  detail?: string,
  severity: 'error' | 'warning' = ERROR_CODES[code].severity,
): CsvIssue {
  const base = ERROR_CODES[code].message;
  const out: CsvIssue = { code, severity, file, message: detail ? `${base}: ${detail}` : base };
  if (at.row !== undefined) out.row = at.row;
  if (at.column !== undefined) out.column = at.column;
  return out;
}

// ---------------------------------------------------------------------------
// Decoding and parsing
// ---------------------------------------------------------------------------

/** Strict UTF-8 decoding (BOM removed); invalid bytes give `oecp.csv.encoding`. */
export function decodeCsvBytes(
  bytes: Uint8Array,
  file: CsvFileKind = 'courses',
): { text: string; errors: CsvIssue[] } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, errors: [] };
  } catch {
    return {
      text: '',
      errors: [issue(file, 'oecp.csv.encoding', {}, 'save the file as "CSV UTF-8"')],
    };
  }
}

/** Comma, or semicolon when the header line has no comma (Excel in EU locales). */
export function detectCsvSeparator(text: string): CsvSeparator {
  let quoted = false;
  let semicolon = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted) {
      if (ch === ',') return ',';
      if (ch === ';') semicolon = true;
      else if (ch === '\n' || ch === '\r') break;
    }
  }
  return semicolon ? ';' : ',';
}

/**
 * RFC 4180 reader: quoted cells with `""` escapes, separators and line breaks
 * inside quotes, CRLF/LF/CR record ends, optional final line break, BOM stripped.
 * Lenient where unambiguous (a `"` inside an unquoted cell is literal); strict
 * where data could be lost (unterminated quotes, text after a closing quote, a
 * cell count different from the header). Line breaks inside cells become `\n`.
 */
export function parseCsvText(text: string, options: CsvParseOptions = {}): ParsedCsv {
  const file = options.file ?? 'courses';
  const maxRows = options.maxRows ?? CSV_MAX_ROWS;
  const maxCols = options.maxCols ?? CSV_MAX_COLUMNS;
  const maxCell = options.maxCell ?? CSV_MAX_CELL_LENGTH;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const separator = detectCsvSeparator(src);
  const result: ParsedCsv = { separator, header: [], rows: [], rowNumbers: [], errors: [] };
  const n = src.length;
  let i = 0;
  let recordNo = 0;
  let dataRows = 0;

  const readRecord = (): string[] => {
    const fields: string[] = [];
    for (;;) {
      let value: string;
      if (src[i] === '"') {
        i += 1;
        const parts: string[] = [];
        let closed = false;
        while (i < n) {
          const q = src.indexOf('"', i);
          if (q === -1) {
            parts.push(src.slice(i));
            i = n;
            break;
          }
          parts.push(src.slice(i, q));
          if (src[q + 1] === '"') {
            parts.push('"');
            i = q + 2;
            continue;
          }
          i = q + 1;
          closed = true;
          break;
        }
        value = parts.join('');
        if (!closed) {
          result.errors.push(
            issue(file, 'oecp.csv.malformed', { row: recordNo }, 'a quoted cell is never closed'),
          );
        } else if (i < n && src[i] !== separator && src[i] !== '\n' && src[i] !== '\r') {
          result.errors.push(
            issue(
              file,
              'oecp.csv.malformed',
              { row: recordNo },
              'text after the closing quote of a cell',
            ),
          );
          let j = i;
          while (j < n && src[j] !== separator && src[j] !== '\n' && src[j] !== '\r') j++;
          value += src.slice(i, j);
          i = j;
        }
        value = value.replace(/\r\n?/g, '\n');
      } else {
        let j = i;
        while (j < n && src[j] !== separator && src[j] !== '\n' && src[j] !== '\r') j++;
        value = src.slice(i, j);
        i = j;
      }
      fields.push(value);
      if (i >= n) return fields;
      const ch = src[i];
      i += 1;
      if (ch === separator) {
        if (i >= n) {
          fields.push('');
          return fields;
        }
        continue;
      }
      if (ch === '\r' && src[i] === '\n') i += 1;
      return fields;
    }
  };

  while (i < n) {
    recordNo += 1;
    const fields = readRecord();
    const blank = fields.every((f) => f.trim() === '');

    if (recordNo === 1) {
      if (blank) break;
      if (fields.length > maxCols) {
        result.errors.push(
          issue(file, 'oecp.csv.too_many_columns', { row: 1 }, `${fields.length} columns`),
        );
        return result;
      }
      const seen = new Set<string>();
      fields.forEach((name, index) => {
        if (name.trim() === '') {
          result.errors.push(
            issue(file, 'oecp.csv.unknown_column', { row: 1 }, `column ${index + 1} has no name`),
          );
        } else if (seen.has(name)) {
          result.errors.push(issue(file, 'oecp.csv.duplicate_column', { row: 1, column: name }));
        }
        seen.add(name);
      });
      result.header = fields;
      continue;
    }
    if (blank) continue;

    dataRows += 1;
    if (dataRows > maxRows) {
      result.errors.push(
        issue(file, 'oecp.csv.too_many_rows', { row: recordNo }, `at most ${maxRows} rows`),
      );
      return result;
    }
    if (fields.length !== result.header.length) {
      result.errors.push(
        issue(
          file,
          'oecp.csv.field_count',
          { row: recordNo },
          `${fields.length} cells, header has ${result.header.length}`,
        ),
      );
      continue;
    }
    const entries = result.header.map((name, index): [string, string] => {
      const value = fields[index] ?? '';
      if (value.length > maxCell) {
        result.errors.push(
          issue(
            file,
            'oecp.csv.cell_too_long',
            { row: recordNo, column: name },
            `${value.length} characters`,
          ),
        );
        return [name, value.slice(0, maxCell)];
      }
      return [name, value];
    });
    // fromEntries defines own properties, so a "__proto__" column stays a plain key.
    result.rows.push(Object.fromEntries(entries));
    result.rowNumbers.push(recordNo);
  }

  if (result.header.length === 0) {
    result.errors.push(issue(file, 'oecp.csv.empty_file'));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

class Collector {
  readonly errors: CsvIssue[] = [];
  readonly warnings: CsvIssue[] = [];
  errorCount = 0;
  warningCount = 0;

  constructor(private readonly max: number) {}

  add(found: CsvIssue): void {
    if (found.severity === 'error') {
      this.errorCount += 1;
      if (this.errors.length < this.max) this.errors.push(found);
    } else {
      this.warningCount += 1;
      if (this.warnings.length < this.max) this.warnings.push(found);
    }
  }
}

const MULTI_VALUE_COLUMNS = new Set(['isced_codes', 'teaching_languages', 'delivery_modes']);
const HEADER_CODES = new Set<ErrorCode>(['oecp.csv.missing_column', 'oecp.csv.unknown_column']);

/** Trims every cell; multi-value cells also lose the spaces around `|`. */
function normalizeCells(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(row)) {
    const value = typeof raw === 'string' ? raw.trim() : String(raw ?? '');
    Object.defineProperty(out, key, {
      value: MULTI_VALUE_COLUMNS.has(key) ? value.replace(/\s*\|\s*/g, '|') : value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

const toSet = (values: Iterable<string> | undefined): ReadonlySet<string> | null =>
  values === undefined ? null : new Set(values);

/** `undefined` when the column is absent, `null` when empty, else the mapped value. */
function optional<T>(
  row: Record<string, string>,
  column: string,
  map: (v: string) => T,
): T | null | undefined {
  if (!Object.hasOwn(row, column)) return undefined;
  const value = row[column] ?? '';
  return value === '' ? null : map(value);
}

const identity = (v: string) => v;

function schemaIssues(
  file: CsvFileKind,
  row: number,
  error: z.ZodError,
  headerReported: ReadonlySet<string>,
): CsvIssue[] {
  return issuesToProblemErrors(error.issues, { file, row })
    .filter((e) => !(HEADER_CODES.has(e.code as ErrorCode) && headerReported.has(e.column ?? '')))
    .map((e) => {
      const out: CsvIssue = {
        code: e.code as ErrorCode,
        severity: e.severity,
        file,
        row,
        message: e.message,
      };
      if (e.column !== undefined) out.column = e.column;
      return out;
    });
}

/** Header checks; returns the columns already reported (not repeated per row). */
function checkHeader(
  kind: CsvFileKind,
  header: readonly string[],
  out: Collector,
): { reported: Set<string>; languages: Map<string, Set<CsvCourseTextField>> } {
  const reported = new Set<string>();
  const languages = new Map<string, Set<CsvCourseTextField>>();
  const required: readonly string[] =
    kind === 'courses' ? CSV_COURSE_REQUIRED_COLUMNS : CSV_OFFERING_REQUIRED_COLUMNS;
  const fixed = new Set<string>([
    ...required,
    ...(kind === 'courses' ? CSV_COURSE_OPTIONAL_COLUMNS : CSV_OFFERING_OPTIONAL_COLUMNS),
  ]);
  const present = new Set(header);
  for (const column of required) {
    if (!present.has(column)) {
      out.add(issue(kind, 'oecp.csv.missing_column', { row: 1, column }));
      reported.add(column);
    }
  }
  for (const column of header) {
    if (column.trim() === '') continue; // reported by the parser
    const match = kind === 'courses' ? CSV_COURSE_LANGUAGE_COLUMN.exec(column) : null;
    if (match) {
      const lang = match[2] as string;
      const fields = languages.get(lang) ?? new Set<CsvCourseTextField>();
      fields.add(match[1] as CsvCourseTextField);
      languages.set(lang, fields);
    } else if (!fixed.has(column)) {
      out.add(issue(kind, 'oecp.csv.unknown_column', { row: 1, column }));
      reported.add(column);
    }
  }
  for (const [lang, fields] of languages) {
    if (lang !== 'en' && !fields.has('title')) {
      const column = `title_${lang}`;
      out.add(
        issue(
          kind,
          'oecp.csv.missing_column',
          { row: 1, column },
          `required because other _${lang} columns are present`,
        ),
      );
      reported.add(column);
    }
  }
  return { reported, languages };
}

function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every((v) => typeof v !== 'string' || v.trim() === '');
}

/**
 * Validates parsed rows of one file with the shared Zod row schemas plus header,
 * cross-row (duplicate keys) and reference checks. Never throws.
 */
export function validateCsvRows(
  kind: 'courses',
  rows: readonly Record<string, string>[],
  options?: CsvValidateOptions,
): CsvValidationResult<NormalizedCourseRow>;
export function validateCsvRows(
  kind: 'offerings',
  rows: readonly Record<string, string>[],
  options?: CsvValidateOptions,
): CsvValidationResult<NormalizedOfferingRow>;
export function validateCsvRows(
  kind: CsvFileKind,
  rows: readonly Record<string, string>[],
  options: CsvValidateOptions = {},
): CsvValidationResult<NormalizedCourseRow | NormalizedOfferingRow> {
  const out = new Collector(options.maxIssues ?? DEFAULT_MAX_ISSUES);
  const header = options.header ?? Object.keys(rows[0] ?? {});
  const { reported, languages } = checkHeader(kind, header, out);
  if (rows.length === 0 && header.length > 0) {
    out.add(issue(kind, 'oecp.csv.no_data_rows', { row: 1 }));
  }
  const ref = options.referenceData ?? {};
  const normalized =
    kind === 'courses'
      ? validateCourses(rows, options, out, reported, languages, {
          isced: toSet(ref.iscedCodes),
          units: toSet(ref.teachingUnitCodes),
        })
      : validateOfferings(rows, options, out, reported, {
          modes: toSet(ref.deliveryModes),
          languages: toSet(ref.languageTags),
          courses: toSet(ref.courseCodes),
        });
  return {
    errors: out.errors,
    warnings: out.warnings,
    errorCount: out.errorCount,
    warningCount: out.warningCount,
    normalized,
  };
}

function validateCourses(
  rows: readonly Record<string, string>[],
  options: CsvValidateOptions,
  out: Collector,
  reported: ReadonlySet<string>,
  languages: ReadonlyMap<string, ReadonlySet<CsvCourseTextField>>,
  ref: { isced: ReadonlySet<string> | null; units: ReadonlySet<string> | null },
): NormalizedCourseRow[] {
  const file = 'courses';
  const seen = new Map<string, number>();
  const normalized: NormalizedCourseRow[] = [];
  rows.forEach((source, index) => {
    if (isBlankRow(source)) return;
    const row = options.rowNumbers?.[index] ?? index + 2;
    const cells = normalizeCells(source);
    const before = out.errorCount;

    const code = cells['course_code'] ?? '';
    if (code !== '') {
      const first = seen.get(code);
      if (first !== undefined) {
        out.add(
          issue(file, 'oecp.csv.duplicate_row', { row, column: 'course_code' }, `see row ${first}`),
        );
      } else {
        seen.set(code, row);
      }
    }

    const parsed = csvCourseRow.safeParse(cells);
    if (!parsed.success) {
      for (const found of schemaIssues(file, row, parsed.error, reported)) out.add(found);
      return;
    }
    const v = parsed.data;
    const isced = splitMultiValue(v.isced_codes);
    if (ref.isced) {
      for (const c of isced) {
        if (!ref.isced.has(c.slice(0, 2)) && !ref.isced.has(c)) {
          out.add(
            issue(file, 'oecp.content.unknown_isced_field', { row, column: 'isced_codes' }, c),
          );
        }
      }
    }
    const unit = optional(cells, 'teaching_unit_code', identity);
    if (unit && ref.units && !ref.units.has(unit)) {
      out.add(
        issue(
          file,
          'oecp.content.unknown_teaching_unit',
          { row, column: 'teaching_unit_code' },
          unit,
        ),
      );
    }

    const texts: Record<string, NormalizedCourseText> = {};
    const deleted: string[] = [];
    for (const [lang, fields] of languages) {
      if (!fields.has('title')) continue; // reported in the header
      const text: NormalizedCourseText = {};
      let any = false;
      for (const field of fields) {
        const value = cells[`${field}_${lang}`] ?? '';
        if (value !== '') any = true;
        if (field === 'keywords') {
          text.keywords = value === '' ? null : splitMultiValue(value);
        } else {
          text[field] = value === '' ? null : value;
        }
      }
      if (!any) {
        if (lang !== 'en') {
          deleted.push(lang);
          out.add(issue(file, 'oecp.csv.language_deleted', { row, column: `title_${lang}` }, lang));
        }
        continue;
      }
      if (!text.title) {
        out.add(issue(file, 'oecp.csv.text_without_title', { row, column: `title_${lang}` }, lang));
        continue;
      }
      texts[lang] = text;
    }

    if (out.errorCount > before) return;
    normalized.push({
      row,
      course_code: v.course_code,
      status: v.status as LifecycleStatus,
      ects: Number(v.ects),
      isced_codes: isced,
      level: optional(cells, 'level', (x) => x as CourseLevel),
      eqf_level: optional(cells, 'eqf_level', Number),
      teaching_hours: optional(cells, 'teaching_hours', Number),
      teaching_unit_code: unit,
      info_url: optional(cells, 'info_url', identity),
      contact_email: optional(cells, 'contact_email', identity),
      texts,
      deleted_languages: deleted,
      source,
    });
  });
  return normalized;
}

function validateOfferings(
  rows: readonly Record<string, string>[],
  options: CsvValidateOptions,
  out: Collector,
  reported: ReadonlySet<string>,
  ref: {
    modes: ReadonlySet<string> | null;
    languages: ReadonlySet<string> | null;
    courses: ReadonlySet<string> | null;
  },
): NormalizedOfferingRow[] {
  const file = 'offerings';
  const seen = new Map<string, number>();
  const normalized: NormalizedOfferingRow[] = [];
  rows.forEach((source, index) => {
    if (isBlankRow(source)) return;
    const row = options.rowNumbers?.[index] ?? index + 2;
    const cells = normalizeCells(source);
    const before = out.errorCount;

    const courseCode = cells['course_code'] ?? '';
    const offeringCode = cells['offering_code'] ?? '';
    if (courseCode !== '' && offeringCode !== '') {
      const key = `${courseCode}\u0000${offeringCode}`;
      const first = seen.get(key);
      if (first !== undefined) {
        out.add(
          issue(
            file,
            'oecp.csv.duplicate_row',
            { row, column: 'offering_code' },
            `see row ${first}`,
          ),
        );
      } else {
        seen.set(key, row);
      }
    }

    const parsed = csvOfferingRow.safeParse(cells);
    if (!parsed.success) {
      for (const found of schemaIssues(file, row, parsed.error, reported)) out.add(found);
      return;
    }
    const v = parsed.data;
    if (ref.courses && !ref.courses.has(v.course_code)) {
      out.add(
        issue(file, 'oecp.content.unknown_course', { row, column: 'course_code' }, v.course_code),
      );
    }
    const languages = [...new Set(splitMultiValue(v.teaching_languages))];
    if (ref.languages) {
      for (const tag of languages) {
        if (!ref.languages.has(tag.split('-')[0] ?? tag)) {
          out.add(
            issue(file, 'oecp.csv.invalid_language', { row, column: 'teaching_languages' }, tag),
          );
        }
      }
    }
    const modes = [...new Set(splitMultiValue(v.delivery_modes))];
    if (ref.modes) {
      for (const mode of modes) {
        if (!ref.modes.has(mode)) {
          out.add(
            issue(
              file,
              'oecp.content.unknown_delivery_mode',
              { row, column: 'delivery_modes' },
              mode,
            ),
          );
        }
      }
    }

    if (out.errorCount > before) return;
    normalized.push({
      row,
      course_code: v.course_code,
      offering_code: v.offering_code,
      status: v.status as LifecycleStatus,
      start_date: v.start_date,
      end_date: v.end_date,
      teaching_languages: languages,
      delivery_modes: modes,
      academic_session_code: optional(cells, 'academic_session_code', identity),
      enrol_start_date: optional(cells, 'enrol_start_date', identity),
      application_deadline: optional(cells, 'application_deadline', identity),
      timezone: optional(cells, 'timezone', identity),
      campus: optional(cells, 'campus', identity),
      max_students: optional(cells, 'max_students', Number),
      alliance_seats: optional(cells, 'alliance_seats', Number),
      seats_available: optional(cells, 'seats_available', Number),
      application_url: optional(cells, 'application_url', identity),
      source,
    });
  });
  return normalized;
}

/** {@link parseCsvText} then {@link validateCsvRows}; parse errors come first. */
export function validateCsvText(
  kind: 'courses',
  text: string,
  options?: Omit<CsvValidateOptions, 'header' | 'rowNumbers'> & { limits?: CsvParseOptions },
): CsvValidationResult<NormalizedCourseRow> & { parsed: ParsedCsv };
export function validateCsvText(
  kind: 'offerings',
  text: string,
  options?: Omit<CsvValidateOptions, 'header' | 'rowNumbers'> & { limits?: CsvParseOptions },
): CsvValidationResult<NormalizedOfferingRow> & { parsed: ParsedCsv };
export function validateCsvText(
  kind: CsvFileKind,
  text: string,
  options: Omit<CsvValidateOptions, 'header' | 'rowNumbers'> & { limits?: CsvParseOptions } = {},
): CsvValidationResult<NormalizedCourseRow | NormalizedOfferingRow> & { parsed: ParsedCsv } {
  const { limits, ...rest } = options;
  const parsed = parseCsvText(text, { ...limits, file: kind });
  if (
    parsed.header.length === 0 ||
    parsed.errors.some((e) => e.code === 'oecp.csv.too_many_columns')
  ) {
    return {
      errors: parsed.errors,
      warnings: [],
      errorCount: parsed.errors.length,
      warningCount: 0,
      normalized: [],
      parsed,
    };
  }
  const result =
    kind === 'courses'
      ? validateCsvRows('courses', parsed.rows, {
          ...rest,
          header: parsed.header,
          rowNumbers: parsed.rowNumbers,
        })
      : validateCsvRows('offerings', parsed.rows, {
          ...rest,
          header: parsed.header,
          rowNumbers: parsed.rowNumbers,
        });
  const max = rest.maxIssues ?? DEFAULT_MAX_ISSUES;
  return {
    ...result,
    errors: [...parsed.errors, ...result.errors].slice(0, max),
    errorCount: parsed.errors.length + result.errorCount,
    parsed,
  };
}

/**
 * Validates an upload as the server does: `courses.csv` first, then
 * `offerings.csv`, whose `course_code` may name a course of the catalogue
 * (`referenceData.courseCodes`) or of the courses file.
 */
export function validateCsvFiles(
  files: { courses?: string | undefined; offerings?: string | undefined },
  options: Omit<CsvValidateOptions, 'header' | 'rowNumbers'> & { limits?: CsvParseOptions } = {},
): CsvFilesValidation {
  const out: CsvFilesValidation = { errorCount: 0, warningCount: 0, rowCount: 0 };
  if (files.courses !== undefined) {
    out.courses = validateCsvText('courses', files.courses, options);
  }
  if (files.offerings !== undefined) {
    let referenceData = options.referenceData;
    if (referenceData?.courseCodes !== undefined) {
      const codes = new Set(referenceData.courseCodes);
      for (const row of out.courses?.parsed.rows ?? []) {
        const code = row['course_code']?.trim();
        if (code) codes.add(code);
      }
      referenceData = { ...referenceData, courseCodes: codes };
    }
    out.offerings = validateCsvText('offerings', files.offerings, {
      ...options,
      ...(referenceData ? { referenceData } : {}),
    });
  }
  for (const result of [out.courses, out.offerings]) {
    if (!result) continue;
    out.errorCount += result.errorCount;
    out.warningCount += result.warningCount;
    out.rowCount += result.parsed.rows.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generation (templates, error reports): CSV-injection safe
// ---------------------------------------------------------------------------

/**
 * Spec §6.3 "CSV injection": every CSV OECP generates prefixes cells starting
 * with `=`, `+`, `-`, `@`, TAB or CR with `'`. Stored values stay verbatim.
 */
export function neutralizeCsvCell(value: string): string {
  return INJECTION_PREFIX.test(value) ? `'${value}` : value;
}

/** RFC 4180 output (CRLF), injection-neutralised; optional UTF-8 BOM for spreadsheet software. */
export function formatCsv(
  rows: readonly (readonly string[])[],
  options: { separator?: CsvSeparator; bom?: boolean } = {},
): string {
  const separator = options.separator ?? ',';
  const quote = (raw: string): string => {
    const value = neutralizeCsvCell(raw);
    return /["\r\n]/.test(value) || value.includes(separator)
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  };
  const body = rows.map((row) => row.map(quote).join(separator)).join('\r\n') + '\r\n';
  return options.bom ? `\uFEFF${body}` : body;
}

/** Header and one example row of each template 1.0 file. */
export const CSV_TEMPLATE_EXAMPLES: Readonly<
  Record<CsvFileKind, Readonly<Record<string, string>>>
> = {
  courses: {
    template_version: '1.0',
    course_code: 'AUR-SUST-101',
    status: 'draft',
    ects: '5',
    isced_codes: '0521|0312',
    title_en: 'Sustainability and Society',
    level: 'bachelor',
    eqf_level: '6',
    teaching_hours: '30',
    teaching_unit_code: '',
    info_url: 'https://www.example.org/courses/aur-sust-101',
    contact_email: 'courses@example.org',
    abstract_en: 'An interdisciplinary introduction to sustainability challenges.',
    description_en: 'Weekly online seminars combine lectures, case studies and group work.',
    learning_outcomes_en: 'Explain the main sustainability frameworks.',
    prerequisites_en: 'None.',
    assessment_en: 'Group project and final essay.',
    keywords_en: 'sustainability|climate|society',
  },
  offerings: {
    template_version: '1.0',
    course_code: 'AUR-SUST-101',
    offering_code: '2027S',
    status: 'draft',
    start_date: '2027-02-15',
    end_date: '2027-06-15',
    teaching_languages: 'en',
    delivery_modes: 'online|hybrid',
    academic_session_code: '2026-27-S2',
    enrol_start_date: '2026-11-02',
    application_deadline: '2027-01-15',
    timezone: 'Europe/Brussels',
    campus: '',
    max_students: '30',
    alliance_seats: '10',
    seats_available: '',
    application_url: 'https://www.example.org/apply/aur-sust-101',
  },
};

/** The template file (`courses.csv` or `offerings.csv`): header plus example row, with BOM. */
export function csvTemplate(kind: CsvFileKind): string {
  const example = CSV_TEMPLATE_EXAMPLES[kind];
  return formatCsv([Object.keys(example), Object.values(example)], { bom: true });
}

/** Downloadable error report of the CSV console (spec §8.1), injection-safe. */
export function csvIssuesReport(issues: readonly CsvIssue[]): string {
  return formatCsv(
    [
      ['file', 'row', 'column', 'severity', 'code', 'message'],
      ...issues.map((i) => [
        i.file,
        i.row === undefined ? '' : String(i.row),
        i.column ?? '',
        i.severity,
        i.code,
        i.message,
      ]),
    ],
    { bom: true },
  );
}
