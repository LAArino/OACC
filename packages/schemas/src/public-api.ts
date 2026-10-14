// SPDX-License-Identifier: EUPL-1.2
/** Query contracts of the anonymous APIs (spec §7 and §9). */
import { z } from 'zod';
import { courseKind, courseLevel } from './enums.js';
import { OEAPI_V5_LEVELS, OEAPI_V5_MODES_OF_DELIVERY } from './oeapi-v5.js';
import { deliveryModeCode, primaryLanguage, slug } from './primitives.js';

const list = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(item).max(50));

const ects = z.coerce.number().positive().max(120);
const booleanFlag = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Results per page of `GET /api/public/v1/courses` (spec §7). */
export const COURSE_SEARCH_PAGE_SIZE = 20;

/** `attr_<key>` query parameters of `GET /api/public/v1/courses`; the key is group 1. */
export const ATTRIBUTE_FILTER_PARAM = /^attr_([a-z][a-z0-9_]{1,39})$/;
/** Distinct `attr_<key>` parameters per request. */
export const MAX_ATTRIBUTE_FILTERS = 20;

/** Moves `attr_<key>` parameters into `attributes: {key: value | value[]}`. */
function collectAttributeFilters(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    const match = ATTRIBUTE_FILTER_PARAM.exec(name);
    if (match) attributes[match[1] as string] = value;
    else if (name !== 'attributes') out[name] = value;
  }
  out['attributes'] = attributes;
  return out;
}

/**
 * `GET /api/public/v1/courses`. Repeated parameters (`partner=a&partner=b`) are
 * OR-ed within a filter and AND-ed across filters (spec §7).
 *
 * - `lang` filters by **teaching language** (primary subtag of an offering's
 *   `teaching_languages`); the display language of resolved texts is `locale`.
 * - `ectsMin`/`ectsMax` and the aliases `ects_min`/`ects_max` bound `ects` inclusively.
 * - `upcoming` (default `true`): only courses with a published offering whose
 *   `end_date` is today or later; `upcoming=false` lists every published course.
 *   `includeUnscheduled=true` is the older spelling of `upcoming=false`; `upcoming`
 *   wins when both are given. Use {@link normalizeCourseSearch} to resolve them.
 * - `level` matches any of a course's `levels`; `kind` filters by course kind.
 * - `attr_<key>=<value>` (repeatable) filters by alliance attribute: values OR-ed
 *   within a key, keys AND-ed. Booleans take `true` or `false`; `enum`/`multi_enum`
 *   an option value. Parsed into `attributes`; keys without a definition are ignored.
 * - `sort=deadline`: next upcoming `application_deadline` first, courses without one last.
 */
export const courseSearchQuery = z.preprocess(
  collectAttributeFilters,
  z.object({
    q: z.string().trim().max(200).optional(),
    partner: list(slug),
    mode: list(deliveryModeCode),
    ectsMin: ects.optional(),
    ectsMax: ects.optional(),
    /** Alias of `ectsMin`. */
    ects_min: ects.optional(),
    /** Alias of `ectsMax`. */
    ects_max: ects.optional(),
    lang: list(primaryLanguage),
    isced: list(z.string().regex(/^\d{2}$/)),
    level: list(courseLevel),
    kind: list(courseKind),
    /** From the `attr_<key>` parameters. */
    attributes: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), list(z.string().trim().min(1).max(100)))
      .refine((r) => Object.keys(r).length <= MAX_ATTRIBUTE_FILTERS, {
        message: `At most ${MAX_ATTRIBUTE_FILTERS} attr_* filters`,
      })
      .default({}),
    sort: z.enum(['relevance', 'title', 'start_date', 'deadline']).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).optional(),
    /** Alias of `pageSize`. */
    page_size: z.coerce.number().int().min(1).max(50).optional(),
    includeUnscheduled: booleanFlag.default(false),
    upcoming: booleanFlag.optional(),
    /** Display language of resolved texts (`title`, `abstract`); English fallback. */
    locale: primaryLanguage.optional(),
  }),
);
export type CourseSearchQuery = z.infer<typeof courseSearchQuery>;

/** {@link CourseSearchQuery} with aliases and defaults resolved. */
export interface NormalizedCourseSearch {
  q: string | undefined;
  partner: string[];
  mode: string[];
  lang: string[];
  isced: string[];
  level: string[];
  kind: string[];
  /** `attr_<key>` filters: key → accepted values. */
  attributes: Record<string, string[]>;
  ectsMin: number | undefined;
  ectsMax: number | undefined;
  upcoming: boolean;
  sort: 'relevance' | 'title' | 'start_date' | 'deadline';
  page: number;
  pageSize: number;
  locale: string;
}

