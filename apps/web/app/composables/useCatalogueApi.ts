// SPDX-License-Identifier: EUPL-1.2
// Typed access to the anonymous catalogue API (spec §7) over `useApi()`, which
// already picks the internal origin during SSR. Responses are normalised
// defensively (missing arrays become empty) so a partial API never breaks a page.
import type {
  CourseCard,
  CourseDetail,
  CourseSearchResponse,
  FacetName,
  ReferenceData,
  SearchFacets,
  SearchState,
  SuggestResponse,
} from '../types/catalogue';
import { toApiQuery } from '../utils/catalogue';

export const CATALOGUE_PATHS = {
  courses: '/api/public/v1/courses',
  suggest: '/api/public/v1/suggest',
  reference: '/api/public/v1/reference',
} as const;

const FACET_NAMES: readonly FacetName[] = ['partner', 'mode', 'lang', 'isced', 'level'];

type Fetcher = <T>(
  url: string,
  options?: { query?: Record<string, unknown>; signal?: AbortSignal; timeout?: number },
) => Promise<T>;

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCard(raw: CourseCard): CourseCard {
  return {
    ...raw,
    isced_broad_fields: array(raw.isced_broad_fields),
    delivery_modes: array(raw.delivery_modes),
    teaching_languages: array(raw.teaching_languages),
    next_offering: raw.next_offering ?? null,
    offerings_count: typeof raw.offerings_count === 'number' ? raw.offerings_count : 0,
  };
}

export function normalizeSearchResponse(raw: unknown): CourseSearchResponse {
  const body = isRecord(raw) ? raw : {};
  const facetsIn = isRecord(body.facets) ? body.facets : {};
  const facets = Object.fromEntries(
    FACET_NAMES.map((name) => [name, array(facetsIn[name])]),
  ) as unknown as SearchFacets;
  const items = array<CourseCard>(body.items).map(normalizeCard);
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    items,
    page: num(body.page, 1),
    page_size: num(body.page_size, 20) || 20,
    total: num(body.total, items.length),
    facets,
  };
}

export function normalizeCourse(raw: CourseDetail): CourseDetail {
  return {
    ...raw,
    texts: isRecord(raw.texts) ? raw.texts : {},
    isced_codes: array(raw.isced_codes),
    offerings: array<CourseDetail['offerings'][number]>(raw.offerings).map((o) => ({
      ...o,
      teaching_languages: array(o.teaching_languages),
      delivery_modes: array(o.delivery_modes),
    })),
  };
}

export function normalizeReference(raw: unknown): ReferenceData {
  const body = isRecord(raw) ? raw : {};
  return {
    organizations: array(body.organizations),
    delivery_modes: array(body.delivery_modes),
    isced_broad_fields: array(body.isced_broad_fields),
    teaching_languages: array(body.teaching_languages),
    levels: array(body.levels),
  };
}

/** HTTP status of a failed `$fetch` call (0 for network errors and timeouts). */
export function fetchErrorStatus(error: unknown): number {
  if (!isRecord(error)) return 0;
  const status = error.statusCode ?? error.status;
  return typeof status === 'number' ? status : 0;
}

/**
 * Status the page answers with when the API fails: 404 stays 404 (unknown
 * course), everything else (501 while the API is being built, 5xx, network)
 * becomes 503 "catalogue temporarily unavailable".
 */
export function catalogueErrorStatus(error: unknown): 404 | 503 {
  return fetchErrorStatus(error) === 404 ? 404 : 503;
}

export function createCatalogueApi(fetcher: Fetcher, uiLanguage = 'en') {
  // Display language of resolved texts and labels. English is the API default,
  // so it is only sent for other UI locales (keeps URLs and caches simple).
  const locale: Record<string, string> = uiLanguage === 'en' ? {} : { locale: uiLanguage };
  return {
    async search(state: SearchState, extra: { page_size?: number; timeout?: number } = {}) {
      const query: Record<string, unknown> = { ...toApiQuery(state), ...locale };
      if (extra.page_size) query.page_size = extra.page_size;
      const raw = await fetcher<unknown>(CATALOGUE_PATHS.courses, {
        query,
        ...(extra.timeout ? { timeout: extra.timeout } : {}),
      });
      return normalizeSearchResponse(raw);
    },
    async course(id: string) {
      const raw = await fetcher<CourseDetail>(
        `${CATALOGUE_PATHS.courses}/${encodeURIComponent(id)}`,
        { query: locale },
      );
      return normalizeCourse(raw);
    },
    async suggest(q: string, signal?: AbortSignal) {
      const raw = await fetcher<SuggestResponse>(CATALOGUE_PATHS.suggest, {
        query: { q, ...locale },
        ...(signal ? { signal } : {}),
      });
      return array<SuggestResponse['items'][number]>(raw?.items);
    },
    async reference(extra: { timeout?: number } = {}) {
      const raw = await fetcher<unknown>(CATALOGUE_PATHS.reference, {
        query: locale,
        ...(extra.timeout ? { timeout: extra.timeout } : {}),
      });
      return normalizeReference(raw);
    },
  };
}

export type CatalogueApi = ReturnType<typeof createCatalogueApi>;

/**
 * Catalogue API client in the UI locale. The display language parameter is
 * `locale`; on `/courses`, `lang` is the teaching-language filter.
 */
export function useCatalogueApi(): CatalogueApi {
  const { locale } = useI18n();
  return createCatalogueApi(useApi() as Fetcher, locale.value);
}
