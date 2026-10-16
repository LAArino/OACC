// SPDX-License-Identifier: EUPL-1.2
import {
  type AttributeDefinition,
  courseSearchQuery,
  courseSearchResponse,
  normalizeCourseSearch,
  publicCourseDetail,
  referenceResponse,
} from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import {
  localizedText,
  resolveAttributes,
  toCourseDetail,
  toReference,
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
const KEY = '0123456789abcdef';
const NO_IMAGE = {
  image_key: null,
  image_alt: {},
  image_decorative: false,
  image_credit: null,
  image_width: null,
  image_height: null,
};
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

const DEFINITIONS: AttributeDefinition[] = [
  {
    key: 'free_course',
    value_type: 'boolean',
    label: label('Free course'),
    description: null,
    options: null,
    filterable: true,
    show_as_tag: true,
    sort_order: 50,
  },
  {
    key: 'sdg',
    value_type: 'multi_enum',
    label: label('SDGs'),
    description: label('UN goals'),
    options: [
      { value: 'sdg04', label: label('SDG 4: Quality education') },
      { value: 'sdg13', label: label('SDG 13: Climate action') },
    ],
    filterable: true,
    show_as_tag: true,
    sort_order: 20,
  },
  {
    key: 'competence_framework',
    value_type: 'enum',
    label: label('Competence framework'),
    description: null,
    options: [{ value: 'louis', label: label('LOUIS') }],
    filterable: false,
    show_as_tag: false,
    sort_order: 30,
  },
  {
    key: 'enrolled_only',
    value_type: 'boolean',
    label: label('Only for enrolled students'),
    description: null,
    options: null,
    filterable: false,
    show_as_tag: true,
    sort_order: 60,
  },
];

const ATTRIBUTES = {
  free_course: true,
  enrolled_only: false,
  competence_framework: 'louis',
  sdg: ['sdg13', 'sdg04', 'sdg99'],
  undefined_key: 'x',
};

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
  application_instructions: {},
  modes: [mode('presential', 10)],
  ...over,
});

const rows: SearchResultRows = {
  ids: [COURSE],
  total: 1,
  facets: new Map([
    ['kind', [{ value: 'bip', count: 1 }]],
    [
      'attr:free_course',
      [
        { value: 'true', count: 3 },
        { value: 'false', count: 1 },
      ],
    ],
    ['attr:sdg', [{ value: 'sdg13', count: 2 }]],
  ]),
  definitions: DEFINITIONS,
  courses: [
    {
      id: COURSE,
      ext_id: 'X1',
      kind: 'bip',
      ects: '7.50',
      level: 'master',
      levels: ['master', 'bachelor'],
      attributes: ATTRIBUTES,
      image_key: KEY,
      image_alt: { en: 'Students in a lab' },
      image_decorative: false,
      image_credit: 'Photo: A. Example',
      image_width: 1600,
      image_height: 900,
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
    offering({ application_instructions: { en: 'Ask your home office.', de: 'Fragen Sie.' } }),
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
    expect(body.items[0]!.next_offering!.application_instructions).toBe('Fragen Sie.');
    expect(body.items[0]).toMatchObject({ kind: 'bip', levels: ['master', 'bachelor'] });
  });

  it('puts the image on the card as paths on the portal origin', () => {
    const body = courseSearchResponse.parse(toSearchResponse(rows, search({})));
    expect(body.items[0]!.image).toEqual({
      url: `/media/courses/${COURSE}/${KEY}.lg.webp`,
      thumbnail_url: `/media/courses/${COURSE}/${KEY}.sm.webp`,
      alt: { en: 'Students in a lab' },
      decorative: false,
      credit: 'Photo: A. Example',
      width: 1600,
      height: 900,
    });
    const without = toSearchResponse(
      { ...rows, courses: rows.courses.map((c) => ({ ...c, ...NO_IMAGE })) },
      search({}),
    );
    expect(without.items[0]!.image).toBeNull();
  });

  it('shows tag attributes on cards: show_as_tag definitions, booleans only when true', () => {
    const body = toSearchResponse(rows, search({}));
    expect(body.items[0]!.attributes).toEqual([
      {
        key: 'sdg',
        label: { en: 'SDGs' },
        values: [
          { value: 'sdg04', label: { en: 'SDG 4: Quality education' } },
          { value: 'sdg13', label: { en: 'SDG 13: Climate action' } },
          { value: 'sdg99', label: { en: 'sdg99' } },
        ],
      },
      {
        key: 'free_course',
        label: { en: 'Free course' },
        values: [{ value: 'true', label: { en: 'Yes' } }],
      },
    ]);
    expect(body.items[0]!.next_offering!.application_instructions).toBe('Ask your home office.');
  });

  it('labels kind and attribute facets, one entry per filterable definition', () => {
    const body = courseSearchResponse.parse(toSearchResponse(rows, search({})));
    expect(body.facets.kind).toEqual([{ value: 'bip', count: 1 }]);
    expect(body.facets.attributes).toEqual({
      sdg: [{ value: 'sdg13', count: 2, label: { en: 'SDG 13: Climate action' } }],
      free_course: [
        { value: 'true', count: 3, label: { en: 'Yes' } },
        { value: 'false', count: 1, label: { en: 'No' } },
      ],
    });
    expect(body.facets.partner).toEqual([]);
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
    definitions: DEFINITIONS,
    course: {
      id: COURSE,
      ext_id: 'X1',
      kind: 'course',
      ects: '5.00',
      level: 'weird',
      levels: ['weird', 'master'],
      attributes: ATTRIBUTES,
      eqf_level: null,
      teaching_hours: '22.5',
      info_url: null,
      contact_email: null,
      instructors: ['Course team, University of Innsbruck'],
      ...NO_IMAGE,
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
        mode_of_repetition: 'Every winter semester.',
        methods: 'Seminars and project work.',
        literature: null,
        privacy_notice: null,
        remarks: null,
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
        application_instructions: { en: 'Nomination by the home university.' },
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
      instructors: ['Course team, University of Innsbruck'],
      updated_at: '2026-03-01T00:00:00.000Z',
    });
    expect(body.texts['en']).toMatchObject({
      mode_of_repetition: 'Every winter semester.',
      methods: 'Seminars and project work.',
      literature: null,
      privacy_notice: null,
      remarks: null,
    });
    expect(body.offerings[0]).toMatchObject({
      status: 'cancelled',
      delivery_modes: ['hybrid'],
      application_instructions: { en: 'Nomination by the home university.' },
    });
    expect(body.levels).toEqual(['master']);
    expect(body.image).toBeNull();
    expect(body.attributes.map((a) => [a.key, a.values.map((v) => v.value)])).toEqual([
      ['sdg', ['sdg04', 'sdg13', 'sdg99']],
      ['competence_framework', ['louis']],
      ['free_course', ['true']],
      ['enrolled_only', ['false']],
    ]);
  });
});

