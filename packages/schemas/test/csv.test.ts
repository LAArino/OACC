// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  csvCourseRow,
  csvOfferingRow,
  issuesToProblemErrors,
  splitMultiValue,
} from '../src/index.js';

const courseRow = {
  template_version: '1.0',
  course_code: 'PHY-101',
  status: 'published',
  ects: '7.5',
  isced_codes: '0533|0541',
  title_en: 'Introductory physics',
};

const offeringRow = {
  template_version: '1.0',
  course_code: 'PHY-101',
  offering_code: '2027S',
  status: 'published',
  start_date: '2027-02-01',
  end_date: '2027-06-30',
  teaching_languages: 'en|es',
  delivery_modes: 'online|hybrid',
};

describe('courses.csv row', () => {
  it('accepts required columns and language columns', () => {
    const row = { ...courseRow, title_de: 'Einführung', abstract_en: '', level: '' };
    expect(csvCourseRow.safeParse(row).success).toBe(true);
  });

  it('rejects unknown columns', () => {
    const result = csvCourseRow.safeParse({ ...courseRow, credits: '6' });
    expect(result.success).toBe(false);
    const errors = issuesToProblemErrors(result.error!.issues, { file: 'courses', row: 2 });
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'oecp.csv.unknown_column', column: 'credits', row: 2 }),
    );
  });

  it('reports missing required columns', () => {
    const { title_en: _omit, ...row } = courseRow;
    const errors = issuesToProblemErrors(csvCourseRow.safeParse(row).error!.issues, {
      file: 'courses',
    });
    expect(errors[0]).toMatchObject({ code: 'oecp.csv.missing_column', column: 'title_en' });
  });

  it('rejects ECTS of zero', () => {
    expect(csvCourseRow.safeParse({ ...courseRow, ects: '0' }).success).toBe(false);
  });
});

describe('offerings.csv row', () => {
  it('accepts a valid row', () => {
    expect(csvOfferingRow.safeParse(offeringRow).success).toBe(true);
  });

  it('maps bad dates to oecp.csv.invalid_date', () => {
    const result = csvOfferingRow.safeParse({ ...offeringRow, start_date: '01/02/2027' });
    const errors = issuesToProblemErrors(result.error!.issues, { file: 'offerings', row: 14 });
    expect(errors).toEqual([
      {
        code: 'oecp.csv.invalid_date',
        severity: 'error',
        message: 'Expected YYYY-MM-DD',
        file: 'offerings',
        row: 14,
        column: 'start_date',
      },
    ]);
  });

  it('rejects alliance_seats above max_students', () => {
    const row = { ...offeringRow, max_students: '10', alliance_seats: '12' };
    expect(csvOfferingRow.safeParse(row).error!.issues[0]?.message).toBe(
      'oecp.content.seats_exceed_capacity',
    );
  });

  it('splits multi-value cells', () => {
    expect(splitMultiValue('en| es |')).toEqual(['en', 'es']);
    expect(splitMultiValue('')).toEqual([]);
  });
});
