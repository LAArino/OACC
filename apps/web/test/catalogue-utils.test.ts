// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import type { AttributeDefinition, CourseAttribute, CourseDetail } from '../app/types/catalogue';
import {
  activeFilterCount,
  attributeTags,
  catalogueBackPath,
  countryName,
  courseInstructors,
  courseLevels,
  emptySearchState,
  facetOptions,
  formatDate,
  formatDateTimeAsDate,
  isDeadlinePassed,
  labelText,
  languageName,
  orderAttributes,
  parseSearchState,
  queryString,
  restrictAttributes,
  safeEmail,
  safeHttpUrl,
  seatsInfo,
  stateFromFormData,
  textIn,
  toApiQuery,
  toRouteQuery,
  todayIn,
  urlHost,
  withoutAttribute,
  withoutFilters,
  withoutValue,
  withPage,
} from '../app/utils/catalogue';
import { courseJsonLd, serializeJsonLd } from '../app/utils/courseJsonLd';
import course from './fixtures/catalogue/course.json';
import reference from './fixtures/catalogue/reference.json';

const definitions = reference.attribute_definitions as unknown as AttributeDefinition[];
const courseAttributes = course.attributes as unknown as CourseAttribute[];

describe('parseSearchState', () => {
  it('returns the defaults for an empty query', () => {
    expect(parseSearchState({})).toEqual(emptySearchState());
  });

  it('reads every parameter, repeated or single', () => {
    const state = parseSearchState({
      q: '  climate ',
      partner: ['urv', 'vu-amsterdam'],
      mode: 'online',
      lang: ['en', 'ca'],
      isced: '05',
      level: 'master',
      kind: ['bip', 'lecture_series'],
      attr_sdg: ['sdg_13', 'sdg_14'],
      attr_free_course: 'true',
      ects_min: '3',
      ects_max: '7.5',
      upcoming: 'false',
      sort: 'title',
      page: '3',
    });
    expect(state).toEqual({
      q: 'climate',
      partner: ['urv', 'vu-amsterdam'],
      mode: ['online'],
      lang: ['en', 'ca'],
      isced: ['05'],
      level: ['master'],
      kind: ['bip', 'lecture_series'],
      attrs: { free_course: ['true'], sdg: ['sdg_13', 'sdg_14'] },
      ectsMin: 3,
      ectsMax: 7.5,
      includePast: true,
      sort: 'title',
      page: 3,
    });
  });

  it('drops malformed values and duplicates', () => {
    const state = parseSearchState({
      partner: ['URV!', 'urv', 'urv', null],
      lang: ['english', 'en'],
      isced: ['5', '051', '05'],
      ects_min: '-1',
      ects_max: 'abc',
      sort: 'price',
      page: '0',
      upcoming: 'no',
    });
    expect(state.partner).toEqual(['urv']);
    expect(state.lang).toEqual(['en']);
    expect(state.isced).toEqual(['05']);
    expect(state.ectsMin).toBeNull();
    expect(state.ectsMax).toBeNull();
    expect(state.sort).toBeNull();
    expect(state.page).toBe(1);
    expect(state.includePast).toBe(false);
  });

  it('reads attribute filters, dropping malformed keys and values', () => {
    const state = parseSearchState({
      attr_sdg: ['sdg_13', 'sdg_13', ' sdg_14 ', '<x>', ''],
      attr_hub: 'Digital society',
      'attr_Bad-Key': 'x',
      attr_: 'x',
      attr_empty: '',
      attribute: 'x',
      kind: ['bip', 'BIP!'],
    });
    expect(state.attrs).toEqual({ hub: ['Digital society'], sdg: ['sdg_13', 'sdg_14'] });
    expect(state.kind).toEqual(['bip']);
  });

  it('accepts the deadline sort', () => {
    expect(parseSearchState({ sort: 'deadline' }).sort).toBe('deadline');
  });

  it('swaps an inverted ECTS range and caps the page', () => {
    const state = parseSearchState({ ects_min: '10', ects_max: '2', page: '9999' });
    expect([state.ectsMin, state.ectsMax]).toEqual([2, 10]);
    expect(state.page).toBe(500);
  });
});

