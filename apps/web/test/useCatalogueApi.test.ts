// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it, vi } from 'vitest';
import {
  CATALOGUE_PATHS,
  catalogueErrorStatus,
  createCatalogueApi,
  fetchErrorStatus,
  normalizeCourse,
  normalizeReference,
  normalizeSearchResponse,
} from '../app/composables/useCatalogueApi';
import type { CourseDetail } from '../app/types/catalogue';
import { emptySearchState, parseSearchState } from '../app/utils/catalogue';
import search from './fixtures/catalogue/search.json';

function fakeFetch(response: unknown = {}) {
  return vi.fn(async (_url: string, _options?: Record<string, unknown>) => response) as never as <
    T,
  >(
    url: string,
    options?: Record<string, unknown>,
  ) => Promise<T>;
}

describe('createCatalogueApi', () => {
  it('searches with the URL state mapped to API parameters', async () => {
    const fetcher = fakeFetch(search);
    const api = createCatalogueApi(fetcher);
    const result = await api.search(
      parseSearchState({ partner: ['urv', 'univie'], upcoming: 'false', ects_max: '6', page: '2' }),
    );
    expect(fetcher).toHaveBeenCalledWith(CATALOGUE_PATHS.courses, {
      query: { partner: ['urv', 'univie'], ects_max: '6', upcoming: 'false', page: '2' },
    });
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it('passes page_size and a timeout when asked', async () => {
    const fetcher = fakeFetch(search);
    await createCatalogueApi(fetcher).search(emptySearchState(), { page_size: 1, timeout: 3000 });
    expect(fetcher).toHaveBeenCalledWith(CATALOGUE_PATHS.courses, {
      query: { page_size: 1 },
      timeout: 3000,
    });
  });

  it('sends the display locale only when it is not English', async () => {
    const en = fakeFetch({ items: [] });
    await createCatalogueApi(en, 'en').suggest('cli');
    expect(en).toHaveBeenCalledWith(CATALOGUE_PATHS.suggest, { query: { q: 'cli' } });

    const ca = fakeFetch(search);
    const api = createCatalogueApi(ca, 'ca');
    await api.search(parseSearchState({ lang: 'en' }));
    await api.reference();
    expect(ca).toHaveBeenNthCalledWith(1, CATALOGUE_PATHS.courses, {
      query: { lang: ['en'], locale: 'ca' },
    });
    expect(ca).toHaveBeenNthCalledWith(2, CATALOGUE_PATHS.reference, {
      query: { locale: 'ca' },
    });
  });

  it('encodes the course id and forwards the abort signal of suggestions', async () => {
    const fetcher = fakeFetch({ id: 'x', texts: {}, isced_codes: [], offerings: [] });
    const api = createCatalogueApi(fetcher);
    await api.course('a/b');
    expect(fetcher).toHaveBeenCalledWith(`${CATALOGUE_PATHS.courses}/a%2Fb`, { query: {} });
    const controller = new AbortController();
    await api.suggest('ab', controller.signal);
    expect(fetcher).toHaveBeenLastCalledWith(CATALOGUE_PATHS.suggest, {
      query: { q: 'ab' },
      signal: controller.signal,
    });
  });

  it('returns no suggestions for a malformed body', async () => {
    expect(await createCatalogueApi(fakeFetch(null)).suggest('ab')).toEqual([]);
  });
});

describe('normalisation', () => {
  it('fills missing arrays, facets and paging', () => {
    const result = normalizeSearchResponse({
      items: [{ id: '1', title: 'T', ects: 3 }],
      facets: { partner: [{ value: 'urv', count: 1 }] },
    });
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.total).toBe(1);
    expect(result.facets).toEqual({
      partner: [{ value: 'urv', count: 1 }],
      mode: [],
      lang: [],
      isced: [],
      level: [],
    });
    expect(result.items[0]).toMatchObject({
      isced_broad_fields: [],
      delivery_modes: [],
      teaching_languages: [],
      next_offering: null,
      offerings_count: 0,
    });
    expect(normalizeSearchResponse('nonsense').items).toEqual([]);
  });

  it('normalises course and reference bodies', () => {
    const course = normalizeCourse({
      id: '1',
      offerings: [{ id: 'o' }],
    } as unknown as CourseDetail);
    expect(course.texts).toEqual({});
    expect(course.isced_codes).toEqual([]);
    expect(course.offerings[0]).toMatchObject({ teaching_languages: [], delivery_modes: [] });
    expect(normalizeReference(undefined)).toEqual({
      organizations: [],
      delivery_modes: [],
      isced_broad_fields: [],
      teaching_languages: [],
      levels: [],
    });
  });
});

describe('error mapping', () => {
  it('maps API failures to the page status', () => {
    expect(fetchErrorStatus({ statusCode: 501 })).toBe(501);
    expect(fetchErrorStatus({ status: 404 })).toBe(404);
    expect(fetchErrorStatus(new Error('network'))).toBe(0);
    expect(catalogueErrorStatus({ statusCode: 404 })).toBe(404);
    for (const status of [400, 500, 501, 502, 503, 504, 0]) {
      expect(catalogueErrorStatus({ statusCode: status })).toBe(503);
    }
    expect(catalogueErrorStatus(undefined)).toBe(503);
  });
});
