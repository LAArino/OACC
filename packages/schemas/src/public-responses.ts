// SPDX-License-Identifier: EUPL-1.2
/**
 * Response contracts of the anonymous catalogue API `/api/public/v1` (spec §7),
 * consumed by the Nuxt portal. Conventions:
 *
 * - Field names are snake_case, as in the DDL (spec §5).
 * - Short labels (`name`, `label`) are multilingual objects `{en, <lang>?…}`
 *   that always contain `en`; clients pick `label[locale] ?? label.en`.
 * - Long texts are resolved on search cards (`locale`, else English; the
 *   `*_lang` member says which) and complete, keyed by language, on the course page.
 * - Dates are `YYYY-MM-DD` local to the offering `timezone`; timestamps are ISO 8601 UTC.
 * - Absent values are `null`, never omitted.
 *
 * The schemas are strict so contract tests catch any drift.
 */
import { z } from 'zod';
import {
  attributeValueType,
  courseKind,
  courseLevel,
  lifecycleStatus,
  schemaOrgCourseMode,
} from './enums.js';
import { publicCourseImage } from './media.js';
import { IDP_ALIAS_PATTERN, localizedLabel } from './primitives.js';

const nullable = <T extends z.ZodType>(t: T) => t.nullable();
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });

/** Partner (or other organization) summary. */
export const publicOrganizationRef = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  name: localizedLabel,
  country_code: nullable(z.string()),
});
export type PublicOrganizationRef = z.infer<typeof publicOrganizationRef>;

export const publicIscedField = z.strictObject({ code: z.string(), label: localizedLabel });
export type PublicIscedField = z.infer<typeof publicIscedField>;

/** One displayable value of an alliance attribute. */
export const publicAttributeValue = z.strictObject({
  /** Option value; `true`/`false` for booleans; the text for `text` attributes. */
  value: z.string(),
  /** Option label; `Yes`/`No` for booleans; `{en: text}` for `text` attributes. */
  label: localizedLabel,
});
export type PublicAttributeValue = z.infer<typeof publicAttributeValue>;

/**
 * An alliance attribute of a course, resolved with its definition (decision 18).
 * Ordered by the definition's `sort_order`, then key; values in option order.
 */
export const publicAttribute = z.strictObject({
  key: z.string(),
  /** The definition's label. */
  label: localizedLabel,
  values: z.array(publicAttributeValue).min(1),
});
export type PublicAttribute = z.infer<typeof publicAttribute>;

/** The next offering on a search card: the earliest published offering not yet ended. */
export const publicNextOffering = z.strictObject({
  id: z.uuid(),
  start_date: date,
  end_date: date,
  application_deadline: nullable(date),
  enrol_start_date: nullable(date),
  timezone: z.string(),
  seats_available: nullable(z.int()),
  alliance_seats: nullable(z.int()),
  seats_updated_at: nullable(timestamp),
  /** How to apply, in `locale`, else English, else the first language; null when none. */
  application_instructions: nullable(z.string()),
});
export type PublicNextOffering = z.infer<typeof publicNextOffering>;

/** One search result (compact course card). */
export const publicCourseCard = z.strictObject({
  id: z.uuid(),
  ext_id: z.string(),
  organization: publicOrganizationRef,
  title: z.string(),
  /** Language of `title`: the requested `locale` or `en`. */
  title_lang: z.string(),
  /** At most 300 characters; cut at a word boundary and ended with `…`. */
  abstract: nullable(z.string()),
  abstract_lang: nullable(z.string()),
  ects: z.number(),
  kind: courseKind,
  /** Primary level (`levels[0]`). */
  level: nullable(courseLevel),
  /** Every study cycle, primary first. */
  levels: z.array(courseLevel),
  /**
   * Tags of the card: attributes whose definition has `show_as_tag`, booleans
   * only when true.
   */
  attributes: z.array(publicAttribute),
  /** Distinct broad fields, primary first. */
  isced_broad_fields: z.array(publicIscedField),
  /** Union over published offerings that have not ended (codes of `delivery_modes`). */
  delivery_modes: z.array(z.string()),
  /** Union over published offerings that have not ended (primary language subtags). */
  teaching_languages: z.array(z.string()),
  /** Earliest published offering not yet ended that satisfies the `mode`/`lang` filters. */
  next_offering: nullable(publicNextOffering),
  /** Number of published offerings that have not ended. */
  offerings_count: z.int().min(0),
  /** Course image (decision 27); `thumbnail_url` is the card size. Null: show no image box. */
  image: nullable(publicCourseImage),
});
export type PublicCourseCard = z.infer<typeof publicCourseCard>;