describe('toRouteQuery / toApiQuery', () => {
  it('omits defaults so equal searches share one URL', () => {
    expect(toRouteQuery(emptySearchState())).toEqual({});
    expect(toRouteQuery({ ...emptySearchState(), sort: 'relevance', page: 1 })).toEqual({});
  });

  it('round-trips through the URL', () => {
    const query = {
      q: 'ai',
      partner: ['urv'],
      mode: ['online', 'coil'],
      lang: ['en'],
      isced: ['06'],
      level: ['bachelor'],
      kind: ['bip'],
      attr_educational_hub: ['sustainability'],
      attr_micro_credential: ['true'],
      ects_min: '3',
      ects_max: '6',
      upcoming: 'false',
      sort: 'deadline',
      page: '2',
    };
    expect(toRouteQuery(parseSearchState(query))).toEqual(query);
  });

  it('writes attribute filters after the list filters, keys sorted', () => {
    const state = parseSearchState({ attr_sdg: 'sdg_13', attr_free_course: 'true', kind: 'bip' });
    expect(Object.keys(toRouteQuery(state))).toEqual(['kind', 'attr_free_course', 'attr_sdg']);
    expect(queryString(toApiQuery(state))).toBe('?kind=bip&attr_free_course=true&attr_sdg=sdg_13');
  });

  it('uses the API parameter names (`upcoming=false` for past offerings)', () => {
    const state = { ...emptySearchState(), includePast: true, ectsMin: 5, lang: ['de'] };
    expect(toApiQuery(state)).toEqual({ lang: ['de'], ects_min: '5', upcoming: 'false' });
  });

  it('serialises repeated keys', () => {
    expect(queryString({ partner: ['a-b', 'c'], q: 'x y' })).toBe('?partner=a-b&partner=c&q=x+y');
    expect(queryString({})).toBe('');
  });
});

describe('state transitions', () => {
  const state = parseSearchState({ q: 'x', partner: ['urv', 'univie'], page: '4', sort: 'title' });

  it('removes one value and resets the page', () => {
    expect(withoutValue(state, 'partner', 'urv')).toMatchObject({ partner: ['univie'], page: 1 });
  });

  it('clears filters but keeps the text query and sort', () => {
    expect(withoutFilters({ ...state, includePast: true, ectsMax: 3 })).toEqual({
      ...emptySearchState(),
      q: 'x',
      sort: 'title',
    });
  });

  it('removes one attribute value, and the key with its last value', () => {
    const s = parseSearchState({
      attr_sdg: ['sdg_13', 'sdg_14'],
      attr_free_course: 'true',
      page: '3',
    });
    expect(withoutAttribute(s, 'sdg', 'sdg_13')).toMatchObject({
      attrs: { sdg: ['sdg_14'], free_course: ['true'] },
      page: 1,
    });
    expect(withoutAttribute(s, 'free_course', 'true').attrs).toEqual({
      sdg: ['sdg_13', 'sdg_14'],
    });
  });

  it('keeps only attribute filters the alliance schema offers', () => {
    const s = parseSearchState({
      attr_sdg: ['sdg_13', 'sdg_99'],
      attr_free_course: ['true', 'yes'],
      attr_faculty: 'Chemistry',
      attr_competence_framework: 'louis',
      attr_unknown: 'x',
    });
    expect(restrictAttributes(s, definitions).attrs).toEqual({
      sdg: ['sdg_13'],
      free_course: ['true'],
    });
    // Without definitions (reference unavailable) nothing can be checked.
    expect(restrictAttributes(s, undefined)).toBe(s);
    // An older API has no attribute schema: no attribute filter applies.
    expect(restrictAttributes(s, []).attrs).toEqual({});
  });

  it('changes page', () => {
    expect(withPage(state, 2).page).toBe(2);
  });

  it('counts active filters (not the text query)', () => {
    expect(activeFilterCount(state)).toBe(2);
    expect(activeFilterCount({ ...state, ectsMin: 1, ectsMax: 2, includePast: true })).toBe(5);
    expect(
      activeFilterCount({ ...state, kind: ['bip'], attrs: { sdg: ['a', 'b'], free: ['true'] } }),
    ).toBe(6);
  });

  it('clears attribute and kind filters with the others', () => {
    expect(withoutFilters({ ...state, kind: ['bip'], attrs: { sdg: ['sdg_13'] } })).toEqual({
      ...emptySearchState(),
      q: 'x',
      sort: 'title',
    });
  });

  it('reads the GET form and goes back to page 1', () => {
    const form = new FormData();
    form.append('q', 'law');
    form.append('partner', 'urv');
    form.append('partner', 'univie');
    form.append('ects_min', '');
    form.append('sort', 'relevance');
    form.append('upcoming', 'false');
    form.append('kind', 'bip');
    form.append('attr_sdg', 'sdg_13');
    form.append('attr_sdg', 'sdg_15');
    form.append('attr_free_course', 'true');
    expect(stateFromFormData(form)).toEqual({
      ...emptySearchState(),
      q: 'law',
      partner: ['urv', 'univie'],
      kind: ['bip'],
      attrs: { free_course: ['true'], sdg: ['sdg_13', 'sdg_15'] },
      includePast: true,
      sort: 'relevance',
    });
  });
});

