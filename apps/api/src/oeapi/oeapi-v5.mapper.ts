// SPDX-License-Identifier: EUPL-1.2
/**
 * Canonical → OEAPI v5.0 mapping of the anonymous read API (spec §9), the
 * reverse of the harvester mapping (spec §6.2.4). Pure functions; the shapes
 * follow the v5.0 OpenAPI document (`tools/oeapi-mock/spec/oeapi-v5.0.bundled.json`)
 * and are contract-tested against it. Values v5 cannot express go in `ext.oecp`.
 */
import type {
  LocalizedLabel,
  OeapiV5IdentifierEntry,
  OeapiV5LanguageTypedString,
} from '@oecp/schemas';
import { toIso6392T } from './languages.js';

/** `consumerKey` of OECP's own consumer object. */
export const OECP_CONSUMER_KEY = 'oecp';

export type LanguageTypedString = Pick<OeapiV5LanguageTypedString, 'language' | 'value'>;
export type IdentifierEntry = Pick<OeapiV5IdentifierEntry, 'codeType' | 'code'>;

export interface OrganizationRow {
  id: string;
  parent_id: string | null;
  partner_id: string | null;
  org_type: string;
  is_partner: boolean;
  slug: string;
  name: LocalizedLabel;
  schac_home_organization: string | null;
  erasmus_code: string | null;
  pic: string | null;
  country_code: string | null;
  website_url: string | null;
  logo_url: string | null;
  contact_email: string | null;
}

export interface CourseRow {
  id: string;
  organization_id: string;
  teaching_unit_id: string | null;
  ext_id: string;
  kind: string;
  ects: string;
  level: string | null;
  /** Every study cycle, primary (= `level`) first. */
  levels: string[];
  /** Alliance attributes, as stored (decision 18). */
  attributes: Record<string, unknown>;
  eqf_level: number | null;
  teaching_hours: string | null;
  info_url: string | null;
  contact_email: string | null;
  /** Teaching staff (decision 21a). */
  instructors: string[];
  updated_at: Date;
}

export interface CourseTextRow {
  course_id: string;
  lang: string;
  title: string;
  abstract: string | null;
  description: string | null;
  learning_outcomes: string | null;
  prerequisites: string | null;
  assessment: string | null;
  mode_of_repetition: string | null;
  methods: string | null;
  literature: string | null;
  privacy_notice: string | null;
  remarks: string | null;
  keywords: string[];
}

export interface CourseIscedRow {
  course_id: string;
  isced_code: string;
  is_primary: boolean;
}

export interface OfferingRow {
  id: string;
  course_id: string;
  ext_offering_id: string;
  status: 'published' | 'cancelled';
  academic_session_id: string | null;
  start_date: string;
  end_date: string;
  enrol_start_date: string | null;
  application_deadline: string | null;
  timezone: string;
  teaching_languages: string[];
  campus: string | null;
  max_students: number | null;
  alliance_seats: number | null;
  seats_available: number | null;
  seats_updated_at: Date | null;
  application_url: string | null;
  /** `{lang: text}`. */
  application_instructions: Record<string, string>;
  /** Delivery mode codes. */
  modes: string[];
}

export interface AcademicSessionRow {
  id: string;
  organization_id: string;
  ext_id: string;
  parent_id: string | null;
  session_type: string;
  name: LocalizedLabel;
  start_date: string;
  end_date: string;
}

/** A course with everything its v5 representation needs. */
export interface CourseBundle {
  course: CourseRow;
  /** English first. */
  texts: CourseTextRow[];
  isced: CourseIscedRow[];
  /** Published and cancelled offerings, by start date. */
  offerings: OfferingRow[];
}

export interface MappingContext {
  /** The alliance organization: v5 `root`, parent of every partner. */
  alliance: OrganizationRow | null;
  /** `YYYY-MM-DD`. */
  today: string;
}

export interface V5Organization {
  organizationId: string;
  primaryCode: IdentifierEntry;
  organizationType: string;
  name: LanguageTypedString[];
  shortName: string;
  link?: string;
  logo?: string;
  addresses?: { addressType: 'postal'; countryCode: string }[];
  otherCodes?: IdentifierEntry[];
  parent?: string | V5Organization;
  children?: (string | V5Organization)[];
  ext: { oecp: { slug: string; orgType: string; isPartner: boolean } };
}

