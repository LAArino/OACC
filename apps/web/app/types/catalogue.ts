// SPDX-License-Identifier: EUPL-1.2
// Response contract of the anonymous catalogue API (`/api/public/v1`, spec §7).
// Field names mirror the API exactly; keep this file in sync with apps/api.

/** Multilingual label `{bcp47: text}` (English always present) or an already resolved string. */
export type Label = string | Readonly<Record<string, string>>;

export interface OrganizationRef {
  id: string;
  slug: string;
  name: Readonly<Record<string, string>>;
  /** ISO 3166-1 alpha-2. */
  country_code: string | null;
}

export interface IscedField {
  code: string;
  label: Label;
}

export interface NextOffering {
  id: string;
  /** Calendar dates `YYYY-MM-DD`, local to the offering time zone. */
  start_date: string;
  end_date: string;
  application_deadline: string | null;
  enrol_start_date: string | null;
  seats_available: number | null;
  alliance_seats: number | null;
  /** ISO 8601 date-time. */
  seats_updated_at: string | null;
}

export interface CourseCard {
  id: string;
  ext_id: string;
  organization: OrganizationRef;
  /** Resolved in the requested UI language (English fallback). */
  title: string;
  abstract: string | null;
  ects: number;
  level: string | null;
  isced_broad_fields: IscedField[];
  delivery_modes: string[];
  teaching_languages: string[];
  next_offering: NextOffering | null;
  offerings_count: number;
}

export interface FacetValue {
  value: string;
  count: number;
  label?: Label;
}

export interface SearchFacets {
  partner: FacetValue[];
  mode: FacetValue[];
  lang: FacetValue[];
  isced: FacetValue[];
  level: FacetValue[];
}

export type FacetName = keyof SearchFacets;

/** `GET /api/public/v1/courses` */
export interface CourseSearchResponse {
  items: CourseCard[];
  page: number;
  page_size: number;
  total: number;
  facets: SearchFacets;
}

export interface CourseTexts {
  title: string;
  abstract: string | null;
  description: string | null;
  learning_outcomes: string | null;
  prerequisites: string | null;
  assessment: string | null;
  keywords: string[];
}

export interface CourseIscedCode {
  code: string;
  broad_code: string;
  label: Label;
  is_primary: boolean;
}

export interface AcademicSessionRef {
  name: Readonly<Record<string, string>>;
  start_date: string;
  end_date: string;
}

export interface Offering {
  id: string;
  ext_offering_id: string;
  academic_session: AcademicSessionRef | null;
  start_date: string;
  end_date: string;
  enrol_start_date: string | null;
  application_deadline: string | null;
  /** IANA time zone the dates refer to. */
  timezone: string;
  teaching_languages: string[];
  delivery_modes: string[];
  campus: string | null;
  max_students: number | null;
  alliance_seats: number | null;
  seats_available: number | null;
  seats_updated_at: string | null;
  application_url: string | null;
}

/** `GET /api/public/v1/courses/{id}` */
export interface CourseDetail {
  id: string;
  ext_id: string;
  organization: OrganizationRef;
  /** Keyed by primary language subtag. */
  texts: Readonly<Record<string, CourseTexts>>;
  ects: number;
  level: string | null;
  eqf_level: number | null;
  teaching_hours: number | null;
  info_url: string | null;
  contact_email: string | null;
  isced_codes: CourseIscedCode[];
  offerings: Offering[];
}

/** `GET /api/public/v1/suggest` */
export interface SuggestItem {
  id: string;
  title: Label;
  organization_slug: string;
}

export interface SuggestResponse {
  items: SuggestItem[];
}

export interface ReferenceOrganization {
  id: string;
  slug: string;
  name: Label;
  country_code: string | null;
  is_partner: boolean;
}

export interface CodeLabel {
  code: string;
  label: Label;
}

/** `GET /api/public/v1/reference` */
export interface ReferenceData {
  organizations: ReferenceOrganization[];
  delivery_modes: CodeLabel[];
  isced_broad_fields: CodeLabel[];
  teaching_languages: string[];
  levels: string[];
}

export type SortOrder = 'relevance' | 'title' | 'start_date';

/** Catalogue search state, kept in the page URL (spec §7: shareable, crawlable). */
export interface SearchState {
  q: string;
  partner: string[];
  mode: string[];
  lang: string[];
  isced: string[];
  level: string[];
  ectsMin: number | null;
  ectsMax: number | null;
  /** "Include past offerings": sent to the API as `upcoming=false`. */
  includePast: boolean;
  sort: SortOrder | null;
  page: number;
}

export type ListFilter = 'partner' | 'mode' | 'lang' | 'isced' | 'level';
