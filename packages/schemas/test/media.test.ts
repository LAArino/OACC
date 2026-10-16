// SPDX-License-Identifier: EUPL-1.2
// Course images (decision 27): CSV template 1.3, the admin and public shapes.
import { describe, expect, it } from 'vitest';
import {
  COURSE_IMAGE_FILE_PATTERN,
  CSV_TEMPLATE_VERSION,
  CSV_TEMPLATE_VERSIONS,
  courseImage,
  courseImageAltSatisfied,
  courseImagePatch,
  courseImageUploadFields,
  csvColumnVersion,
  csvTemplate,
  ERROR_CODES,
  parseCsvText,
  publicCourseCard,
  toPublicCourseImage,
  validateCsvText,
} from '../src/index.js';

const HEADER = 'template_version,course_code,status,ects,isced_codes,title_en';
const IMAGE_HEADER = `${HEADER},image_url,image_alt_en,image_credit`;
const ID = '0c000000-0000-4000-8000-000000000001';

describe('CSV template 1.3', () => {
  it('is the current template and still accepts 1.0, 1.1 and 1.2 rows', () => {
    expect(CSV_TEMPLATE_VERSION).toBe('1.3');
    expect(CSV_TEMPLATE_VERSIONS).toEqual(['1.0', '1.1', '1.2', '1.3']);
    for (const version of ['1.0', '1.1', '1.2', '1.3']) {
      expect(
        validateCsvText('courses', `${HEADER}\n${version},C1,draft,5,0613,T\n`).errors,
      ).toEqual([]);
    }
  });

  it('reads the image columns: URL with alt and credit, decorative, empty URL', () => {
    const result = validateCsvText(
      'courses',
      `${IMAGE_HEADER}\n` +
        '1.3,C1,draft,5,0613,T,https://img.example.org/c1.jpg, Students on campus ,Photo: A. Example\n' +
        '1.3,C2,draft,5,0613,T,https://img.example.org/c2.png,,\n' +
        '1.3,C3,draft,5,0613,T,,Ignored without a URL,Ignored\n',
    );
    expect(result.errors).toEqual([]);
    const [c1, c2, c3] = result.normalized;
    expect(c1?.image).toEqual({
      url: 'https://img.example.org/c1.jpg',
      alt_en: 'Students on campus',
      credit: 'Photo: A. Example',
    });
    expect(c2?.image).toEqual({
      url: 'https://img.example.org/c2.png',
      alt_en: null,
      credit: null,
    });
    expect(c3?.image).toBeUndefined();
    expect(c3).not.toHaveProperty('image');
  });

  it('leaves the image untouched when the columns are absent', () => {
    const result = validateCsvText('courses', `${HEADER}\n1.3,C1,draft,5,0613,T\n`);
    expect(result.normalized[0]?.image).toBeUndefined();
  });

  it.each([
    ['http://img.example.org/c1.jpg', 'image_url', 'oecp.csv.invalid_url'],
    ['ftp://img.example.org/c1.jpg', 'image_url', 'oecp.csv.invalid_url'],
    ['not a url', 'image_url', 'oecp.csv.invalid_url'],
    [`https://img.example.org/${'a'.repeat(2030)}`, 'image_url', 'oecp.csv.invalid_url'],
  ])('refuses image_url %s', (url, column, code) => {
    const result = validateCsvText('courses', `${IMAGE_HEADER}\n1.3,C1,draft,5,0613,T,${url},,\n`);
    expect(result.errors.map((e) => [e.code, e.column])).toEqual([[code, column]]);
  });

  it('checks the lengths of alt and credit (300 characters)', () => {
    const ok = 'x'.repeat(300);
    const long = 'x'.repeat(301);
    const url = 'https://img.example.org/c1.jpg';
    expect(
      validateCsvText('courses', `${IMAGE_HEADER}\n1.3,C1,draft,5,0613,T,${url},${ok},${ok}\n`)
        .errors,
    ).toEqual([]);
    const result = validateCsvText(
      'courses',
      `${IMAGE_HEADER}\n1.3,C1,draft,5,0613,T,${url},${long},${long}\n`,
    );
    expect(result.errors.map((e) => [e.code, e.column])).toEqual([
      ['oecp.content.invalid_value', 'image_alt_en'],
      ['oecp.content.invalid_value', 'image_credit'],
    ]);
  });

  it('refuses the image columns in rows of an older template', () => {
    for (const version of ['1.0', '1.1', '1.2']) {
      const result = validateCsvText(
        'courses',
        `${HEADER},image_url\n${version},C1,draft,5,0613,T,\n`,
      );
      expect(result.errors.map((e) => [e.code, e.column])).toEqual([
        ['oecp.csv.invalid_template_version', 'template_version'],
      ]);
    }
    expect(csvColumnVersion('courses', 'image_url')).toBe('1.3');
    expect(csvColumnVersion('courses', 'image_alt_en')).toBe('1.3');
    expect(csvColumnVersion('courses', 'image_credit')).toBe('1.3');
  });

  it('generates a 1.3 template with the image columns (empty in the example)', () => {
    const parsed = parseCsvText(csvTemplate('courses').replace(/^\uFEFF/, ''));
    expect(parsed.header).toEqual(
      expect.arrayContaining(['image_url', 'image_alt_en', 'image_credit']),
    );
    expect(parsed.rows[0]?.['template_version']).toBe('1.3');
    expect(parsed.rows[0]?.['image_url']).toBe('');
  });
});

