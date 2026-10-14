// SPDX-License-Identifier: EUPL-1.2
// Pure helpers of the public catalogue (spec §7): URL state, API query mapping,
// label resolution, dates and the seats rule [DL 8]. No Nuxt imports, so they
// are unit-testable in Node.
import type {
  FacetValue,
  Label,
  ListFilter,
  NextOffering,
  Offering,
  SearchState,
  SortOrder,
} from '../types/catalogue';
import { pickLocalized } from './localized';

/** Query value as found in a vue-router `LocationQuery`. */
type QueryValue = string | null | undefined | readonly (string | null)[];
export type QueryLike = Readonly<Record<string, QueryValue>>;

export const LIST_FILTERS: readonly ListFilter[] = ['partner', 'mode', 'lang', 'isced', 'level'];
export const SORT_ORDERS: readonly SortOrder[] = ['relevance', 'title', 'start_date'];
export const ECTS_MAX = 120;
export const PAGE_MAX = 500;
const LIST_MAX = 50;

/** Shapes accepted per list filter, matching `courseSearchQuery` in @oecp/schemas. */
const LIST_PATTERNS: Readonly<Record<ListFilter, RegExp>> = {
  partner: /^[a-z0-9-]{2,40}$/,
  mode: /^(x-)?[a-z][a-z0-9_-]*$/,
  lang: /^[a-z]{2,3}$/,
  isced: /^\d{2}$/,
  level: /^[a-z][a-z0-9_]*$/,
};

export function emptySearchState(): SearchState {
  return {
    q: '',
    partner: [],
    mode: [],
    lang: [],
    isced: [],
    level: [],
    ectsMin: null,
    ectsMax: null,
    includePast: false,
    sort: null,
    page: 1,
  };
}

function values(value: QueryValue): string[] {
  if (value === null || value === undefined) return [];
  const list = typeof value === 'string' ? [value] : value;
  return list.filter((v): v is string => typeof v === 'string');
}

function first(value: QueryValue): string | undefined {
  return values(value)[0];
}

function parseEcts(value: QueryValue): number | null {
  const raw = first(value)?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= ECTS_MAX ? n : null;
}

/**
 * Reads the search state from the page URL. Unknown or malformed values are
 * dropped silently (the URL is user input), so the API never sees them.
 */
export function parseSearchState(query: QueryLike): SearchState {
  const state = emptySearchState();
  state.q = (first(query.q) ?? '').trim().slice(0, 200);
  for (const key of LIST_FILTERS) {
    const pattern = LIST_PATTERNS[key];
    const seen = new Set<string>();
    for (const v of values(query[key])) {
      const value = v.trim();
      if (pattern.test(value)) seen.add(value);
      if (seen.size >= LIST_MAX) break;
    }
    state[key] = [...seen];
  }
  state.ectsMin = parseEcts(query.ects_min);
  state.ectsMax = parseEcts(query.ects_max);
  if (state.ectsMin !== null && state.ectsMax !== null && state.ectsMin > state.ectsMax) {
    [state.ectsMin, state.ectsMax] = [state.ectsMax, state.ectsMin];
  }
  state.includePast = first(query.upcoming) === 'false';
  const sort = first(query.sort);
  state.sort = SORT_ORDERS.includes(sort as SortOrder) ? (sort as SortOrder) : null;
  const page = Number(first(query.page));
  state.page = Number.isInteger(page) && page >= 1 ? Math.min(page, PAGE_MAX) : 1;
  return state;
}

/**
 * Query string of the catalogue page for a state: only non-default values, in a
 * stable order, so equal searches share one URL.
 */
export function toRouteQuery(state: SearchState): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  if (state.q) query.q = state.q;
  for (const key of LIST_FILTERS) {
    if (state[key].length) query[key] = [...state[key]];
  }
  if (state.ectsMin !== null) query.ects_min = String(state.ectsMin);
  if (state.ectsMax !== null) query.ects_max = String(state.ectsMax);
  if (state.includePast) query.upcoming = 'false';
  if (state.sort && state.sort !== 'relevance') query.sort = state.sort;
  if (state.page > 1) query.page = String(state.page);
  return query;
}

/**
 * Query of `GET /api/public/v1/courses`. The page URL deliberately uses the API
 * parameter names, so this is the route query plus anything the API needs
 * explicitly. Arrays are sent as repeated keys (`partner=a&partner=b`).
 */
export function toApiQuery(state: SearchState): Record<string, string | string[]> {
  return toRouteQuery(state);
}

/** Query string (`?a=b&…`, or '') of a route query, for plain `href`s. */
export function queryString(query: Record<string, string | string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** The state without one list value (filter chip removal); back to page 1. */
export function withoutValue(state: SearchState, key: ListFilter, value: string): SearchState {
  return { ...state, [key]: state[key].filter((v) => v !== value), page: 1 };
}

export function withPage(state: SearchState, page: number): SearchState {
  return { ...state, page };
}

/** Same search with every filter cleared; keeps the text query and sort. */
export function withoutFilters(state: SearchState): SearchState {
  return { ...emptySearchState(), q: state.q, sort: state.sort };
}

export function activeFilterCount(state: SearchState): number {
  return (
    LIST_FILTERS.reduce((n, key) => n + state[key].length, 0) +
    (state.ectsMin !== null ? 1 : 0) +
    (state.ectsMax !== null ? 1 : 0) +
    (state.includePast ? 1 : 0)
  );
}

/** Reads a search form (`FormData` of the catalogue form) into a state, page 1. */
export function stateFromFormData(form: FormData): SearchState {
  const query: Record<string, string[]> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue;
    (query[key] ??= []).push(value);
  }
  return { ...parseSearchState(query), page: 1 };
}