export interface V5Consumer {
  consumerKey: string;
  alliances?: { name: string }[];
}

export interface V5Course {
  courseId: string;
  primaryCode: IdentifierEntry;
  name: LanguageTypedString[];
  abbreviation: string;
  description: LanguageTypedString[];
  teachingLanguage: string;
  level: string;
  studyLoad: { studyLoadUnit: 'ects'; value: number };
  modeOfDelivery?: string[];
  firstStartDate?: string;
  fieldsOfStudy?: string;
  learningOutcomes?: LanguageTypedString[][];
  admissionRequirements?: LanguageTypedString[];
  assessment?: LanguageTypedString[];
  link?: string;
  consumers: V5Consumer[];
  organization: string | V5Organization;
  ext: {
    oecp: {
      /** course / bip / lecture_series / other. */
      kind: string;
      level: string | null;
      /** Every study cycle, primary first. */
      levels: string[];
      eqfLevel: number | null;
      teachingHours: number | null;
      iscedCodes: string[];
      abstract?: LanguageTypedString[];
      keywords?: { language: string; value: string[] }[];
      teachingUnit: string | null;
      contactEmail: string | null;
      /**
       * Teaching staff (decision 21a). Not v5 `coordinators`, which are `Person`
       * objects (or their ids); OECP stores names only.
       */
      instructors: string[];
      /** Optional IT Handbook texts (decision 21b); absent when the course has none. */
      texts?: V5HandbookTexts;
      /** Alliance attributes keyed by attribute key (definitions in `/api/public/v1/reference`). */
      attributes: Record<string, unknown>;
      updatedAt: string;
    };
  };
}

/** `ext.oecp.texts`: members present only when some language has the text. */
export interface V5HandbookTexts {
  modeOfRepetition?: LanguageTypedString[];
  methods?: LanguageTypedString[];
  literature?: LanguageTypedString[];
  privacyNotice?: LanguageTypedString[];
  remarks?: LanguageTypedString[];
}

export interface V5Offering {
  offeringId: string;
  primaryCode: IdentifierEntry;
  offeringType: 'course';
  name: LanguageTypedString[];
  description: LanguageTypedString[];
  teachingLanguage: string;
  modeOfDelivery: string[];
  resultExpected: true;
  startDate: string;
  endDate: string;
  enrollStartDate?: string;
  enrollEndDate?: string;
  maxNumberStudents?: number;
  link?: string;
  academicSession?: string | V5AcademicSession;
  course: string | V5Course;
  organization: string;
  consumers: V5Consumer[];
  ext: {
    oecp: {
      status: 'published' | 'cancelled';
      timezone: string;
      teachingLanguages: string[];
      deliveryModes: string[];
      campus: string | null;
      allianceSeats: number | null;
      seatsAvailable: number | null;
      seatsUpdatedAt: string | null;
      /** How to apply, per language; absent when there is none. */
      applicationInstructions?: LanguageTypedString[];
    };
  };
}

export interface V5AcademicSession {
  academicSessionId: string;
  academicSessionType: string;
  primaryCode: IdentifierEntry;
  name: LanguageTypedString[];
  startDate: string;
  endDate: string;
  parent?: string | V5AcademicSession;
  children?: (string | V5AcademicSession)[];
  ext: { oecp: { organizationId: string } };
}

export interface V5Page<T> {
  pageSize: number;
  pageNumber: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  totalPages: number;
  items: T[];
}

export function toPage<T>(
  items: T[],
  paging: { pageSize: number; pageNumber: number },
  total: number,
): V5Page<T> {
  const totalPages = Math.ceil(total / paging.pageSize);
  return {
    pageSize: paging.pageSize,
    pageNumber: paging.pageNumber,
    hasPreviousPage: paging.pageNumber > 1,
    hasNextPage: paging.pageNumber * paging.pageSize < total,
    totalPages,
    items,
  };
}

// --- vocabularies ------------------------------------------------------------

