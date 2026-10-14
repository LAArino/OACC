// SPDX-License-Identifier: EUPL-1.2
// CSV console logic (utils/csvConsole.ts) with the real shared validator of
// @oecp/schemas, the Web Worker protocol and the main-thread fallback.
import { CSV_MAX_FILE_BYTES } from '@oecp/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adminIssuesReport,
  detectCsvKind,
  fileTooLargeIssue,
  isFileTooLarge,
  issuesFromProblemErrors,
  issuesFromSyncErrors,
  kindFromFileName,
  readCsvHeader,
  runCsvValidation,
} from '../app/utils/csvConsole';
import { csv, fixtures } from './helpers/admin';

const bytes = (text: string) => new TextEncoder().encode(text);
const reference = {
  iscedCodes: fixtures.reference.isced_broad_fields.map((f) => f.code),
  deliveryModes: fixtures.reference.delivery_modes.map((m) => m.code),
};

describe('file kind detection', () => {
  it('reads the kind from the header columns', () => {
    expect(detectCsvKind(['template_version', 'course_code', 'title_en'])).toBe('courses');
    expect(detectCsvKind(['course_code', 'offering_code', 'status'])).toBe('offerings');
    expect(detectCsvKind([' Offering_Code '])).toBe('offerings');
    expect(detectCsvKind(['course_code', 'status'])).toBeNull();
    expect(detectCsvKind([])).toBeNull();
  });

  it('falls back on the template file names', () => {
    expect(kindFromFileName('courses.csv')).toBe('courses');
    expect(kindFromFileName('OFFERINGS.CSV')).toBe('offerings');
    expect(kindFromFileName('export (1).csv')).toBeNull();
  });

  it('reads the header of a file prefix: BOM, semicolons, quotes, truncated tail', () => {
    expect(readCsvHeader(bytes(csv.courses))).toEqual([
      'template_version',
      'course_code',
      'status',
      'ects',
      'isced_codes',
      'title_en',
    ]);
    expect(readCsvHeader(bytes('\uFEFF"offering_code";course_code\r\n1;"a\nb'))).toEqual([
      'offering_code',
      'course_code',
    ]);
    // A probe cut in the middle of a multi-byte character after the header.
    const cut = bytes('course_code,title_en\nÉcole').slice(0, 22);
    expect(detectCsvKind(readCsvHeader(cut))).toBe('courses');
  });
});

describe('runCsvValidation', () => {
  it('accepts valid files with the public reference data', () => {
    const summary = runCsvValidation({
      files: { courses: bytes(csv.courses), offerings: bytes(csv.offerings) },
      reference,
    });
    expect(summary).toMatchObject({ rowCount: 2, errorCount: 0, warningCount: 0, issues: [] });
    expect(summary.files).toEqual({
      courses: { rows: 1, errorCount: 0, warningCount: 0 },
      offerings: { rows: 1, errorCount: 0, warningCount: 0 },
    });
  });

  it('reports row and column of each error, reference checks included', () => {
    const summary = runCsvValidation({ files: { courses: bytes(csv.invalidCourses) }, reference });
    expect(summary.errorCount).toBe(2);
    expect(summary.issues).toEqual([
      expect.objectContaining({
        code: 'oecp.csv.invalid_number',
        file: 'courses',
        row: 2,
        column: 'ects',
      }),
      expect.objectContaining({
        code: 'oecp.content.unknown_isced_field',
        file: 'courses',
        row: 3,
        column: 'isced_codes',
      }),
    ]);
  });

  it('skips the reference checks when no reference data is given', () => {
    const summary = runCsvValidation({ files: { courses: bytes(csv.invalidCourses) } });
    expect(summary.issues.map((i) => i.code)).toEqual(['oecp.csv.invalid_number']);
  });

  it('keeps warnings apart from errors', () => {
    const summary = runCsvValidation({
      files: { courses: bytes(csv.courses), offerings: bytes(csv.emptyOfferings) },
      reference,
    });
    expect(summary).toMatchObject({ errorCount: 0, warningCount: 1, rowCount: 1 });
    expect(summary.issues[0]).toMatchObject({ severity: 'warning', file: 'offerings' });
  });

  it('reports invalid UTF-8 as a file-level error', () => {
    const summary = runCsvValidation({
      files: { courses: new Uint8Array([0x63, 0x6f, 0xff, 0xfe, 0x0a]) },
    });
    expect(summary.errorCount).toBe(1);
    expect(summary.issues[0]).toMatchObject({ code: 'oecp.csv.encoding', file: 'courses' });
    expect(summary.issues[0]?.row).toBeUndefined();
  });

  it('flags files above the size limit without reading them', () => {
    expect(isFileTooLarge(CSV_MAX_FILE_BYTES)).toBe(false);
    expect(isFileTooLarge(CSV_MAX_FILE_BYTES + 1)).toBe(true);
    expect(fileTooLargeIssue('offerings')).toMatchObject({
      code: 'oecp.csv.file_too_large',
      severity: 'error',
      file: 'offerings',
    });
  });
});