// ---------------------------------------------------------------------------
// Labels, languages, countries

/**
 * Text of a label in the UI locale. Labels are multilingual objects (English
 * fallback) or plain strings; anything else yields `undefined`.
 */
export function labelText(label: Label | null | undefined, locale: string): string | undefined {
  if (typeof label === 'string') return label || undefined;
  if (!label || typeof label !== 'object') return undefined;
  const picked = pickLocalized(label, locale)?.value;
  if (typeof picked === 'string' && picked) return picked;
  const any = Object.values(label).find((v) => typeof v === 'string' && v);
  return any;
}

function displayName(type: 'language' | 'region', code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale, 'en'], { type, fallback: 'none' }).of(code);
    if (name)
      return type === 'language' ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : name;
  } catch {
    // Malformed code: show it as is.
  }
  return code;
}

/** Name of a language code (`ca` → "Catalan") in the UI locale. */
export function languageName(code: string, locale: string): string {
  return displayName('language', code, locale);
}

/** Name of an ISO 3166-1 alpha-2 country code in the UI locale. */
export function countryName(code: string | null | undefined, locale: string): string | undefined {
  return code ? displayName('region', code.toUpperCase(), locale) : undefined;
}

/**
 * Options of a filter group: facet values (with counts) plus any selected value
 * the facets no longer return (count 0), so a checked box never disappears.
 * Options with neither count nor selection are dropped.
 */
export function facetOptions(
  facet: readonly FacetValue[] | undefined,
  selected: readonly string[],
  label: (value: string, facetLabel: Label | undefined) => string,
): { value: string; count: number | null; label: string; checked: boolean }[] {
  const options = (facet ?? []).map((f) => ({
    value: f.value,
    count: typeof f.count === 'number' ? f.count : null,
    label: label(f.value, f.label),
    checked: selected.includes(f.value),
  }));
  for (const value of selected) {
    if (!options.some((o) => o.value === value)) {
      options.push({ value, count: 0, label: label(value, undefined), checked: true });
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Dates

/** Formats a calendar date `YYYY-MM-DD` without shifting it across time zones. */
export function formatDate(date: string | null | undefined, locale: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

/**
 * Date part of an ISO date-time, in `timeZone` (default UTC so that server and
 * browser render the same text).
 */
export function formatDateTimeAsDate(
  value: string | null | undefined,
  locale: string,
  timeZone = 'UTC',
): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
  }
}

/** Today as `YYYY-MM-DD` in an IANA time zone (UTC when unknown). */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  const format = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return format(timeZone || 'UTC');
  } catch {
    return format('UTC');
  }
}

/** A deadline date has passed once its whole day is over in the offering time zone. */
export function isDeadlinePassed(
  deadline: string | null | undefined,
  timeZone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return !!deadline && deadline.slice(0, 10) < todayIn(timeZone, now);
}

// ---------------------------------------------------------------------------
// Seats [DL 8]

/** What to say about seats; `null` when there is nothing to say. */
export interface SeatsInfo {
  /** Set only when the partner reported both the count and when it was taken. */
  available: { seats: number; asOf: string } | null;
  /** Seats reserved for students of the alliance. */
  alliance: { seats: number } | null;
}

type SeatFields = Pick<
  NextOffering | Offering,
  'seats_available' | 'alliance_seats' | 'seats_updated_at'
>;

/**
 * Seats rule [DL 8] (spec §7): "Seats available: N (as of date)" when the
 * partner reported both the count and its timestamp, "Alliance seats: N" when
 * seats are reserved for the alliance, both when both are set, nothing
 * otherwise. Remaining alliance seats are never computed.
 */
export function seatsInfo(offering: SeatFields | null | undefined): SeatsInfo | null {
  if (!offering) return null;
  const { seats_available: available, seats_updated_at: asOf, alliance_seats: alliance } = offering;
  const info: SeatsInfo = {
    available:
      typeof available === 'number' && available >= 0 && asOf ? { seats: available, asOf } : null,
    alliance: typeof alliance === 'number' && alliance >= 0 ? { seats: alliance } : null,
  };
  return info.available || info.alliance ? info : null;
}

// ---------------------------------------------------------------------------
// Misc

/** Host name of an http(s) URL, for "Apply at {host}" (undefined if not a web URL). */
export function urlHost(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : undefined;
  } catch {
    return undefined;
  }
}

/** Only http(s) links are rendered as `href` (no `javascript:` from partner data). */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  return urlHost(url) ? (url as string) : undefined;
}

/** Plain e-mail address check before building a `mailto:` link. */
export function safeEmail(email: string | null | undefined): string | undefined {
  return email && /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(email) ? email : undefined;
}

/**
 * Previous catalogue URL to return to, from `history.state.back` or the
 * referrer: only a same-origin path to the catalogue list of this locale.
 */
export function catalogueBackPath(
  candidate: string | null | undefined,
  listPath: string,
  origin: string,
): string | undefined {
  if (!candidate) return undefined;
  let url: URL;
  try {
    url = new URL(candidate, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin || url.pathname.replace(/\/$/, '') !== listPath) return undefined;
  return `${url.pathname}${url.search}`;
}