export function normalizeCourseSearch(query: CourseSearchQuery): NormalizedCourseSearch {
  const q = query.q?.trim() ? query.q.trim() : undefined;
  const defaultSort = q ? 'relevance' : 'start_date';
  return {
    q,
    partner: query.partner,
    mode: query.mode,
    lang: query.lang,
    isced: query.isced,
    level: query.level,
    kind: query.kind,
    attributes: Object.fromEntries(
      Object.entries(query.attributes).filter(([, values]) => values.length > 0),
    ),
    ectsMin: query.ectsMin ?? query.ects_min,
    ectsMax: query.ectsMax ?? query.ects_max,
    upcoming: query.upcoming ?? !query.includeUnscheduled,
    // Relevance without a query has nothing to rank: fall back to the next start date.
    sort: query.sort === 'relevance' && !q ? 'start_date' : (query.sort ?? defaultSort),
    page: query.page,
    pageSize: query.pageSize ?? query.page_size ?? COURSE_SEARCH_PAGE_SIZE,
    locale: query.locale ?? 'en',
  };
}

/** Optional display language of the other catalogue endpoints. */
export const localeQuery = z.object({ locale: primaryLanguage.optional() });

/** Maximum and default number of `GET /api/public/v1/suggest` items. */
export const SUGGEST_LIMIT = 10;

/**
 * `GET /api/public/v1/suggest`. Of each course, the title in `locale` is
 * suggested when it matches, else the English one, else the best match.
 */
export const suggestQuery = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(SUGGEST_LIMIT).default(SUGGEST_LIMIT),
  locale: primaryLanguage.optional(),
  /** Alias of `locale` (this endpoint has no teaching-language filter). */
  lang: primaryLanguage.optional(),
});
export type SuggestQuery = z.infer<typeof suggestQuery>;

/** OEAPI v5 paging; `pageSize` is capped at 250 (spec §9). */
export const oeapiPagingQuery = z.object({
  pageSize: z.coerce.number().int().min(1).max(250).default(10),
  pageNumber: z.coerce.number().int().min(1).default(1),
});
export type OeapiPagingQuery = z.infer<typeof oeapiPagingQuery>;

/** Comma-separated or repeated query values (`expand=a,b`, `sort=name&sort=-courseId`). */
const csvList = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) =>
      (v === undefined ? [] : Array.isArray(v) ? v : [v]).flatMap((s: unknown) =>
        typeof s === 'string'
          ? s
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
          : [s],
      ),
    z.array(item).max(20),
  );

/** `GET /oeapi/v5/courses` and `/oeapi/v5/organizations/{id}/courses`. */
export const oeapiCoursesQuery = oeapiPagingQuery.extend({
  consumer: z.string().trim().min(1).max(100).optional(),
  /** ISO 639-2 (B or T) code, e.g. `eng`, `deu`, `ger`. */
  teachingLanguage: z
    .string()
    .regex(/^[a-z]{3}$/)
    .optional(),
  level: z.enum(OEAPI_V5_LEVELS).optional(),
  modeOfDelivery: csvList(z.enum(OEAPI_V5_MODES_OF_DELIVERY)),
  q: z.string().trim().min(1).max(200).optional(),
  sort: csvList(z.enum(['courseId', 'name', '-courseId', '-name'])),
  expand: csvList(z.string().min(1).max(50)),
});
export type OeapiCoursesQuery = z.infer<typeof oeapiCoursesQuery>;

/** `GET /oeapi/v5/courses/{courseId}/offerings` (v5 `since`/`until` semantics). */
export const oeapiOfferingsQuery = oeapiPagingQuery.extend({
  consumer: z.string().trim().min(1).max(100).optional(),
  since: z.iso.date().optional(),
  until: z.iso.date().optional(),
  sort: csvList(
    z.enum([
      'offeringId',
      'name',
      'startDate',
      'endDate',
      '-offeringId',
      '-name',
      '-startDate',
      '-endDate',
    ]),
  ),
  expand: csvList(z.string().min(1).max(50)),
});
export type OeapiOfferingsQuery = z.infer<typeof oeapiOfferingsQuery>;

/** `GET /oeapi/v5/organizations`. */
export const oeapiOrganizationsQuery = oeapiPagingQuery.extend({
  consumer: z.string().trim().min(1).max(100).optional(),
  organizationType: z.string().min(1).max(50).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: csvList(z.enum(['organizationId', 'name', '-organizationId', '-name'])),
  expand: csvList(z.string().min(1).max(50)),
});
export type OeapiOrganizationsQuery = z.infer<typeof oeapiOrganizationsQuery>;

/** `GET /oeapi/v5/academic-sessions`. */
export const oeapiAcademicSessionsQuery = oeapiPagingQuery.extend({
  consumer: z.string().trim().min(1).max(100).optional(),
  academicSessionType: z.string().min(1).max(50).optional(),
  parent: z.uuid().optional(),
  sort: csvList(
    z.enum(['academicSessionId', 'name', 'startDate', '-academicSessionId', '-name', '-startDate']),
  ),
  expand: csvList(z.string().min(1).max(50)),
});
export type OeapiAcademicSessionsQuery = z.infer<typeof oeapiAcademicSessionsQuery>;

/** `expand` of single-resource OEAPI endpoints. */
export const oeapiExpandQuery = z.object({ expand: csvList(z.string().min(1).max(50)) });
export type OeapiExpandQuery = z.infer<typeof oeapiExpandQuery>;