/** v5 `modesOfDelivery` order of output. */
const V5_MODE_ORDER = ['on campus', 'online', 'hybrid'];

/** Spec §9 reverse modes: presential → on campus; online, coil → online; others → hybrid. */
export function toV5Mode(code: string): 'on campus' | 'online' | 'hybrid' {
  if (code === 'presential') return 'on campus';
  if (code === 'online' || code === 'coil') return 'online';
  return 'hybrid';
}

export function toV5Modes(codes: Iterable<string>): string[] {
  const set = new Set<string>([...codes].map(toV5Mode));
  return V5_MODE_ORDER.filter((m) => set.has(m));
}

/** v5 `level`: bachelor/master/doctoral 1:1, short cycle → associate degree, else undefined. */
export function toV5Level(level: string | null): string {
  switch (level) {
    case 'bachelor':
    case 'master':
    case 'doctoral':
      return level;
    case 'short_cycle':
      return 'associate degree';
    default:
      return 'undefined';
  }
}

const ORG_TYPES: Readonly<Record<string, string>> = {
  alliance: 'root',
  institution: 'institute',
  faculty: 'faculty',
  department: 'department',
  campus: 'branch',
  other: 'institute',
};

export function toV5OrganizationType(orgType: string): string {
  return ORG_TYPES[orgType] ?? 'institute';
}

/** `academic_year` → `academic year`, `testing_period` → `testing period`. */
export function toV5SessionType(type: string): string {
  return type.replace(/_/g, ' ');
}

// --- helpers -----------------------------------------------------------------

/** Language-typed strings of non-empty values, English first. */
export function lts(entries: Iterable<[string, string | null | undefined]>): LanguageTypedString[] {
  const out: LanguageTypedString[] = [];
  for (const [language, value] of entries) {
    if (value !== null && value !== undefined && value.trim() !== '') out.push({ language, value });
  }
  return out.sort((a, b) =>
    a.language === b.language
      ? 0
      : a.language === 'en'
        ? -1
        : b.language === 'en'
          ? 1
          : a.language.localeCompare(b.language),
  );
}

export function labelToLts(label: LocalizedLabel): LanguageTypedString[] {
  return lts(Object.entries(label));
}

/**
 * v5 `learningOutcomes` (one array of language variants per outcome) from texts
 * whose outcomes the harvester joined with blank lines: split again when every
 * language has the same number of parts, else one outcome per language text.
 */
export function toLearningOutcomes(
  texts: { lang: string; learning_outcomes: string | null }[],
): LanguageTypedString[][] | undefined {
  const parts = texts
    .filter((t) => t.learning_outcomes?.trim())
    .map((t) => ({
      lang: t.lang,
      items: t
        .learning_outcomes!.split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    }));
  if (parts.length === 0) return undefined;
  const n = parts[0]!.items.length;
  if (parts.every((p) => p.items.length === n)) {
    return Array.from({ length: n }, (_, i) => lts(parts.map((p) => [p.lang, p.items[i]])));
  }
  return [lts(parts.map((p) => [p.lang, p.items.join('\n\n')]))];
}

/** Course description in every language: description, else abstract, else title. */
function descriptions(texts: CourseTextRow[]): LanguageTypedString[] {
  return lts(texts.map((t) => [t.lang, t.description ?? t.abstract ?? t.title]));
}

function consumers(ctx: MappingContext): V5Consumer[] {
  return [
    ctx.alliance
      ? { consumerKey: OECP_CONSUMER_KEY, alliances: [{ name: ctx.alliance.slug }] }
      : { consumerKey: OECP_CONSUMER_KEY },
  ];
}

