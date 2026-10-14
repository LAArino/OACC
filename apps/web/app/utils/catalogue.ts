// SPDX-License-Identifier: EUPL-1.2
// Pure helpers of the public catalogue (spec §7): URL state, API query mapping,
// label resolution, dates and the seats rule [DL 8]. No Nuxt imports, so they
// are unit-testable in Node.
import type {
  AttributeDefinition,
  CourseAttribute,
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

export const LIST_FILTERS: readonly ListFilter[] = [
  'partner',
  'mode',
  'lang',
  'isced',
  'level',
  'kind',
];
export const SORT_ORDERS: readonly SortOrder[] = ['relevance', 'title', 'start_date', 'deadline'];
/** Query parameter prefix of attribute filters [DL 18]: `attr_<key>=<value>`. */
export const ATTR_PREFIX = 'attr_';
const ATTR_KEYS_MAX = 20;
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
  kind: /^[a-z][a-z0-9_]*$/,
};
/** Attribute keys: definition keys of the alliance schema (as `ATTRIBUTE_FILTER_PARAM`). */
const ATTR_KEY = /^[a-z][a-z0-9_]{1,39}$/;
/**
 * Attribute values: option values or `true`. Their grammar is not part of the
 * contract, so anything printable up to 100 characters is accepted (no
 * control characters or markup-significant characters).
 */
const ATTR_VALUE = /^[^\p{Cc}<>"&]{1,100}$/u;

export function emptySearchState(): SearchState {
  return {
    q: '',
    partner: [],
    mode: [],
    lang: [],
    isced: [],
    level: [],
    kind: [],
    attrs: {},
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

/** `attr_<key>` parameters of a query, keys sorted, values deduplicated. */
function parseAttributes(query: QueryLike): Record<string, string[]> {
  const attrs: Record<string, string[]> = {};
  const keys = Object.keys(query)
    .filter((k) => k.startsWith(ATTR_PREFIX) && ATTR_KEY.test(k.slice(ATTR_PREFIX.length)))
    .sort();
  for (const param of keys.slice(0, ATTR_KEYS_MAX)) {
    const seen = new Set<string>();
    for (const v of values(query[param])) {
      const value = v.trim();
      if (ATTR_VALUE.test(value)) seen.add(value);
      if (seen.size >= LIST_MAX) break;
    }
    if (seen.size) attrs[param.slice(ATTR_PREFIX.length)] = [...seen];
  }
  return attrs;
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
  state.attrs = parseAttributes(query);
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
  for (const key of Object.keys(state.attrs).sort()) {
    const list = state.attrs[key];
    if (list?.length) query[`${ATTR_PREFIX}${key}`] = [...list];
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

/** The state without one attribute filter value (chip removal); back to page 1. */
export function withoutAttribute(state: SearchState, key: string, value: string): SearchState {
  const attrs = { ...state.attrs };
  const rest = (attrs[key] ?? []).filter((v) => v !== value);
  if (rest.length) attrs[key] = rest;
  else delete attrs[key];
  return { ...state, attrs, page: 1 };
}

/**
 * Keeps only the attribute filters the alliance schema offers: known filterable
 * keys, `true` for booleans and listed options for enums. Without definitions
 * (`/reference` unavailable) the state is returned unchanged; an empty list of
 * definitions (older API) drops every attribute filter.
 */
export function restrictAttributes(
  state: SearchState,
  definitions: readonly AttributeDefinition[] | null | undefined,
): SearchState {
  if (!definitions) return state;
  const attrs: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(state.attrs)) {
    const def = definitions.find((d) => d.key === key);
    if (!def?.filterable || def.value_type === 'text') continue;
    const allowed =
      def.value_type === 'boolean'
        ? list.filter((v) => v === 'true')
        : def.options
          ? list.filter((v) => def.options!.some((o) => o.value === v))
          : list;
    if (allowed.length) attrs[key] = allowed;
  }
  return { ...state, attrs };
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
    Object.values(state.attrs).reduce((n, list) => n + list.length, 0) +
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
// Attributes, levels, instructions [DL 18]

/**
 * Course attributes in the order of the alliance schema (`sort_order`, then
 * key); attributes without a definition keep their order, after the others.
 * Attributes without values are dropped.
 */
export function orderAttributes(
  attributes: readonly CourseAttribute[] | null | undefined,
  definitions: readonly AttributeDefinition[] | null | undefined,
): CourseAttribute[] {
  const list = (Array.isArray(attributes) ? attributes : []).filter(
    (a) => a && typeof a.key === 'string' && Array.isArray(a.values) && a.values.length,
  );
  const rank = (key: string) => {
    const def = definitions?.find((d) => d.key === key);
    return def ? def.sort_order : Number.POSITIVE_INFINITY;
  };
  return list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a.key) - rank(y.a.key) || x.i - y.i)
    .map((x) => x.a);
}

/**
 * Tags of a search card: the attributes whose definition has `show_as_tag`,
 * in schema order. A boolean shows its definition label, other types one tag
 * per value label. Without definitions there are no tags.
 */
export function attributeTags(
  attributes: readonly CourseAttribute[] | null | undefined,
  definitions: readonly AttributeDefinition[] | null | undefined,
  locale: string,
): string[] {
  const tags: string[] = [];
  for (const attribute of orderAttributes(attributes, definitions)) {
    const def = definitions?.find((d) => d.key === attribute.key);
    if (!def?.show_as_tag) continue;
    if (def.value_type === 'boolean') {
      if (attribute.values.some((v) => v.value === 'true')) {
        tags.push(labelText(attribute.label, locale) ?? labelText(def.label, locale) ?? def.key);
      }
      continue;
    }
    for (const v of attribute.values) tags.push(labelText(v.label, locale) ?? v.value);
  }
  return [...new Set(tags)];
}

/** Levels of a course: `levels` when sent (newer API), else the single `level`. */
export function courseLevels(course: {
  levels?: readonly string[] | null;
  level?: string | null;
}): string[] {
  const levels = Array.isArray(course.levels)
    ? course.levels.filter((l): l is string => typeof l === 'string' && !!l)
    : [];
  if (levels.length) return [...new Set(levels)];
  return course.level ? [course.level] : [];
}

/**
 * Instructor names of a course [DL 21]: trimmed, blanks dropped; empty when the
 * API does not send `instructors` (older API) or sends something else.
 */
export function courseInstructors(
  course: { instructors?: readonly unknown[] | null } | null | undefined,
): string[] {
  const list = Array.isArray(course?.instructors) ? course.instructors : [];
  return list
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Text of a `{lang: text}` record in `lang`, else English, else any language
 * (empty texts are skipped). `lang` of the result says which one it is.
 */
export function textIn(
  byLang: Readonly<Record<string, string>> | null | undefined,
  lang: string,
): { value: string; lang: string } | undefined {
  if (!byLang || typeof byLang !== 'object') return undefined;
  const primary = lang.split('-')[0]?.toLowerCase() ?? 'en';
  const order = [primary, 'en', ...Object.keys(byLang).sort()];
  for (const key of order) {
    const value = byLang[key];
    if (typeof value === 'string' && value.trim()) return { value, lang: key };
  }
  return undefined;
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