describe('labels', () => {
  it('handles multilingual objects and plain strings', () => {
    expect(labelText({ en: 'Online', de: 'Online (de)' }, 'de')).toBe('Online (de)');
    expect(labelText({ en: 'Online' }, 'ca')).toBe('Online');
    expect(labelText('Hybrid', 'ca')).toBe('Hybrid');
    expect(labelText({ fr: 'En ligne' }, 'en')).toBe('En ligne');
    expect(labelText('', 'en')).toBeUndefined();
    expect(labelText(null, 'en')).toBeUndefined();
    expect(labelText(42 as unknown as string, 'en')).toBeUndefined();
  });

  it('names languages and countries in the UI locale', () => {
    expect(languageName('ca', 'en')).toBe('Catalan');
    expect(languageName('nl', 'en')).toBe('Dutch');
    expect(languageName('!!', 'en')).toBe('!!');
    expect(countryName('es', 'en')).toBe('Spain');
    expect(countryName(null, 'en')).toBeUndefined();
  });

  it('builds filter options from facets and keeps selected values', () => {
    const options = facetOptions(
      [
        { value: 'urv', count: 4 },
        { value: 'univie', count: 1, label: 'Vienna' },
      ],
      ['univie', 'vu-amsterdam'],
      (value, label) => labelText(label, 'en') ?? value.toUpperCase(),
    );
    expect(options).toEqual([
      { value: 'urv', count: 4, label: 'URV', checked: false },
      { value: 'univie', count: 1, label: 'Vienna', checked: true },
      { value: 'vu-amsterdam', count: 0, label: 'VU-AMSTERDAM', checked: true },
    ]);
    expect(facetOptions(undefined, [], (v) => v)).toEqual([]);
  });
});

describe('attributes, levels and instructions [DL 18]', () => {
  it('orders course attributes by the schema and drops empty ones', () => {
    const shuffled = [
      {
        key: 'zzz_unknown',
        label: { en: 'Unknown' },
        values: [{ value: 'a', label: { en: 'A' } }],
      },
      ...[...courseAttributes].reverse(),
      { key: 'sdg', label: { en: 'SDG' }, values: [] },
    ];
    expect(orderAttributes(shuffled, definitions).map((a) => a.key)).toEqual([
      'educational_hub',
      'sdg',
      'target_audience',
      'competence_framework',
      'micro_credential',
      'free_course',
      'only_enrolled',
      'faculty',
      'zzz_unknown',
    ]);
    expect(orderAttributes(undefined, definitions)).toEqual([]);
  });

  it('builds card tags from show_as_tag definitions only', () => {
    expect(attributeTags(courseAttributes, definitions, 'en')).toEqual([
      'Sustainability',
      'SDG 13: Climate action',
      'SDG 14: Life below water',
      'Micro-credential',
      'Free course',
    ]);
    // No definitions (reference unavailable or older API): no tags.
    expect(attributeTags(courseAttributes, undefined, 'en')).toEqual([]);
    expect(attributeTags(undefined, definitions, 'en')).toEqual([]);
  });

  it('reads levels, falling back to the single level of an older API', () => {
    expect(courseLevels({ levels: ['bachelor', 'master', 'master'], level: 'master' })).toEqual([
      'bachelor',
      'master',
    ]);
    expect(courseLevels({ level: 'doctoral' })).toEqual(['doctoral']);
    expect(courseLevels({ levels: [], level: null })).toEqual([]);
  });

  it('reads instructors defensively [DL 21]', () => {
    expect(
      courseInstructors({ instructors: [' Dr. Ada Lovelace ', '', 42, 'Prof. Alan Turing'] }),
    ).toEqual(['Dr. Ada Lovelace', 'Prof. Alan Turing']);
    expect(courseInstructors({})).toEqual([]);
    expect(courseInstructors({ instructors: null })).toEqual([]);
    expect(courseInstructors(undefined)).toEqual([]);
  });

  it('picks instructions in the text language, else English, else any', () => {
    const byLang = { en: 'Apply', ca: 'Sol·licita', de: '  ' };
    expect(textIn(byLang, 'ca')).toEqual({ value: 'Sol·licita', lang: 'ca' });
    expect(textIn(byLang, 'de')).toEqual({ value: 'Apply', lang: 'en' });
    expect(textIn({ nl: 'Aanmelden' }, 'en')).toEqual({ value: 'Aanmelden', lang: 'nl' });
    expect(textIn({}, 'en')).toBeUndefined();
    expect(textIn(null, 'en')).toBeUndefined();
  });
});

