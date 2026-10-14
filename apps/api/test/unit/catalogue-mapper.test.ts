// SPDX-License-Identifier: EUPL-1.2
import {
  courseSearchQuery,
  courseSearchResponse,
  normalizeCourseSearch,
  publicCourseDetail,
} from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import {
  toCourseDetail,
  toSearchResponse,
  toSitemap,
  truncate,
} from '../../src/catalogue/catalogue.mapper.js';
import type {
  CardOfferingRow,
  CourseDetailRows,
  SearchResultRows,
} from '../../src/catalogue/catalogue.repository.js';

const COURSE = '0c000000-0000-4000-8000-000000000001';
const ORG = '0a000000-0000-4000-8000-000000000002';
const label = (en: string) => ({ en });
const mode = (code: string, sort_order: number) => ({
  code,
  sort_order,
  label: label(code),
  schema_org: 'Online' as const,
});

describe('truncate', () => {
  it('keeps short texts and collapses whitespace', () => {
    expect(truncate('  Short\n\ntext ')).toBe('Short text');
  });

  it('cuts long texts at a word boundary with an ellipsis, at most max characters', () => {
    const text = 'word '.repeat(100);
    const out = truncate(text, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out).toMatch(/^word( word)*…$/);
  });

  it('cuts inside a long word when no boundary is near, counting code points', () => {
    const out = truncate('😀'.repeat(400));
    expect([...out]).toHaveLength(300);
    expect(out.endsWith('…')).toBe(true);
  });

  it('drops trailing punctuation before the ellipsis', () => {
    expect(truncate(`${'a'.repeat(40)}, ${'b'.repeat(40)}`, 60)).toBe(`${'a'.repeat(40)}…`);
  });
});

const offering = (over: Partial<CardOfferingRow>): CardOfferingRow => ({
  id: '0c000000-0000-4000-8000-000000000011',
  course_id: COURSE,
  start_date: '2026-12-01',
  end_date: '2027-01-31',
  application_deadline: null,
  enrol_start_date: null,
  timezone: 'Europe/Vienna',
  teaching_languages: ['de-AT'],
  alliance_seats: null,
  seats_available: null,
  seats_updated_at: null,
  modes: [mode('presential', 10)],
  ...over,
});

const rows: SearchResultRows = {
  ids: [COURSE],
  total: 1,
  facets: { partner: [], mode: [], lang: [], isced: [], level: [] },
  courses: [
    {
      id: COURSE,
      ext_id: 'X1',
      ects: '7.50',
      level: 'master',
      org_id: ORG,
      org_slug: 'uibk',
      org_name: label('Innsbruck'),
      org_country_code: 'AT',
    },
  ],
  texts: [
    { course_id: COURSE, lang: 'en', title: 'English title', abstract: 'English abstract' },
    { course_id: COURSE, lang: 'de', title: 'Deutscher Titel', abstract: null },
  ],
  isced: [
    {
      course_id: COURSE,
      isced_code: '0613',
      broad_code: '06',
      is_primary: true,
      label: label('ICT'),
    },
    {
      course_id: COURSE,
      isced_code: '0612',
      broad_code: '06',
      is_primary: false,
      label: label('ICT'),
    },
    {
      course_id: COURSE,
      isced_code: '0533',
      broad_code: '05',
      is_primary: false,
      label: label('Sci'),
    },
  ],
  offerings: [
    offering({}),
    offering({
      id: '0c000000-0000-4000-8000-000000000012',
      start_date: '2027-03-01',
      teaching_languages: ['en'],
      modes: [mode('online', 20), mode('coil', 50)],
      seats_available: 3,
      seats_updated_at: new Date('2026-10-01T00:00:00Z'),
    }),
  ],
};

const search = (q: Record<string, unknown>) => normalizeCourseSearch(courseSearchQuery.parse(q));

