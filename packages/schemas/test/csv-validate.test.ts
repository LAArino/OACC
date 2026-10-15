// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  CSV_COURSE_OPTIONAL_COLUMNS,
  CSV_COURSE_REQUIRED_COLUMNS,
  CSV_OFFERING_OPTIONAL_COLUMNS,
  CSV_OFFERING_REQUIRED_COLUMNS,
  CSV_TEMPLATE_EXAMPLES,
  csvCourseRow,
  csvIssuesReport,
  csvOfferingRow,
  csvTemplate,
  decodeCsvBytes,
  detectCsvSeparator,
  formatCsv,
  neutralizeCsvCell,
  parseCsvText,
  validateCsvFiles,
  validateCsvRows,
  validateCsvText,
} from '../src/index.js';

const COURSE_HEADER = 'template_version,course_code,status,ects,isced_codes,title_en';
const OFFERING_HEADER =
  'template_version,course_code,offering_code,status,start_date,end_date,teaching_languages,delivery_modes';

const REFERENCE = {
  iscedCodes: ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '99'],
  deliveryModes: ['presential', 'online', 'hybrid', 'blended', 'coil', 'joint_delivery'],
  courseCodes: ['EXISTING-1'],
  teachingUnitCodes: ['FAC-SCI'],
};

describe('parseCsvText', () => {
  it('reads quoted separators, escaped quotes and embedded line breaks', () => {
    const text = 'a,b,c\r\n"x, y","he said ""hi""","line 1\r\nline 2"\r\n' + 'plain,"",last\r\n';
    const parsed = parseCsvText(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.separator).toBe(',');
    expect(parsed.header).toEqual(['a', 'b', 'c']);
    expect(parsed.rows).toEqual([
      { a: 'x, y', b: 'he said "hi"', c: 'line 1\nline 2' },
      { a: 'plain', b: '', c: 'last' },
    ]);
    // The quoted line break does not shift row numbers: records, not lines.
    expect(parsed.rowNumbers).toEqual([2, 3]);
  });

  it('strips the BOM and accepts LF, CRLF, CR and a missing final line break', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const parsed = parseCsvText(`\uFEFFa,b${eol}1,2${eol}3,4`);
      expect(parsed.header).toEqual(['a', 'b']);
      expect(parsed.rows).toEqual([
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ]);
      expect(parsed.errors).toEqual([]);
    }
  });

  it('detects semicolons only when the header line has no comma', () => {
    expect(detectCsvSeparator('a;b;c\n1,5;2;3')).toBe(';');
    expect(detectCsvSeparator('a,b;c\n')).toBe(',');
    expect(detectCsvSeparator('"x;y";b\n')).toBe(';');
    expect(detectCsvSeparator('"a,b";c\n')).toBe(';');
    expect(detectCsvSeparator('single\n')).toBe(',');
    const parsed = parseCsvText('a;b\n"1;5";2,5\n');
    expect(parsed.separator).toBe(';');
    expect(parsed.rows).toEqual([{ a: '1;5', b: '2,5' }]);
  });

  it('distinguishes empty cells from short rows', () => {
    const parsed = parseCsvText('a,b,c\n1,,\n1,2\n,,\n');
    expect(parsed.rows).toEqual([{ a: '1', b: '', c: '' }]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({ code: 'oecp.csv.field_count', row: 3 }),
    ]);
    // The blank record (row 4) is skipped silently.
    expect(parsed.rowNumbers).toEqual([2]);
  });

  it('reports malformed quoting with the row number', () => {
    expect(parseCsvText('a,b\n"open,1\n2,3\n').errors[0]).toMatchObject({
      code: 'oecp.csv.malformed',
      row: 2,
    });
    expect(parseCsvText('a,b\n"x"y,1\n').errors[0]).toMatchObject({
      code: 'oecp.csv.malformed',
      row: 2,
    });
    // A quote inside an unquoted cell is literal.
    expect(parseCsvText('a,b\n5" screen,1\n').rows).toEqual([{ a: '5" screen', b: '1' }]);
  });

  it('keeps a trailing empty cell after a final separator', () => {
    expect(parseCsvText('a,b\n1,').rows).toEqual([{ a: '1', b: '' }]);
  });

  it('enforces rows, columns and cell limits', () => {
    expect(parseCsvText('a\n1\n2\n3\n', { maxRows: 2 }).errors).toEqual([
      expect.objectContaining({ code: 'oecp.csv.too_many_rows', row: 4 }),
    ]);
    expect(parseCsvText('a,b,c\n', { maxCols: 2 }).errors[0]?.code).toBe(
      'oecp.csv.too_many_columns',
    );
    const long = parseCsvText('a\nabcdef\n', { maxCell: 3 });
    expect(long.errors[0]).toMatchObject({ code: 'oecp.csv.cell_too_long', row: 2, column: 'a' });
    expect(long.rows).toEqual([{ a: 'abc' }]);
  });

  it('reports empty files, duplicate and nameless header columns', () => {
    expect(parseCsvText('').errors[0]?.code).toBe('oecp.csv.empty_file');
    expect(parseCsvText('\n\n').errors[0]?.code).toBe('oecp.csv.empty_file');
    const codes = parseCsvText('a,a,\n1,2,3\n').errors.map((e) => e.code);
    expect(codes).toEqual(['oecp.csv.duplicate_column', 'oecp.csv.unknown_column']);
  });

  it('treats a "__proto__" column as data', () => {
    const parsed = parseCsvText('__proto__\nx\n');
    expect(Object.getPrototypeOf(parsed.rows[0])).toBe(Object.prototype);
    expect(Object.keys(parsed.rows[0] ?? {})).toEqual(['__proto__']);
  });
});

