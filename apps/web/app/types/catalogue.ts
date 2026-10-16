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
/** Optional texts of the Aurora IT Handbook data model [DL 21]. */
export type HandbookTextField =
  'mode_of_repetition' | 'methods' | 'literature' | 'privacy_notice' | 'remarks';
/** Null or absent when not provided (older API: always absent). */
type HandbookTexts = { [K in HandbookTextField]?: string | null };

export type CourseTexts = Omit<PublicCourseText, HandbookTextField> & HandbookTexts;
export type CourseIscedCode = PublicIscedCode;
export type AcademicSessionRef = PublicAcademicSession;
export type SuggestResponse = SchemaSuggestResponse;
export type SuggestItem = SuggestResponse['items'][number];
export type DeliveryMode = PublicDeliveryMode;

// ---------------------------------------------------------------------------
// Alliance attributes, course kinds and multi-valued levels [DL 18]. These
// members are additive to the published schemas and optional here, so the UI
// keeps working against an API that does not send them yet (older API). The
// base types omit them before redeclaring, so the result is the same whether
// or not the installed @oecp/schemas already declares them.

/** Course kinds known to the UI (`/reference` `kinds[].code`); others are shown by label. */
export type CourseKind = 'course' | 'bip' | 'lecture_series' | 'other';

/** `/reference` `kinds[]`. */
export interface KindRef {
  code: string;
  label: Label;
}

export type AttributeValueType = 'enum' | 'multi_enum' | 'boolean' | 'text';

export interface AttributeOption {
  value: string;
  label: Label;
}

/** `/reference` `attribute_definitions[]`: the alliance's attribute schema. */
export interface AttributeDefinition {
  key: string;
  value_type: AttributeValueType;
  label: Label;
  description: Label | null;
  /** Allowed values of `enum` and `multi_enum` definitions; `null` otherwise. */
  options: AttributeOption[] | null;
  /** Offered as a catalogue filter (`attr_<key>`), with facet counts. */
  filterable: boolean;
  /** Shown as tags on search cards. */
  show_as_tag: boolean;
  sort_order: number;
}

/**
 * An attribute of a course, labels resolved by the API: booleans appear as one
 * value `true` labelled like the definition; text values have value = label.
 */
export interface CourseAttribute {
  key: string;
  label: Label;
  values: { value: string; label: Label }[];
}

interface CourseExtras {
  /** `course` | `bip` | `lecture_series` | `other`. */
  kind?: string;
  /** Every level of the course (e.g. bachelor and master); supersedes `level`. */
  levels?: string[];
  attributes?: CourseAttribute[];
}

type NewCourseKeys = keyof CourseExtras;

/**
 * Image of a course on the public card and course page [DL 27]: `url` (lg,
 * fitted inside 1600×1600) and `thumbnail_url` (sm, inside 640×640) are paths
 * on the portal origin; `width`/`height` are the lg file's. `alt` is keyed by
 * language (English present unless `decorative`).
 */
export interface CourseImage {
  url: string;
  thumbnail_url: string;
  alt: Readonly<Record<string, string>>;
  decorative: boolean;
  credit: string | null;
  width: number;
  height: number;
}

/**
 * `image` is additive like the members above: optional here (an older API does
 * not send it), `null` when the course has none.
 */
interface CourseImageExtra {
  image?: CourseImage | null;
}

export type NextOffering = Omit<PublicNextOffering, 'application_instructions'> & {
  /** Instructions resolved for the requested `locale` (English fallback). */
  application_instructions?: string | null;
};

export type CourseCard = Omit<PublicCourseCard, NewCourseKeys | 'next_offering' | 'image'> &
  CourseExtras &
  CourseImageExtra & { next_offering: NextOffering | null };

export type Offering = Omit<PublicOffering, 'application_instructions'> & {
  /** How to apply, keyed by primary language subtag (plain text). */
  application_instructions?: Readonly<Record<string, string>> | null;
};

export type CourseDetail = Omit<
  PublicCourseDetail,
  NewCourseKeys | 'offerings' | 'texts' | 'instructors' | 'image'
> &
  CourseExtras &
  CourseImageExtra & {
    offerings: Offering[];
    texts: Record<string, CourseTexts>;
    /** Instructor names [DL 21]; absent from an older API. */
    instructors?: string[];
  };

export type ReferenceData = Omit<ReferenceResponse, 'kinds' | 'attribute_definitions'> & {
  kinds?: KindRef[];
  attribute_definitions?: AttributeDefinition[];
};
export type ReferenceOrganization = ReferenceData['organizations'][number];

/** Facet names that are plain lists of `{value, count}`. */
export type FacetName = 'partner' | 'mode' | 'lang' | 'isced' | 'level' | 'kind';

export type SearchFacets = Omit<CourseSearchFacets, 'kind' | 'attributes'> & {
  kind?: FacetValue[];
  /** Per filterable attribute key (`attr_<key>`); booleans count the value `true`. */
  attributes?: Record<string, FacetValue[]>;
};

export type CourseSearchResponse = Omit<SchemaCourseSearchResponse, 'items' | 'facets'> & {
  items: CourseCard[];
  facets: SearchFacets;
};

/** A facet value as filter options use it (`label` optional, e.g. from `/reference`). */
export interface FacetValue {
  value: string;
  count: number;
  label?: Label;
}

export type SortOrder = 'relevance' | 'title' | 'start_date' | 'deadline';

/** Catalogue search state, kept in the page URL (spec §7: shareable, crawlable). */
export interface SearchState {
  q: string;
  partner: string[];
  mode: string[];
  lang: string[];
  isced: string[];
  level: string[];
  kind: string[];
  /** Attribute filters by definition key (`attr_<key>=value`, repeatable). */
  attrs: Record<string, string[]>;
  ectsMin: number | null;
  ectsMax: number | null;
  /** "Include past offerings": sent to the API as `upcoming=false`. */
  includePast: boolean;
  sort: SortOrder | null;
  page: number;
}

export type ListFilter = 'partner' | 'mode' | 'lang' | 'isced' | 'level' | 'kind';