const optional = <K extends string, V>(key: K, value: V | null | undefined) =>
  (value === null || value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

// --- organizations -------------------------------------------------------------

/**
 * v5 parent of an organization: the stored parent; partners (and parentless
 * organizations other than the alliance) hang under the alliance root.
 */
export function v5ParentId(org: OrganizationRow, alliance: OrganizationRow | null): string | null {
  if (alliance && org.id === alliance.id) return null;
  if (org.parent_id) return org.parent_id;
  if (org.partner_id && org.partner_id !== org.id) return org.partner_id;
  return alliance?.id ?? null;
}

export function toV5Organization(
  org: OrganizationRow,
  all: OrganizationRow[],
  alliance: OrganizationRow | null,
  expand: { parent?: boolean; children?: boolean } = {},
): V5Organization {
  const parentId = v5ParentId(org, alliance);
  const children = all.filter((o) => o.id !== org.id && v5ParentId(o, alliance) === org.id);
  const primaryCode: IdentifierEntry = org.schac_home_organization
    ? { codeType: 'schacHome', code: org.schac_home_organization }
    : { codeType: 'identifier', code: org.slug };
  const otherCodes: IdentifierEntry[] = [
    ...(org.schac_home_organization ? [{ codeType: 'identifier', code: org.slug }] : []),
    ...(org.erasmus_code ? [{ codeType: 'x-erasmusCode', code: org.erasmus_code }] : []),
    ...(org.pic ? [{ codeType: 'x-pic', code: org.pic }] : []),
  ];
  const parent = parentId ? all.find((o) => o.id === parentId) : undefined;
  return {
    organizationId: org.id,
    primaryCode,
    organizationType: toV5OrganizationType(org.org_type),
    name: labelToLts(org.name),
    shortName: org.slug,
    ...optional('link', org.website_url),
    ...optional('logo', org.logo_url),
    ...(org.country_code
      ? { addresses: [{ addressType: 'postal', countryCode: org.country_code }] }
      : {}),
    ...(otherCodes.length ? { otherCodes } : {}),
    ...(parentId
      ? {
          parent: expand.parent && parent ? toV5Organization(parent, all, alliance) : parentId,
        }
      : {}),
    ...(children.length
      ? {
          children: children.map((c) =>
            expand.children ? toV5Organization(c, all, alliance) : c.id,
          ),
        }
      : {}),
    ext: { oecp: { slug: org.slug, orgType: org.org_type, isPartner: org.is_partner } },
  };
}

// --- courses -------------------------------------------------------------------

/** The offering whose first language is the course `teachingLanguage`. */
function representativeOffering(b: CourseBundle, today: string): OfferingRow | undefined {
  const published = b.offerings.filter((o) => o.status === 'published');
  return (
    published.find((o) => o.end_date >= today) ?? published[published.length - 1] ?? b.offerings[0]
  );
}

export function toV5Course(
  b: CourseBundle,
  ctx: MappingContext,
  expand: { organization?: V5Organization } = {},
): V5Course {
  const { course: c, texts } = b;
  const published = b.offerings.filter((o) => o.status === 'published');
  const first = representativeOffering(b, ctx.today);
  const firstLanguage = first?.teaching_languages[0] ?? texts[0]?.lang ?? 'en';
  const modes = toV5Modes((published.length ? published : b.offerings).flatMap((o) => o.modes));
  const firstStart = published.find((o) => o.start_date >= ctx.today)?.start_date;
  const primaryIsced = b.isced.find((i) => i.is_primary) ?? b.isced[0];
  const keywords = texts
    .filter((t) => t.keywords.length > 0)
    .map((t) => ({ language: t.lang, value: t.keywords }));
  const abstract = lts(texts.map((t) => [t.lang, t.abstract]));
  const admission = lts(texts.map((t) => [t.lang, t.prerequisites]));
  const assessment = lts(texts.map((t) => [t.lang, t.assessment]));
  const handbook = handbookTexts(texts);
  return {
    courseId: c.id,
    primaryCode: { codeType: 'identifier', code: c.ext_id },
    name: lts(texts.map((t) => [t.lang, t.title])),
    abbreviation: c.ext_id,
    description: descriptions(texts),
    teachingLanguage: toIso6392T(firstLanguage),
    level: toV5Level(c.level),
    studyLoad: { studyLoadUnit: 'ects', value: Number(c.ects) },
    ...(modes.length ? { modeOfDelivery: modes } : {}),
    ...optional('firstStartDate', firstStart),
    ...optional('fieldsOfStudy', primaryIsced?.isced_code.slice(0, 4)),
    ...optional('learningOutcomes', toLearningOutcomes(texts)),
    ...(admission.length ? { admissionRequirements: admission } : {}),
    ...(assessment.length ? { assessment } : {}),
    ...optional('link', c.info_url),
    consumers: consumers(ctx),
    organization: expand.organization ?? c.organization_id,
    ext: {
      oecp: {
        kind: c.kind,
        level: c.level,
        levels: c.levels,
        eqfLevel: c.eqf_level,
        teachingHours: c.teaching_hours === null ? null : Number(c.teaching_hours),
        iscedCodes: b.isced.map((i) => i.isced_code),
        ...(abstract.length ? { abstract } : {}),
        ...(keywords.length ? { keywords } : {}),
        teachingUnit: c.teaching_unit_id,
        contactEmail: c.contact_email,
        instructors: c.instructors ?? [],
        ...(handbook ? { texts: handbook } : {}),
        attributes: c.attributes ?? {},
        updatedAt: c.updated_at.toISOString(),
      },
    },
  };
}

/** `ext.oecp.texts` from the course texts; undefined when no language has any of them. */
export function handbookTexts(texts: CourseTextRow[]): V5HandbookTexts | undefined {
  const out: V5HandbookTexts = {};
  const members = [
    ['modeOfRepetition', 'mode_of_repetition'],
    ['methods', 'methods'],
    ['literature', 'literature'],
    ['privacyNotice', 'privacy_notice'],
    ['remarks', 'remarks'],
  ] as const;
  for (const [member, column] of members) {
    const values = lts(texts.map((t) => [t.lang, t[column]]));
    if (values.length > 0) out[member] = values;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// --- offerings -----------------------------------------------------------------

export function toV5Offering(
  o: OfferingRow,
  course: CourseBundle,
  ctx: MappingContext,
  expand: { academicSession?: V5AcademicSession; course?: V5Course } = {},
): V5Offering {
  const instructions = lts(
    Object.entries(o.application_instructions ?? {}).sort(([a], [b]) =>
      a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b),
    ),
  );
  return {
    offeringId: o.id,
    primaryCode: { codeType: 'offeringCode', code: o.ext_offering_id },
    offeringType: 'course',
    name: lts(course.texts.map((t) => [t.lang, t.title])),
    description: descriptions(course.texts),
    teachingLanguage: toIso6392T(o.teaching_languages[0] ?? 'und'),
    modeOfDelivery: toV5Modes(o.modes),
    resultExpected: true,
    startDate: o.start_date,
    endDate: o.end_date,
    ...optional('enrollStartDate', o.enrol_start_date),
    ...optional('enrollEndDate', o.application_deadline),
    ...optional('maxNumberStudents', o.max_students),
    ...optional('link', o.application_url),
    ...(o.academic_session_id
      ? { academicSession: expand.academicSession ?? o.academic_session_id }
      : {}),
    course: expand.course ?? o.course_id,
    organization: course.course.organization_id,
    consumers: consumers(ctx),
    ext: {
      oecp: {
        status: o.status,
        timezone: o.timezone,
        teachingLanguages: o.teaching_languages,
        deliveryModes: o.modes,
        campus: o.campus,
        allianceSeats: o.alliance_seats,
        seatsAvailable: o.seats_available,
        seatsUpdatedAt: o.seats_updated_at ? o.seats_updated_at.toISOString() : null,
        ...(instructions.length ? { applicationInstructions: instructions } : {}),
      },
    },
  };
}

// --- academic sessions ---------------------------------------------------------

export function toV5AcademicSession(
  s: AcademicSessionRow,
  expand: { parent?: V5AcademicSession; children?: (string | V5AcademicSession)[] } = {},
): V5AcademicSession {
  return {
    academicSessionId: s.id,
    academicSessionType: toV5SessionType(s.session_type),
    primaryCode: { codeType: 'identifier', code: s.ext_id },
    name: labelToLts(s.name),
    startDate: s.start_date,
    endDate: s.end_date,
    ...(s.parent_id ? { parent: expand.parent ?? s.parent_id } : {}),
    ...(expand.children?.length ? { children: expand.children } : {}),
    ext: { oecp: { organizationId: s.organization_id } },
  };
}