describe('decodeCsvBytes', () => {
  it('decodes UTF-8 and strips the BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('título')]);
    expect(decodeCsvBytes(bytes)).toEqual({ text: 'título', errors: [] });
  });

  it('refuses Latin-1', () => {
    const result = decodeCsvBytes(new Uint8Array([0x74, 0xed, 0x74]), 'offerings');
    expect(result.errors[0]).toMatchObject({ code: 'oecp.csv.encoding', file: 'offerings' });
  });
});

describe('validateCsvRows: courses', () => {
  const row = {
    template_version: '1.0',
    course_code: 'C-1',
    status: 'published',
    ects: '7.5',
    isced_codes: '0613 | 0611',
    title_en: '  Machine learning ',
  };

  it('normalizes a valid row; absent columns are undefined, empty cells null', () => {
    const result = validateCsvRows('courses', [{ ...row, level: '', abstract_en: 'Intro' }], {
      referenceData: REFERENCE,
    });
    expect(result.errors).toEqual([]);
    expect(result.normalized[0]).toMatchObject({
      row: 2,
      course_code: 'C-1',
      ects: 7.5,
      isced_codes: ['0613', '0611'],
      level: null,
      texts: { en: { title: 'Machine learning', abstract: 'Intro' } },
      deleted_languages: [],
    });
    expect(result.normalized[0]?.info_url).toBeUndefined();
  });

  it('reports header problems once, at row 1', () => {
    const { title_en: _t, ...rest } = row;
    const rows = [
      { ...rest, credits: '6' },
      { ...rest, course_code: 'C-2', credits: '6' },
    ];
    const result = validateCsvRows('courses', rows);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'oecp.csv.missing_column', row: 1, column: 'title_en' }),
      expect.objectContaining({ code: 'oecp.csv.unknown_column', row: 1, column: 'credits' }),
    ]);
  });

  it('requires title_<lang> when other columns of that language are present', () => {
    const result = validateCsvRows('courses', [{ ...row, abstract_de: 'Einführung' }]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'oecp.csv.missing_column', column: 'title_de', row: 1 }),
    ]);
  });

  it('deletes a language whose cells are all empty and refuses texts without a title', () => {
    const result = validateCsvRows('courses', [
      { ...row, title_de: '', abstract_de: '' },
      { ...row, course_code: 'C-2', title_de: '', abstract_de: 'Nur Text' },
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'oecp.csv.language_deleted', row: 2, column: 'title_de' }),
    ]);
    expect(result.normalized[0]?.deleted_languages).toEqual(['de']);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'oecp.csv.text_without_title', row: 3, column: 'title_de' }),
    ]);
  });

  it('checks duplicates, ISCED fields and teaching units', () => {
    const result = validateCsvRows(
      'courses',
      [
        { ...row, teaching_unit_code: 'FAC-SCI' },
        { ...row, isced_codes: '0613|1234|0613', teaching_unit_code: 'NOPE' },
      ],
      { referenceData: REFERENCE },
    );
    expect(result.errors.map((e) => [e.code, e.row, e.column])).toEqual([
      ['oecp.csv.duplicate_row', 3, 'course_code'],
      ['oecp.content.duplicate_isced', 3, 'isced_codes'],
    ]);
    const second = validateCsvRows(
      'courses',
      [{ ...row, isced_codes: '1234', teaching_unit_code: 'NOPE' }],
      { referenceData: REFERENCE },
    );
    expect(second.errors.map((e) => e.code)).toEqual([
      'oecp.content.unknown_isced_field',
      'oecp.content.unknown_teaching_unit',
    ]);
  });

  it('maps value errors to stable codes', () => {
    const cases: [Record<string, string>, string, string][] = [
      [{ template_version: '2.0' }, 'oecp.csv.invalid_template_version', 'template_version'],
      [{ status: 'live' }, 'oecp.csv.invalid_status', 'status'],
      [{ ects: '7,5' }, 'oecp.csv.invalid_number', 'ects'],
      [{ ects: '0' }, 'oecp.csv.invalid_number', 'ects'],
      [{ title_en: '' }, 'oecp.csv.missing_value', 'title_en'],
      // Too long is a value error, not a missing English title.
      [{ title_en: 'x'.repeat(501) }, 'oecp.content.invalid_value', 'title_en'],
      [{ info_url: 'http://x.org' }, 'oecp.csv.invalid_url', 'info_url'],
      [{ contact_email: 'nobody' }, 'oecp.csv.invalid_email', 'contact_email'],
      [{ course_code: '-bad' }, 'oecp.csv.invalid_code', 'course_code'],
      [{ isced_codes: 'x' }, 'oecp.csv.invalid_isced', 'isced_codes'],
      [{ abstract_en: 'x'.repeat(20_001) }, 'oecp.csv.cell_too_long', 'abstract_en'],
    ];
    for (const [patch, code, column] of cases) {
      const result = validateCsvRows('courses', [{ ...row, ...patch }]);
      expect(result.errors[0], code).toMatchObject({ code, column, row: 2, file: 'courses' });
    }
  });

  it('caps the issue lists but keeps exact counts', () => {
    const rows = Array.from({ length: 5 }, () => ({ ...row, status: 'bad' }));
    const result = validateCsvRows('courses', rows, { maxIssues: 2 });
    expect(result.errors).toHaveLength(2);
    expect(result.errorCount).toBe(9); // 5 invalid statuses + 4 duplicates
  });
});