describe('dates', () => {
  it('formats calendar dates without a time-zone shift', () => {
    expect(formatDate('2027-02-08', 'en')).toBe('Feb 8, 2027');
    expect(formatDate(null, 'en')).toBeUndefined();
    expect(formatDate('not a date', 'en')).toBe('not a date');
  });

  it('formats timestamps as a date in a time zone', () => {
    expect(formatDateTimeAsDate('2026-10-10T23:30:00Z', 'en', 'Europe/Madrid')).toBe(
      'Oct 11, 2026',
    );
    expect(formatDateTimeAsDate('2026-10-10T23:30:00Z', 'en')).toBe('Oct 10, 2026');
    expect(formatDateTimeAsDate('2026-10-10T23:30:00Z', 'en', 'Not/AZone')).toBe('Oct 10, 2026');
    expect(formatDateTimeAsDate('garbage', 'en')).toBeUndefined();
  });

  it('computes today in the offering time zone', () => {
    const now = new Date('2026-10-14T23:30:00Z');
    expect(todayIn('UTC', now)).toBe('2026-10-14');
    expect(todayIn('Europe/Madrid', now)).toBe('2026-10-15');
    expect(todayIn('Bad/Zone', now)).toBe('2026-10-14');
  });

  it('treats the deadline day as open until it ends in the offering time zone', () => {
    const now = new Date('2026-10-14T21:30:00Z'); // 23:30 in Madrid, 06:30 next day in Tokyo
    expect(isDeadlinePassed('2026-10-14', 'Europe/Madrid', now)).toBe(false);
    expect(isDeadlinePassed('2026-10-14', 'Asia/Tokyo', now)).toBe(true);
    expect(isDeadlinePassed('2026-10-13', 'Europe/Madrid', now)).toBe(true);
    expect(isDeadlinePassed(null, 'Europe/Madrid', now)).toBe(false);
  });
});

describe('seatsInfo [DL 8]', () => {
  const asOf = '2026-10-10T06:00:00Z';

  it('reports both available and alliance seats when both are set', () => {
    expect(seatsInfo({ seats_available: 12, seats_updated_at: asOf, alliance_seats: 5 })).toEqual({
      available: { seats: 12, asOf },
      alliance: { seats: 5 },
    });
  });

  it('reports available seats only with their timestamp', () => {
    expect(seatsInfo({ seats_available: 0, seats_updated_at: asOf, alliance_seats: null })).toEqual(
      { available: { seats: 0, asOf }, alliance: null },
    );
    expect(seatsInfo({ seats_available: 12, seats_updated_at: null, alliance_seats: 5 })).toEqual({
      available: null,
      alliance: { seats: 5 },
    });
  });

  it('reports alliance seats on their own', () => {
    expect(seatsInfo({ seats_available: null, seats_updated_at: asOf, alliance_seats: 0 })).toEqual(
      { available: null, alliance: { seats: 0 } },
    );
  });

  it('says nothing otherwise', () => {
    expect(seatsInfo({ seats_available: 3, seats_updated_at: null, alliance_seats: null })).toBe(
      null,
    );
    expect(seatsInfo(null)).toBeNull();
  });
});