describe('toCourseDetail image', () => {
  it('maps a decorative image without credit', () => {
    const rows: CourseDetailRows = {
      definitions: [],
      course: {
        id: COURSE,
        ext_id: 'X1',
        kind: 'course',
        ects: '5.00',
        level: 'master',
        levels: ['master'],
        attributes: {},
        eqf_level: null,
        teaching_hours: null,
        info_url: null,
        contact_email: null,
        instructors: [],
        image_key: KEY,
        image_alt: {},
        image_decorative: true,
        image_credit: null,
        image_width: 640,
        image_height: 480,
        updated_at: new Date('2026-01-01T00:00:00Z'),
        org_id: ORG,
        org_slug: 'uibk',
        org_name: label('Innsbruck'),
        org_country_code: null,
        org_logo_url: null,
        org_website_url: null,
        org_contact_email: null,
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
          mode_of_repetition: null,
          methods: null,
          literature: null,
          privacy_notice: null,
          remarks: null,
          keywords: [],
          is_machine_translated: false,
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      isced: [],
      offerings: [],
    };
    const body = publicCourseDetail.parse(toCourseDetail(rows));
    expect(body.image).toEqual({
      url: `/media/courses/${COURSE}/${KEY}.lg.webp`,
      thumbnail_url: `/media/courses/${COURSE}/${KEY}.sm.webp`,
      alt: {},
      decorative: true,
      credit: null,
      width: 640,
      height: 480,
    });
  });
});

describe('attribute helpers', () => {
  it('drops values of the wrong shape and keys without a definition', () => {
    expect(
      resolveAttributes(DEFINITIONS, { free_course: 'yes', sdg: 'sdg04', undefined_key: true }),
    ).toEqual([]);
  });

  it('picks instructions in the locale, else English, else the first language', () => {
    expect(localizedText({ de: 'D', en: 'E' }, 'de')).toBe('D');
    expect(localizedText({ de: 'D', en: 'E' }, 'fr')).toBe('E');
    expect(localizedText({ nl: 'N', de: 'D' }, 'fr')).toBe('D');
    expect(localizedText({}, 'en')).toBeNull();
  });

  it('lists kinds and definitions in /reference', () => {
    const body = referenceResponse.parse(
      toReference({
        organizations: [],
        modes: [],
        isced: [],
        languages: [],
        definitions: DEFINITIONS,
      }),
    );
    expect(body.kinds.map((k) => k.code)).toEqual(['course', 'bip', 'lecture_series', 'other']);
    expect(body.attribute_definitions.map((d) => d.key)).toEqual([
      'sdg',
      'competence_framework',
      'free_course',
      'enrolled_only',
    ]);
    expect(body.attribute_definitions[0]).toMatchObject({
      value_type: 'multi_enum',
      description: { en: 'UN goals' },
      options: [
        { value: 'sdg04', label: { en: 'SDG 4: Quality education' } },
        { value: 'sdg13', label: { en: 'SDG 13: Climate action' } },
      ],
      filterable: true,
    });
    expect(body.attribute_definitions[2]!.options).toEqual([]);
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
