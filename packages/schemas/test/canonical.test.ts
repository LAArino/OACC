// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { course, courseOffering, issuesToProblemErrors } from '../src/index.js';

const baseCourse = {
  ext_id: 'PHY-101',
  status: 'published',
  ects: 6,
  isced_codes: ['0533'],
  texts: { en: { title: 'Introductory physics' } },
};

const baseOffering = {
  course_ext_id: 'PHY-101',
  ext_offering_id: 'PHY-101-2027S',
  status: 'published',
  start_date: '2027-02-01',
  end_date: '2027-06-30',
  timezone: 'Europe/Madrid',
  teaching_languages: ['en'],
  delivery_modes: ['online'],
};

describe('course', () => {
  it('accepts a minimal published course', () => {
    expect(course.parse(baseCourse).texts['en']?.keywords).toEqual([]);
  });

  it('requires ECTS > 0', () => {
    expect(course.safeParse({ ...baseCourse, ects: 0 }).success).toBe(false);
  });

  it('requires English to publish but not for drafts', () => {
    const texts = { de: { title: 'Einführung in die Physik' } };
    const published = course.safeParse({ ...baseCourse, texts });
    expect(published.success).toBe(false);
    expect(issuesToProblemErrors(published.error!.issues)).toContainEqual(
      expect.objectContaining({ code: 'oecp.content.english_missing', pointer: '/texts/en' }),
    );
    expect(course.safeParse({ ...baseCourse, status: 'draft', texts }).success).toBe(true);
  });

  it('rejects unknown statuses', () => {
    expect(course.safeParse({ ...baseCourse, status: 'archived' }).success).toBe(false);
  });
});

describe('courseOffering', () => {
  it('accepts a valid offering', () => {
    expect(courseOffering.safeParse(baseOffering).success).toBe(true);
  });

  it('rejects alliance_seats above max_students', () => {
    const result = courseOffering.safeParse({
      ...baseOffering,
      max_students: 20,
      alliance_seats: 25,
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]?.message).toBe('oecp.content.seats_exceed_capacity');
  });

  it('rejects end_date before start_date', () => {
    const result = courseOffering.safeParse({ ...baseOffering, end_date: '2027-01-01' });
    expect(result.error!.issues[0]?.message).toBe('oecp.content.date_order');
  });

  it('requires seats_updated_at with seats_available', () => {
    expect(courseOffering.safeParse({ ...baseOffering, seats_available: 3 }).success).toBe(false);
  });
});