describe('toSearchResponse', () => {
  it('builds cards valid against the published contract', () => {
    const body = courseSearchResponse.parse(toSearchResponse(rows, search({ locale: 'de' })));
    expect(body.items[0]).toMatchObject({
      title: 'Deutscher Titel',
      title_lang: 'de',
      abstract: 'English abstract',
      abstract_lang: 'en',
      ects: 7.5,
      isced_broad_fields: [
        { code: '06', label: { en: 'ICT' } },
        { code: '05', label: { en: 'Sci' } },
      ],
      delivery_modes: ['presential', 'online', 'coil'],
      teaching_languages: ['de', 'en'],
      offerings_count: 2,
    });
    expect(body.items[0]!.next_offering!.id).toBe('0c000000-0000-4000-8000-000000000011');
  });

  it('falls back to English, and picks the next offering matching mode/lang filters', () => {
    const body = toSearchResponse(rows, search({ locale: 'fr', mode: 'coil' }));
    expect(body.items[0]).toMatchObject({ title: 'English title', title_lang: 'en' });
    expect(body.items[0]!.next_offering).toMatchObject({
      id: '0c000000-0000-4000-8000-000000000012',
      seats_available: 3,
      seats_updated_at: '2026-10-01T00:00:00.000Z',
    });
    const byLang = toSearchResponse(rows, search({ lang: 'de' }));
    expect(byLang.items[0]!.next_offering!.id).toBe('0c000000-0000-4000-8000-000000000011');
  });

  it('skips ids that vanished before hydration', () => {
    const body = toSearchResponse(
      { ...rows, ids: ['0c000000-0000-4000-8000-0000000000ff'] },
      search({}),
    );
    expect(body.items).toEqual([]);
  });
});

describe('toCourseDetail', () => {
  const detail: CourseDetailRows = {
    course: {
      id: COURSE,
      ext_id: 'X1',
      ects: '5.00',
      level: 'weird',
      eqf_level: null,
      teaching_hours: '22.5',
      info_url: null,
      contact_email: null,
      updated_at: new Date('2026-01-01T00:00:00Z'),
      org_id: ORG,
      org_slug: 'uibk',
      org_name: label('Innsbruck'),
      org_country_code: null,
      org_logo_url: null,
      org_website_url: null,
      org_contact_email: 'info@uibk.example',
      unit_id: null,
      unit_slug: null,
      unit_name: null,
    },
    texts: [
      {
        lang: 'en',
        title: 'T',
        abstract: null,
        description: null,
        learning_outcomes: null,
        prerequisites: null,
        assessment: null,
        keywords: [],
        is_machine_translated: false,
        updated_at: new Date('2026-03-01T00:00:00Z'),
      },
    ],
    isced: [],
    offerings: [
      {
        id: '0c000000-0000-4000-8000-000000000011',
        ext_offering_id: 'O1',
        status: 'cancelled',
        start_date: '2027-01-01',
        end_date: '2027-02-01',
        enrol_start_date: null,
        application_deadline: null,
        timezone: 'Europe/Vienna',
        teaching_languages: ['en'],
        campus: null,
        max_students: null,
        alliance_seats: null,
        seats_available: null,
        seats_updated_at: null,
        application_url: null,
        updated_at: new Date('2026-02-01T00:00:00Z'),
        session_id: null,
        session_name: null,
        session_start_date: null,
        session_end_date: null,
        modes: [mode('hybrid', 30)],
      },
    ],
  };

  it('maps rows to a valid course page with the latest change as updated_at', () => {
    const body = publicCourseDetail.parse(toCourseDetail(detail));
    expect(body).toMatchObject({
      level: null, // unknown values never leak
      teaching_hours: 22.5,
      contact_email: 'info@uibk.example',
      updated_at: '2026-03-01T00:00:00.000Z',
    });
    expect(body.offerings[0]).toMatchObject({ status: 'cancelled', delivery_modes: ['hybrid'] });
  });
});

describe('toSitemap', () => {
  it('escapes URLs and lists lastmod', () => {
    const xml = toSitemap('https://campus.example.org/a&b', [
      { id: COURSE, lastmod: new Date('2026-10-01T12:00:00Z') },
    ]);
    expect(xml).toContain(
      `<url><loc>https://campus.example.org/a&amp;b/en/courses/${COURSE}</loc><lastmod>2026-10-01T12:00:00.000Z</lastmod></url>`,
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
  });
});