describe('issue rows and report', () => {
  it('maps 422 errors[] and stored run errors to table rows', () => {
    expect(
      issuesFromProblemErrors([
        {
          code: 'oecp.csv.invalid_date',
          severity: 'error',
          message: 'm',
          file: 'offerings',
          row: 4,
        },
      ]),
    ).toEqual([
      {
        code: 'oecp.csv.invalid_date',
        severity: 'error',
        message: 'm',
        file: 'offerings',
        row: 4,
        column: null,
      },
    ]);
    expect(issuesFromSyncErrors([fixtures.syncError(1)])).toEqual([
      {
        severity: 'error',
        code: 'oecp.csv.invalid_date',
        file: 'offerings',
        row: 2,
        column: 'start_date',
        message: 'Expected YYYY-MM-DD',
      },
    ]);
  });

  it('builds the injection-safe CSV report with csvIssuesReport', () => {
    const report = adminIssuesReport([
      {
        severity: 'error',
        code: 'oecp.csv.invalid_number',
        file: 'courses',
        row: 2,
        column: 'ects',
        message: '=HYPERLINK("x")',
      },
      { severity: 'warning', code: 'oecp.oeapi.something', file: null, message: 'plain' },
    ]);
    const lines = report.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('file,row,column,severity,code,message');
    expect(lines[1]).toBe('courses,2,ects,error,oecp.csv.invalid_number,"\'=HYPERLINK(""x"")"');
    expect(lines[2]).toBe(',,,warning,oecp.oeapi.something,plain');
  });
});

describe('csv-validate worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('answers a request with the validation summary', async () => {
    const posted: unknown[] = [];
    const scope: {
      onmessage: ((event: { data: unknown }) => void) | null;
      postMessage: (m: unknown) => void;
    } = { onmessage: null, postMessage: (m) => posted.push(m) };
    vi.stubGlobal('self', scope);
    await import('../app/workers/csv-validate.worker');
    expect(scope.onmessage).toBeTypeOf('function');
    scope.onmessage?.({ data: { id: 7, input: { files: { courses: bytes(csv.courses) } } } });
    expect(posted).toEqual([
      { id: 7, ok: true, summary: expect.objectContaining({ errorCount: 0, rowCount: 1 }) },
    ]);
  });
});

describe('useCsvValidator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const input = () => ({ files: { courses: bytes(csv.invalidCourses) }, reference });

  it('validates on the main thread when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const { useCsvValidator } = await import('../app/composables/useCsvValidator');
    const summary = await useCsvValidator().validate(input());
    expect(summary.errorCount).toBe(2);
  });

  it('uses a module worker and its answer when available', async () => {
    const created: { url: string; options: unknown }[] = [];
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: { preventDefault(): void }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      constructor(url: URL, options: unknown) {
        created.push({ url: String(url), options });
      }
      postMessage(message: { id: number }) {
        queueMicrotask(() =>
          this.onmessage?.({
            data: { id: message.id, ok: true, summary: { marker: 'from-worker' } },
          }),
        );
      }
      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const { useCsvValidator } = await import('../app/composables/useCsvValidator');
    const summary = await useCsvValidator().validate(input());
    expect(summary).toEqual({ marker: 'from-worker' });
    expect(created).toHaveLength(1);
    expect(created[0]?.url).toContain('csv-validate.worker');
    expect(created[0]?.options).toMatchObject({ type: 'module' });
  });

  it('falls back to the main thread when the worker fails', async () => {
    class BrokenWorker {
      onerror: ((e: { preventDefault(): void }) => void) | null = null;
      onmessage = null;
      onmessageerror = null;
      postMessage() {
        queueMicrotask(() => this.onerror?.({ preventDefault() {} }));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const { useCsvValidator } = await import('../app/composables/useCsvValidator');
    expect((await useCsvValidator().validate(input())).errorCount).toBe(2);

    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('module workers unsupported');
        }
      },
    );
    expect((await useCsvValidator().validate(input())).errorCount).toBe(2);
  });

  it('can be forced onto the main thread', async () => {
    const spy = vi.fn();
    vi.stubGlobal('Worker', spy);
    const { useCsvValidator } = await import('../app/composables/useCsvValidator');
    expect((await useCsvValidator({ worker: false }).validate(input())).errorCount).toBe(2);
    expect(spy).not.toHaveBeenCalled();
  });
});