export const facetCount = z.strictObject({ value: z.string(), count: z.int().min(1) });
export type FacetCount = z.infer<typeof facetCount>;

/** Facet count of an attribute value, with its display label. */
export const attributeFacetCount = facetCount.extend({ label: localizedLabel });
export type AttributeFacetCount = z.infer<typeof attributeFacetCount>;

/**
 * Facet counts (number of courses) for the current filters. Disjunctive: each
 * facet ignores its own filter, so the other values of a multi-select stay
 * visible with the counts they would add. Keys are the query parameter names.
 */
export const courseSearchFacets = z.strictObject({
  partner: z.array(facetCount),
  mode: z.array(facetCount),
  lang: z.array(facetCount),
  isced: z.array(facetCount),
  level: z.array(facetCount),
  kind: z.array(facetCount),
  /**
   * One entry per `filterable` attribute definition, keyed by attribute key (the
   * query parameter is `attr_<key>`); booleans count `true` and `false`.
   */
  attributes: z.record(z.string(), z.array(attributeFacetCount)),
});
export type CourseSearchFacets = z.infer<typeof courseSearchFacets>;

/** `GET /api/public/v1/courses` */
export const courseSearchResponse = z.strictObject({
  items: z.array(publicCourseCard),
  page: z.int().min(1),
  page_size: z.int().min(1),
  total: z.int().min(0),
  facets: courseSearchFacets,
});
export type CourseSearchResponse = z.infer<typeof courseSearchResponse>;

/** One language of a course's texts (`course_texts` row). */
export const publicCourseText = z.strictObject({
  title: z.string(),
  abstract: nullable(z.string()),
  description: nullable(z.string()),
  learning_outcomes: nullable(z.string()),
  prerequisites: nullable(z.string()),
  assessment: nullable(z.string()),
  /** Optional texts of the Aurora IT Handbook (decision 21b). */
  mode_of_repetition: nullable(z.string()),
  methods: nullable(z.string()),
  literature: nullable(z.string()),
  privacy_notice: nullable(z.string()),
  remarks: nullable(z.string()),
  keywords: z.array(z.string()),
  is_machine_translated: z.boolean(),
  /** Last change of this language's texts (`course_texts.updated_at`). */
  updated_at: timestamp,
});
export type PublicCourseText = z.infer<typeof publicCourseText>;

export const publicDeliveryMode = z.strictObject({
  code: z.string(),
  label: localizedLabel,
  /** schema.org `courseMode` for JSON-LD. */
  schema_org: schemaOrgCourseMode,
});
export type PublicDeliveryMode = z.infer<typeof publicDeliveryMode>;

export const publicAcademicSession = z.strictObject({
  id: z.uuid(),
  name: localizedLabel,
  start_date: date,
  end_date: date,
});
export type PublicAcademicSession = z.infer<typeof publicAcademicSession>;

/**
 * Offering on the course page. Seats follow DL 8 on the client: show
 * `alliance_seats` when set, and `seats_available` "as of `seats_updated_at`"
 * when set; never compute remaining alliance seats.
 */
export const publicOffering = z.strictObject({
  id: z.uuid(),
  ext_offering_id: z.string(),
  /** `published`, or `cancelled` (listed, to be labelled, until `start_date`). */
  status: lifecycleStatus.extract(['published', 'cancelled']),
  academic_session: nullable(publicAcademicSession),
  start_date: date,
  end_date: date,
  enrol_start_date: nullable(date),
  /** Last day to apply, 23:59:59 in `timezone`. */
  application_deadline: nullable(date),
  timezone: z.string(),
  teaching_languages: z.array(z.string()),
  /** Codes of `delivery_modes`, by `sort_order`; labels and schema.org modes in `/reference`. */
  delivery_modes: z.array(z.string()),
  campus: nullable(z.string()),
  max_students: nullable(z.int()),
  alliance_seats: nullable(z.int()),
  seats_available: nullable(z.int()),
  seats_updated_at: nullable(timestamp),
  application_url: nullable(z.string()),
  /** How to apply (e.g. a nomination process), keyed by primary language subtag; may be empty. */
  application_instructions: z.record(z.string(), z.string()),
  /**
   * Last write of the offering row (`course_offerings.updated_at`); a harvest
   * that sees the offering unchanged also sets it (`last_seen_at` is in the row).
   */
  updated_at: timestamp,
});
export type PublicOffering = z.infer<typeof publicOffering>;