describe('course image shapes', () => {
  const stored = {
    key: '0123456789abcdef',
    alt: { en: 'Students in a lab' },
    decorative: false,
    credit: 'Photo: A. Example',
    width: 1600,
    height: 900,
    source_url: null,
    updated_at: '2026-10-16T10:00:00.000Z',
  };

  it('stored image (admin record) is strict', () => {
    expect(courseImage.safeParse(stored).success).toBe(true);
    expect(courseImage.safeParse({ ...stored, key: 'XYZ' }).success).toBe(false);
    expect(courseImage.safeParse({ ...stored, extra: 1 }).success).toBe(false);
  });

  it('public image: paths on the portal origin, or absolute with a base', () => {
    expect(toPublicCourseImage(ID, stored)).toEqual({
      url: `/media/courses/${ID}/0123456789abcdef.lg.webp`,
      thumbnail_url: `/media/courses/${ID}/0123456789abcdef.sm.webp`,
      alt: { en: 'Students in a lab' },
      decorative: false,
      credit: 'Photo: A. Example',
      width: 1600,
      height: 900,
    });
    expect(toPublicCourseImage(ID, stored, 'https://campus.example.org').url).toBe(
      `https://campus.example.org/media/courses/${ID}/0123456789abcdef.lg.webp`,
    );
    expect(COURSE_IMAGE_FILE_PATTERN.test('0123456789abcdef.sm.webp')).toBe(true);
    expect(COURSE_IMAGE_FILE_PATTERN.test('../0123456789abcdef.sm.webp')).toBe(false);
  });

  it('public card accepts an image object', () => {
    const card = {
      id: ID,
      ext_id: 'X',
      organization: { id: ID, slug: 'uibk', name: { en: 'UIBK' }, country_code: null },
      title: 'T',
      title_lang: 'en',
      abstract: null,
      abstract_lang: null,
      ects: 5,
      kind: 'course',
      level: null,
      levels: [],
      attributes: [],
      isced_broad_fields: [],
      delivery_modes: [],
      teaching_languages: [],
      next_offering: null,
      offerings_count: 0,
      image: toPublicCourseImage(ID, stored),
    };
    expect(publicCourseCard.safeParse(card).success).toBe(true);
  });

  it('upload fields: alt_en required unless decorative', () => {
    expect(courseImageUploadFields.parse({ alt_en: ' A lab ', credit: '' })).toEqual({
      alt: { en: 'A lab' },
      decorative: false,
      credit: null,
    });
    expect(courseImageUploadFields.parse({ decorative: 'true' })).toEqual({
      alt: {},
      decorative: true,
      credit: null,
    });
    const missing = courseImageUploadFields.safeParse({ alt_en: '  ' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((i) => i.message)).toEqual(['oecp.media.alt_required']);
    expect(courseImageUploadFields.safeParse({ decorative: 'yes' }).success).toBe(false);
    expect(courseImageUploadFields.safeParse({ alt_en: 'x'.repeat(301) }).success).toBe(false);
  });

  it('patch: at least one member, alt values trimmed, credit "" → null', () => {
    expect(courseImagePatch.parse({ alt: { en: ' Lab ' }, credit: '' })).toEqual({
      alt: { en: 'Lab' },
      credit: null,
    });
    expect(courseImagePatch.safeParse({}).success).toBe(false);
    expect(courseImagePatch.safeParse({ alt: { 'en-GB': 'x' } }).success).toBe(false);
    expect(courseImagePatch.safeParse({ alt: { en: '' } }).success).toBe(false);
    expect(courseImagePatch.safeParse({ width: 3 }).success).toBe(false);
  });

  it('alternative text rule', () => {
    expect(courseImageAltSatisfied({ decorative: true, alt: {} })).toBe(true);
    expect(courseImageAltSatisfied({ decorative: false, alt: { de: 'x' } })).toBe(false);
    expect(courseImageAltSatisfied({ decorative: false, alt: { en: 'x' } })).toBe(true);
  });

  it('defines the six media error codes', () => {
    expect(Object.keys(ERROR_CODES).filter((c) => c.startsWith('oecp.media.'))).toEqual([
      'oecp.media.too_large',
      'oecp.media.unsupported_type',
      'oecp.media.invalid_image',
      'oecp.media.alt_required',
      'oecp.media.fetch_failed',
      'oecp.media.not_found',
    ]);
    expect(ERROR_CODES['oecp.media.fetch_failed'].severity).toBe('warning');
  });
});