describe('validateCsvRows: offerings', () => {
  const row = {
    template_version: '1.0',
    course_code: 'EXISTING-1',
    offering_code: '2027S',
    status: 'published',
    start_date: '2027-02-01',
    end_date: '2027-06-30',
    teaching_languages: 'en|es-ES',
    delivery_modes: 'online | hybrid',
  };

  it('normalizes multi-values and optional columns', () => {
    const result = validateCsvRows(
      'offerings',
      [{ ...row, max_students: '30', seats_available: '', timezone: 'Europe/Madrid' }],
      { referenceData: REFERENCE },
    );
    expect(result.errors).toEqual([]);
    expect(result.normalized[0]).toMatchObject({
      teaching_languages: ['en', 'es-ES'],
      delivery_modes: ['online', 'hybrid'],
      max_students: 30,
      seats_available: null,
      timezone: 'Europe/Madrid',
    });
    expect(result.normalized[0]?.campus).toBeUndefined();
  });

  it('checks DDL constraints row by row', () => {
    const cases: [Record<string, string>, string, string][] = [
      [{ start_date: '2027-02-30' }, 'oecp.csv.invalid_date', 'start_date'],
      [{ start_date: '01/02/2027' }, 'oecp.csv.invalid_date', 'start_date'],
      [{ end_date: '2027-01-01' }, 'oecp.content.date_order', 'end_date'],
      [{ application_deadline: '2027-07-01' }, 'oecp.content.date_order', 'application_deadline'],
      [
        { enrol_start_date: '2027-01-20', application_deadline: '2027-01-10' },
        'oecp.content.date_order',
        'enrol_start_date',
      ],
      [
        { max_students: '10', seats_available: '11' },
        'oecp.content.seats_exceed_capacity',
        'seats_available',
      ],
      [
        { max_students: '10', alliance_seats: '11' },
        'oecp.content.seats_exceed_capacity',
        'alliance_seats',
      ],
      [{ max_students: '0' }, 'oecp.csv.invalid_number', 'max_students'],
      [{ timezone: 'Mars/Olympus' }, 'oecp.csv.invalid_timezone', 'timezone'],
      [{ teaching_languages: 'EN' }, 'oecp.csv.invalid_language', 'teaching_languages'],
      [{ delivery_modes: 'Online' }, 'oecp.csv.invalid_delivery_mode', 'delivery_modes'],
      [{ campus: 'x'.repeat(201) }, 'oecp.content.invalid_value', 'campus'],
    ];
    for (const [patch, code, column] of cases) {
      const result = validateCsvRows('offerings', [{ ...row, ...patch }]);
      expect(result.errors[0], `${code} ${JSON.stringify(patch)}`).toMatchObject({
        code,
        column,
        row: 2,
      });
    }
  });

  it('checks references and duplicate keys', () => {
    const result = validateCsvRows(
      'offerings',
      [
        row,
        row,
        { ...row, course_code: 'UNKNOWN', delivery_modes: 'x-telepathy', offering_code: 'B' },
      ],
      { referenceData: { ...REFERENCE, languageTags: ['en'] } },
    );
    expect(result.errors.map((e) => [e.code, e.row, e.column])).toEqual([
      ['oecp.csv.invalid_language', 2, 'teaching_languages'],
      ['oecp.csv.duplicate_row', 3, 'offering_code'],
      ['oecp.csv.invalid_language', 3, 'teaching_languages'],
      ['oecp.content.unknown_course', 4, 'course_code'],
      ['oecp.csv.invalid_language', 4, 'teaching_languages'],
      ['oecp.content.unknown_delivery_mode', 4, 'delivery_modes'],
    ]);
  });
});