export const publicCourseOrganization = publicOrganizationRef.extend({
  logo_url: nullable(z.string()),
  website_url: nullable(z.string()),
});

export const publicIscedCode = z.strictObject({
  code: z.string(),
  broad_code: z.string(),
  is_primary: z.boolean(),
  /** Label of the broad field. */
  label: localizedLabel,
});
export type PublicIscedCode = z.infer<typeof publicIscedCode>;

/** `GET /api/public/v1/courses/{id}` */
export const publicCourseDetail = z.strictObject({
  id: z.uuid(),
  ext_id: z.string(),
  organization: publicCourseOrganization,
  teaching_unit: nullable(z.strictObject({ id: z.uuid(), slug: z.string(), name: localizedLabel })),
  ects: z.number(),
  kind: courseKind,
  /** Primary level (`levels[0]`). */
  level: nullable(courseLevel),
  /** Every study cycle, primary first. */
  levels: z.array(courseLevel),
  eqf_level: nullable(z.int()),
  teaching_hours: nullable(z.number()),
  info_url: nullable(z.string()),
  /** The course contact, else the organization's (spec §6.2.4). */
  contact_email: nullable(z.string()),
  /**
   * Teaching staff as the university publishes them (decision 21a): names or role
   * descriptions, primary first; may be empty.
   */
  instructors: z.array(z.string()),
  /** Keyed by primary language subtag; always contains `en`. */
  texts: z.record(z.string(), publicCourseText),
  isced_codes: z.array(publicIscedCode),
  /** Every attribute the course has (booleans true or false). */
  attributes: z.array(publicAttribute),
  /**
   * Published offerings (past ones included) and cancelled offerings that have
   * not started, ordered by `start_date`.
   */
  offerings: z.array(publicOffering),
  /**
   * Course image (decision 27): `url` for the page and `og:image` (prefix the
   * portal origin), `credit` in small print; null when the course has none.
   */
  image: nullable(publicCourseImage),
  /** Latest change of the course, its texts or offerings. */
  updated_at: timestamp,
});
export type PublicCourseDetail = z.infer<typeof publicCourseDetail>;

/** `GET /api/public/v1/suggest` */
export const suggestResponse = z.strictObject({
  items: z.array(
    z.strictObject({
      id: z.uuid(),
      /** The best-matching title, in any language. */
      title: z.string(),
      lang: z.string(),
      organization_slug: z.string(),
    }),
  ),
});
export type SuggestResponse = z.infer<typeof suggestResponse>;

/** An alliance attribute definition, for filters, tags and labels. */
export const publicAttributeDefinition = z.strictObject({
  key: z.string(),
  value_type: attributeValueType,
  label: localizedLabel,
  description: nullable(localizedLabel),
  /** Options of `enum`/`multi_enum`, in display order; empty for `boolean`/`text`. */
  options: z.array(publicAttributeValue),
  /** Offered as `attr_<key>` filter with a facet. */
  filterable: z.boolean(),
  /** Shown as a tag on course cards. */
  show_as_tag: z.boolean(),
  sort_order: z.int(),
});
export type PublicAttributeDefinition = z.infer<typeof publicAttributeDefinition>;

/** `GET /api/public/v1/reference` */
export const referenceResponse = z.strictObject({
  organizations: z.array(
    publicCourseOrganization.extend({
      org_type: z.string(),
      is_partner: z.boolean(),
      parent_id: nullable(z.uuid()),
      /**
       * Keycloak alias of the organization's identity provider (`kc_idp_hint`
       * for "sign in through your university"); null for local accounts and
       * when Keycloak has no enabled identity provider with that alias.
       */
      idp_alias: nullable(z.string().regex(IDP_ALIAS_PATTERN)),
    }),
  ),
  delivery_modes: z.array(publicDeliveryMode),
  isced_broad_fields: z.array(publicIscedField),
  /** Primary subtags found in published offerings, sorted. */
  teaching_languages: z.array(z.string()),
  levels: z.array(courseLevel),
  kinds: z.array(z.strictObject({ code: courseKind, label: localizedLabel })),
  /** By `sort_order`, then key. */
  attribute_definitions: z.array(publicAttributeDefinition),
});
export type ReferenceResponse = z.infer<typeof referenceResponse>;