describe('links', () => {
  it('accepts only web URLs and plain e-mail addresses', () => {
    expect(urlHost('https://apply.urv.cat/x?y=1')).toBe('apply.urv.cat');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('ftp://example.org')).toBeUndefined();
    expect(safeHttpUrl('not a url')).toBeUndefined();
    expect(safeEmail('international@urv.cat')).toBe('international@urv.cat');
    expect(safeEmail('a@b')).toBeUndefined();
    expect(safeEmail('x@y.z?subject=<b>')).toBeUndefined();
  });

  it('returns only to a catalogue list of the same origin', () => {
    const origin = 'https://oecp.localhost';
    expect(catalogueBackPath('/en/courses?partner=urv&page=2', '/en/courses', origin)).toBe(
      '/en/courses?partner=urv&page=2',
    );
    expect(catalogueBackPath(`${origin}/en/courses/`, '/en/courses', origin)).toBe('/en/courses/');
    expect(catalogueBackPath('https://evil.example/en/courses', '/en/courses', origin)).toBe(
      undefined,
    );
    expect(catalogueBackPath('/en/courses/123', '/en/courses', origin)).toBeUndefined();
    expect(catalogueBackPath('', '/en/courses', origin)).toBeUndefined();
  });
});

describe('courseJsonLd', () => {
  const detail = course as unknown as CourseDetail;
  const url = 'https://oecp.localhost/en/courses/6f1d2c3b-0000-4000-8000-000000000001';

  it('describes the course and its instances', () => {
    const ld = courseJsonLd(detail, { url, locale: 'en', courseModes: { hybrid: 'Blended' } });
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: 'Climate Change and Mediterranean Ecosystems',
      courseCode: 'URV-20345',
      url,
      inLanguage: ['en', 'ca'],
      provider: {
        '@type': 'CollegeOrUniversity',
        name: 'Universitat Rovira i Virgili',
        address: { addressCountry: 'ES' },
      },
      numberOfCredits: { '@type': 'StructuredValue', value: 6, unitText: 'ECTS' },
      educationalLevel: ['bachelor', 'master'],
      dateModified: '2026-10-12T09:30:00Z',
    });
    const instances = ld.hasCourseInstance as Record<string, unknown>[];
    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({
      '@type': 'CourseInstance',
      courseMode: ['Online', 'Blended'],
      startDate: '2027-02-08',
      location: { '@type': 'Place', name: 'Campus Catalunya, Tarragona' },
      url: 'https://apply.urv.cat/aurora/20345',
    });
    expect(instances[1]).not.toHaveProperty('location');
  });

  it('names no instructor when the API sends none', () => {
    const { instructors: _i, ...old } = detail;
    const instances = courseJsonLd(old as CourseDetail, { url, locale: 'en' })
      .hasCourseInstance as Record<string, unknown>[];
    expect(instances[0]).not.toHaveProperty('instructor');
  });

  it('uses the single level of an older API', () => {
    const { levels: _levels, ...old } = detail;
    expect(courseJsonLd(old as CourseDetail, { url, locale: 'en' }).educationalLevel).toBe(
      'master',
    );
  });

  it('leaves out cancelled offerings', () => {
    const cancelled = {
      ...detail,
      offerings: detail.offerings.map((o, i) => (i === 0 ? { ...o, status: 'cancelled' } : o)),
    } as CourseDetail;
    expect(courseJsonLd(cancelled, { url, locale: 'en' }).hasCourseInstance).toHaveLength(1);
  });

  it('cannot close its script element', () => {
    const json = serializeJsonLd({ a: '</script><script>alert(1)</script>&' });
    expect(json).not.toMatch(/[<>&]/);
    expect(JSON.parse(json)).toEqual({ a: '</script><script>alert(1)</script>&' });
  });
});

describe('robots.txt', () => {
  it('allows the catalogue, hides the admin area and points to the sitemap', async () => {
    const { robotsTxt } = await import('../server/utils/seo-files');
    const body = robotsTxt('https://oecp.localhost/');
    expect(body.split('\n')).toEqual([
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /*/admin',
      'Disallow: /api/admin',
      '',
      'Sitemap: https://oecp.localhost/sitemap.xml',
      '',
    ]);
  });
});
