// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { CLI_IMAGE_ACTOR, parseImagesCsv } from '../../src/cli/import-course-images.js';

const parse = (text: string) => parseImagesCsv(new TextEncoder().encode(text));
const HEADER = 'course_code,file,alt_en,decorative,credit\n';

describe('images.csv parsing (oecp import-course-images)', () => {
  it('reads rows with alt text, credit and the decorative flag', () => {
    const result = parse(
      HEADER +
        'MATH101,math.png,"A blackboard, with formulas",,"Photo: A. Smith"\n' +
        'ART200,art.jpg,,TRUE,\n' +
        'BIO300,bio.webp,Cells under a microscope,false,\n',
    );
    expect(result.fileErrors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.rows).toEqual([
      {
        row: 2,
        courseCode: 'MATH101',
        file: 'math.png',
        alt: { en: 'A blackboard, with formulas' },
        decorative: false,
        credit: 'Photo: A. Smith',
      },
      { row: 3, courseCode: 'ART200', file: 'art.jpg', alt: {}, decorative: true, credit: null },
      {
        row: 4,
        courseCode: 'BIO300',
        file: 'bio.webp',
        alt: { en: 'Cells under a microscope' },
        decorative: false,
        credit: null,
      },
    ]);
  });

  it('accepts a BOM, CRLF line ends, semicolons and the optional columns missing', () => {
    expect(parse('﻿course_code;file;alt_en\r\nA1;a.png;Alt text\r\n').rows).toHaveLength(1);
    const minimal = parse('course_code,file\nA1,a.png\n');
    expect(minimal.fileErrors).toEqual([]);
    expect(minimal.rows).toEqual([]);
    expect(minimal.rowErrors[0]?.message).toContain('alt_en is required');
  });

  it('reports line errors and keeps the valid lines', () => {
    const result = parse(
      HEADER +
        'A1,a.png,Alt,,\n' +
        ',b.png,Alt,,\n' +
        'A3,,Alt,,\n' +
        'A4,d.png,,,\n' +
        'A5,e.png,Alt,maybe,\n' +
        `A6,f.png,${'x'.repeat(301)},,\n` +
        'A1,g.png,Again,,\n',
    );
    expect(result.rows.map((r) => r.courseCode)).toEqual(['A1']);
    expect(result.rowErrors.map((e) => [e.row, e.courseCode, e.message])).toEqual([
      [3, '', 'course_code is empty'],
      [4, 'A3', 'file is empty'],
      [5, 'A4', 'alt_en is required unless decorative is true'],
      [6, 'A5', 'decorative must be true or false'],
      [7, 'A6', expect.stringContaining('alt_en')],
      [8, 'A1', 'course_code appears twice in the file'],
    ]);
  });

  it('refuses a file with a missing required column, an unknown column or no rows', () => {
    expect(parse('course_code,alt_en\nA1,Alt\n').fileErrors.join()).toContain('"file"');
    expect(parse('course_code,file,alt\nA1,a.png,Alt\n').fileErrors.join()).toContain(
      'unknown column "alt"',
    );
    expect(parse(HEADER).fileErrors.join()).toContain('no rows');
    expect(parse('').fileErrors.length).toBeGreaterThan(0);
  });

  it('refuses a file that is not UTF-8 and unterminated quotes', () => {
    expect(parseImagesCsv(Uint8Array.from([0x63, 0xff, 0xfe])).fileErrors.join()).toContain(
      'UTF-8',
    );
    expect(parse(HEADER + 'A1,a.png,"open,,\n').fileErrors.length).toBeGreaterThan(0);
  });

  it('writes audit rows as system:cli', () => {
    expect(CLI_IMAGE_ACTOR).toBe('system:cli');
  });
});
