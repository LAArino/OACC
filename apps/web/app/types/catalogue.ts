// SPDX-License-Identifier: EUPL-1.2
// Response contract of the anonymous catalogue API (`/api/public/v1`, spec §7).
// The response types come from @oecp/schemas (`public-responses.ts`, the Zod
// contracts the API is tested against); only UI-side shapes are declared here.
import type {
  CourseSearchFacets,
  CourseSearchResponse as SchemaCourseSearchResponse,
  PublicAcademicSession,
  PublicCourseCard,
  PublicCourseDetail,
  PublicCourseText,
  PublicDeliveryMode,
  PublicIscedCode,
  PublicIscedField,
  PublicNextOffering,
  PublicOffering,
  PublicOrganizationRef,
  ReferenceResponse,
  SuggestResponse as SchemaSuggestResponse,
} from '@oecp/schemas';

/**
 * Label as the UI accepts it: a multilingual object `{bcp47: text}` (what the
 * API sends, English always present) or, defensively, an already resolved string.
 */
export type Label = string | Readonly<Record<string, string>>;

export type OrganizationRef = PublicOrganizationRef;
export type IscedField = PublicIscedField;
export type NextOffering = PublicNextOffering;
export type CourseCard = PublicCourseCard;
export type SearchFacets = CourseSearchFacets;
export type FacetName = keyof SearchFacets;
export type CourseSearchResponse = SchemaCourseSearchResponse;
export type CourseTexts = PublicCourseText;
export type CourseIscedCode = PublicIscedCode;
export type AcademicSessionRef = PublicAcademicSession;
export type Offering = PublicOffering;
export type CourseDetail = PublicCourseDetail;
export type SuggestResponse = SchemaSuggestResponse;
export type SuggestItem = SuggestResponse['items'][number];
export type DeliveryMode = PublicDeliveryMode;
export type ReferenceData = ReferenceResponse;
export type ReferenceOrganization = ReferenceData['organizations'][number];

/** A facet value as filter options use it (`label` optional, e.g. from `/reference`). */
export interface FacetValue {
  value: string;
  count: number;
  label?: Label;
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
