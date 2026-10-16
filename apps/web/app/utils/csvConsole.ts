// SPDX-License-Identifier: EUPL-1.2
// CSV console (spec §6.3, §8.1): file-kind detection and the browser-side
// validation run, built on the shared validator of @oecp/schemas. Pure and
// DOM-free so that it runs in the Web Worker (workers/csv-validate.worker.ts)
// and, as a fallback, on the main thread. Nothing here logs file contents.
import {
  CSV_MAX_FILE_BYTES,
  type CsvFileKind,
  type CsvIssue,
  type CsvReferenceData,
  csvIssuesReport,
  decodeCsvBytes,
  ERROR_CODES,
  type ErrorCode,
  parseCsvText,
  type ProblemError,
  type SyncError,
  validateCsvFiles,
} from '@oecp/schemas';

export const CSV_KINDS: readonly CsvFileKind[] = ['courses', 'offerings'];

/** Bytes read to find the header line of a file (headers are far shorter). */
export const CSV_HEADER_PROBE_BYTES = 64 * 1024;

/** One row of an issues table: browser findings, 422 `errors[]` and run errors alike. */
export interface AdminIssue {
  severity: 'error' | 'warning';
  code: string;
  file?: CsvFileKind | null;
  row?: number | null;
  column?: string | null;
  /** Record the finding belongs to (course or offering code), when known: harvest findings have no file or row. */
  entity?: string | null;
  message: string;
}

/** Severity filter of the issues tables. */
export type IssueSeverityFilter = 'all' | 'error' | 'warning';

/** Template 1.0 kind from header columns: `offering_code` → offerings, `course_code` + `title_en` → courses. */
export function detectCsvKind(header: readonly string[]): CsvFileKind | null {
  const columns = new Set(header.map((h) => h.trim().toLowerCase()));
  if (columns.has('offering_code')) return 'offerings';
  if (columns.has('course_code') && columns.has('title_en')) return 'courses';
  return null;
}

/** `courses.csv` / `offerings.csv` (any case); other names give `null`. */
export function kindFromFileName(name: string): CsvFileKind | null {
  const base = name.trim().toLowerCase();
  if (base === 'courses.csv') return 'courses';
  if (base === 'offerings.csv') return 'offerings';
  return null;
}

/** Header names of the first record of a file prefix (lenient decoding, BOM stripped). */
export function readCsvHeader(bytes: Uint8Array): string[] {
  const text = new TextDecoder('utf-8').decode(bytes);
  let quoted = false;
  let end = text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      end = i;
      break;
    }
  }
  return parseCsvText(text.slice(0, end)).header;
}

export interface CsvValidationInput {
  /** File bytes by kind; at most one file per kind. */
  files: Partial<Record<CsvFileKind, Uint8Array>>;
  /** Public reference data (`GET /api/public/v1/reference`); checks run only for lists given. */
  reference?: { iscedCodes?: readonly string[]; deliveryModes?: readonly string[] };
}

export interface CsvFileSummary {
  rows: number;
  errorCount: number;
  warningCount: number;
}

/** Structured-clone-safe result of a validation run (posted back by the worker). */
export interface CsvValidationSummary {
  files: Partial<Record<CsvFileKind, CsvFileSummary>>;
  rowCount: number;
  errorCount: number;
  warningCount: number;
  /** Errors then warnings, courses first; capped per severity by the validator. */
  issues: CsvIssue[];
}

/**
 * Decodes and validates the files as the server will (courses first, then
 * offerings), with the reference data the public API offers. The server
 * always revalidates, with its full reference data (spec §6.3).
 */
export function runCsvValidation(input: CsvValidationInput): CsvValidationSummary {
  const texts: Partial<Record<CsvFileKind, string>> = {};
  const decodeIssues: Partial<Record<CsvFileKind, CsvIssue[]>> = {};
  for (const kind of CSV_KINDS) {
    const bytes = input.files[kind];
    if (!bytes) continue;
    const decoded = decodeCsvBytes(bytes, kind);
    if (decoded.errors.length > 0) decodeIssues[kind] = decoded.errors;
    else texts[kind] = decoded.text;
  }

  const referenceData: CsvReferenceData = {};
  if (input.reference?.iscedCodes?.length) referenceData.iscedCodes = input.reference.iscedCodes;
  if (input.reference?.deliveryModes?.length) {
    referenceData.deliveryModes = input.reference.deliveryModes;
  }
  const validation = validateCsvFiles(
    texts,
    Object.keys(referenceData).length > 0 ? { referenceData } : {},
  );

  const summary: CsvValidationSummary = {
    files: {},
    rowCount: 0,
    errorCount: 0,
    warningCount: 0,
    issues: [],
  };
  const errors: CsvIssue[] = [];
  const warnings: CsvIssue[] = [];
  for (const kind of CSV_KINDS) {
    const failed = decodeIssues[kind];
    const result = validation[kind];
    if (failed) {
      summary.files[kind] = { rows: 0, errorCount: failed.length, warningCount: 0 };
      errors.push(...failed);
    } else if (result) {
      summary.files[kind] = {
        rows: result.parsed.rows.length,
        errorCount: result.errorCount,
        warningCount: result.warningCount,
      };
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const file = summary.files[kind];
    if (file) {
      summary.rowCount += file.rows;
      summary.errorCount += file.errorCount;
      summary.warningCount += file.warningCount;
    }
  }
  summary.issues = [...errors, ...warnings];
  return summary;
}

/** The finding reported for a file above CSV_MAX_FILE_BYTES (it is not read). */
export function fileTooLargeIssue(kind: CsvFileKind): CsvIssue {
  return {
    code: 'oecp.csv.file_too_large',
    severity: 'error',
    file: kind,
    message: ERROR_CODES['oecp.csv.file_too_large'].message,
  };
}

export function isFileTooLarge(size: number): boolean {
  return size > CSV_MAX_FILE_BYTES;
}

/** 422 `errors[]` (problem+json) as table rows. */
export function issuesFromProblemErrors(errors: readonly ProblemError[] | undefined): AdminIssue[] {
  return (errors ?? []).map((e) => ({
    severity: e.severity,
    code: e.code,
    file: e.file ?? null,
    row: e.row ?? null,
    column: e.column ?? null,
    message: e.message,
  }));
}

/** Stored run errors (`GET /sync-runs/{id}`) as table rows. */
export function issuesFromSyncErrors(errors: readonly SyncError[]): AdminIssue[] {
  return errors.map((e) => ({
    severity: e.severity,
    code: e.code,
    file: e.file,
    row: e.row_number,
    column: e.column_name ?? e.json_pointer,
    entity: e.ext_id,
    message: e.message,
  }));
}

/** Injection-safe CSV report of table rows (spec §6.3), via the shared `csvIssuesReport`. */
export function adminIssuesReport(issues: readonly AdminIssue[]): string {
  return csvIssuesReport(
    issues.map((i) => {
      const issue: CsvIssue = {
        code: i.code as ErrorCode,
        severity: i.severity,
        // Run-level findings have no file; the report leaves the cell empty.
        file: (i.file ?? '') as CsvFileKind,
        message: i.message,
      };
      if (typeof i.row === 'number') issue.row = i.row;
      if (i.column) issue.column = i.column;
      return issue;
    }),
  );
}
