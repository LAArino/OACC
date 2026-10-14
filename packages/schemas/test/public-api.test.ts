// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  courseSearchQuery,
  normalizeCourseSearch,
  oeapiCoursesQuery,
  oeapiOfferingsQuery,
  publicCourseCard,
  suggestQuery,
} from '../src/index.js';

const normalize = (q: Record<string, unknown>) => normalizeCourseSearch(courseSearchQuery.parse(q));

describe('courseSearchQuery', () => {
  it('defaults to upcoming courses, 20 per page, English, by start date', () => {
    expect(normalize({})).toEqual({
      q: undefined,
      partner: [],
      mode: [],
      lang: [],
      isced: [],
      level: [],
      ectsMin: undefined,
      ectsMax: undefined,
      upcoming: true,
      sort: 'start_date',
      page: 1,
      pageSize: 20,
      locale: 'en',
    });
  });

  it('defaults to relevance with a query and ignores relevance without one', () => {
    expect(normalize({ q: ' quantum ' })).toMatchObject({ q: 'quantum', sort: 'relevance' });
    expect(normalize({ q: '  ', sort: 'relevance' })).toMatchObject({
      q: undefined,
      sort: 'start_date',
    });
  });

  it('resolves aliases; the camelCase spelling wins', () => {
    expect(normalize({ ects_min: '2', ects_max: '10', page_size: '5' })).toMatchObject({
      ectsMin: 2,
      ectsMax: 10,
      pageSize: 5,
    });
    expect(normalize({ ectsMin: '3', ects_min: '2' }).ectsMin).toBe(3);
    expect(normalize({ includeUnscheduled: 'true' }).upcoming).toBe(false);
    expect(normalize({ upcoming: 'false' }).upcoming).toBe(false);
    expect(normalize({ includeUnscheduled: 'true', upcoming: 'true' }).upcoming).toBe(true);
  });

  it('accepts single and repeated list values', () => {
    expect(normalize({ partner: 'uibk', level: ['master', 'bachelor'] })).toMatchObject({
      partner: ['uibk'],
      level: ['master', 'bachelor'],
    });
  });

  it.each([
    { isced: '1' },
    { level: 'phd' },
    { lang: 'en-GB' },
    { locale: 'EN' },
    { upcoming: 'yes' },
    { pageSize: '51' },
    { ects_min: '0' },
  ])('rejects %o', (q) => {
    expect(courseSearchQuery.safeParse(q).success).toBe(false);
  });
});

describe('suggestQuery', () => {
  it('needs 2 characters and caps the limit at 10', () => {
    expect(suggestQuery.parse({ q: 'ab' })).toEqual({ q: 'ab', limit: 10 });
    expect(suggestQuery.safeParse({ q: 'a' }).success).toBe(false);
    expect(suggestQuery.safeParse({ q: 'ab', limit: '11' }).success).toBe(false);
  });
});

describe('OEAPI queries', () => {
  it('splits comma-separated and repeated values', () => {
    expect(
      oeapiCoursesQuery.parse({ modeOfDelivery: ['online,hybrid', 'on campus'], sort: '-name' }),
    ).toMatchObject({ modeOfDelivery: ['online', 'hybrid', 'on campus'], sort: ['-name'] });
    expect(oeapiOfferingsQuery.parse({ expand: 'academicSession,course' }).expand).toEqual([
      'academicSession',
      'course',
    ]);
  });

  it('rejects values outside the v5 vocabularies and page sizes above 250', () => {
    expect(oeapiCoursesQuery.safeParse({ level: 'phd' }).success).toBe(false);
    expect(oeapiCoursesQuery.safeParse({ modeOfDelivery: 'teleport' }).success).toBe(false);
    expect(oeapiCoursesQuery.safeParse({ teachingLanguage: 'en' }).success).toBe(false);
    expect(oeapiCoursesQuery.safeParse({ pageSize: '251' }).success).toBe(false);
    expect(oeapiOfferingsQuery.safeParse({ since: '2026-13-01' }).success).toBe(false);
  });
});

describe('response contracts', () => {
  it('are strict', () => {
    const card = {
      id: '0c000000-0000-4000-8000-000000000001',
      ext_id: 'X',
      organization: {
        id: '0c000000-0000-4000-8000-000000000002',
        slug: 'uibk',
        name: { en: 'UIBK' },
        country_code: null,
      },
      title: 'T',
      title_lang: 'en',
      abstract: null,
      abstract_lang: null,
      ects: 5,
      level: null,
      isced_broad_fields: [],
      delivery_modes: [],
      teaching_languages: [],
      next_offering: null,
      offerings_count: 0,
    };
    expect(publicCourseCard.safeParse(card).success).toBe(true);
    expect(publicCourseCard.safeParse({ ...card, extra: 1 }).success).toBe(false);
  });
});