describe('validateCsvFiles', () => {
  it('lets offerings reference courses of the same upload; semicolon files work', () => {
    const courses = `${COURSE_HEADER.replaceAll(',', ';')}\n1.0;NEW-1;published;6;0613;"New; course"\n`;
    const offerings = `${OFFERING_HEADER}\n1.0,NEW-1,A,published,2027-02-01,2027-06-30,en,online\n1.0,EXISTING-1,B,draft,2027-02-01,2027-06-30,en,online\n1.0,OTHER,C,draft,2027-02-01,2027-06-30,en,online\n`;
    const result = validateCsvFiles({ courses, offerings }, { referenceData: REFERENCE });
    expect(result.courses?.errors).toEqual([]);
    expect(result.courses?.normalized[0]?.texts['en']?.title).toBe('New; course');
    expect(result.offerings?.errors).toEqual([
      expect.objectContaining({ code: 'oecp.content.unknown_course', row: 4, file: 'offerings' }),
    ]);
    expect(result.rowCount).toBe(4);
    expect(result.errorCount).toBe(1);
  });

  it('reports parse errors before row errors', () => {
    const result = validateCsvText('courses', `${COURSE_HEADER}\n1.0,"broken\n`);
    expect(result.errors[0]?.code).toBe('oecp.csv.malformed');
  });
});

describe('templates and CSV injection', () => {
  it('lists every column of the row schemas', () => {
    expect(Object.keys(csvCourseRow.shape).sort()).toEqual(
      [...CSV_COURSE_REQUIRED_COLUMNS, ...CSV_COURSE_OPTIONAL_COLUMNS].sort(),
    );
    expect(Object.keys(csvOfferingRow.shape).sort()).toEqual(
      [...CSV_OFFERING_REQUIRED_COLUMNS, ...CSV_OFFERING_OPTIONAL_COLUMNS].sort(),
    );
  });

  it('generates templates whose example rows validate', () => {
    for (const kind of ['courses', 'offerings'] as const) {
      const text = csvTemplate(kind);
      expect(text.startsWith('\uFEFF')).toBe(true);
      const result =
        kind === 'courses'
          ? validateCsvText('courses', text, { referenceData: REFERENCE })
          : validateCsvText('offerings', text, {
              referenceData: { ...REFERENCE, courseCodes: ['AUR-SUST-101'] },
            });
      expect(result.errors, kind).toEqual([]);
      expect(result.parsed.header).toEqual(Object.keys(CSV_TEMPLATE_EXAMPLES[kind]));
    }
  });

  it('prefixes formula triggers with an apostrophe', () => {
    for (const value of ['=1+1', '+31', '-2', '@SUM(A1)', '\tx', '\rx']) {
      expect(neutralizeCsvCell(value)).toBe(`'${value}`);
    }
    expect(neutralizeCsvCell('a=b')).toBe('a=b');
    expect(formatCsv([['=HYPERLINK("x")', 'a,b', 'ok']])).toBe(`"'=HYPERLINK(""x"")","a,b",ok\r\n`);
    expect(formatCsv([['a;b', 'c']], { separator: ';' })).toBe('"a;b";c\r\n');
  });

  it('writes an injection-safe error report', () => {
    const report = csvIssuesReport([
      {
        code: 'oecp.csv.invalid_status',
        severity: 'error',
        file: 'courses',
        row: 2,
        column: 'status',
        message: '=cmd|"/c calc"!A1',
      },
    ]);
    expect(report).toContain(`"'=cmd|""/c calc""!A1"`);
    expect(parseCsvText(report).rows[0]).toMatchObject({ row: '2', column: 'status' });
  });
});
