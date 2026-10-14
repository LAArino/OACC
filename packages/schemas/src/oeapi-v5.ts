// SPDX-License-Identifier: EUPL-1.2
/**
 * OEAPI v5.0 resources consumed by the Channel A harvester (spec §6.2.3–6.2.4),
 * after open-education-api/specification tag `v5.0` (`v5/schemas/*.yaml`).
 *
 * Objects are loose: unknown members (`ext`, `otherCodes`, `addresses`, …) pass
 * through untouched and stay in the raw payload kept in `ext_metadata_history`.
 * Types of the members the harvester reads are strict. Members the v5
 * specification marks required but the harvester does not need (`abbreviation`,
 * `description`, `level`, `offeringType`, `resultExpected`, `shortName`) are
 * optional, so one partner's omission does not reject a whole course; members
 * whose absence the mapping reports with a dedicated code (`primaryCode`,
 * `studyLoad`, `teachingLanguage`, `modeOfDelivery`) are optional here and
 * checked by the adapter. Extensible enumerations are plain strings for the same
 * reason; their known values are exported as constants.
 */
import { z } from 'zod';

/** `LanguageTypedString`: `language` is an RFC 3066 tag such as `en-GB`. */
export const oeapiV5LanguageTypedString = z.looseObject({
  language: z.string().min(1),
  value: z.string(),
});
export type OeapiV5LanguageTypedString = z.infer<typeof oeapiV5LanguageTypedString>;

const languageTypedStrings = z.array(oeapiV5LanguageTypedString);

/** `IdentifierEntry` (`primaryCode`, `otherCodes[]`). */
export const oeapiV5IdentifierEntry = z.looseObject({
  codeType: z.string().min(1),
  code: z.string().min(1),
});
export type OeapiV5IdentifierEntry = z.infer<typeof oeapiV5IdentifierEntry>;

/** `Consumer`: per-consumer extension object, keyed by `consumerKey`. */
export const oeapiV5Consumer = z.looseObject({ consumerKey: z.string().min(1) });
export type OeapiV5Consumer = z.infer<typeof oeapiV5Consumer>;

/** `StudyLoadDescriptor`. */
export const OEAPI_V5_STUDY_LOAD_UNITS = ['contacttime', 'ects', 'sbu', 'sp', 'hour'] as const;
export const oeapiV5StudyLoad = z.looseObject({
  studyLoadUnit: z.string().min(1),
  value: z.number(),
});
export type OeapiV5StudyLoad = z.infer<typeof oeapiV5StudyLoad>;

/** `enumerations/modesOfDelivery.yaml`. */
export const OEAPI_V5_MODES_OF_DELIVERY = [
  'distance-learning',
  'on campus',
  'online',
  'hybrid',
  'situated',
] as const;

/** `enumerations/level.yaml`. */
export const OEAPI_V5_LEVELS = [
  'secondary vocational education',
  'secondary vocational education 1',
  'secondary vocational education 2',
  'secondary vocational education 3',
  'secondary vocational education 4',
  'associate degree',
  'bachelor',
  'master',
  'doctoral',
  'undefined',
  'undivided',
  'nt2-1',
  'nt2-2',
] as const;

/** `enumerations/organizationType.yaml`. */
export const OEAPI_V5_ORGANIZATION_TYPES = [
  'root',
  'institute',
  'department',
  'faculty',
  'branch',
  'academy',
  'school',
] as const;

/** `enumerations/academicSessionType.yaml` (extensible). */
export const OEAPI_V5_ACADEMIC_SESSION_TYPES = [
  'academic year',
  'semester',
  'trimester',
  'quarter',
  'testing period',
  'period',
] as const;

/** `enumerations/offeringType.yaml`. */
export const OEAPI_V5_OFFERING_TYPES = ['program', 'course', 'component'] as const;

const isoDate = z.iso.date();
const id = z.string().min(1).max(200);
const count = z.int().min(0);

/** `Organization` (subset). */
export const oeapiV5Organization = z.looseObject({
  organizationId: id,
  primaryCode: oeapiV5IdentifierEntry.optional(),
  organizationType: z.string().min(1),
  name: languageTypedStrings.min(1),
  shortName: z.string().optional(),
  link: z.string().optional(),
  consumers: z.array(oeapiV5Consumer).optional(),
});
export type OeapiV5Organization = z.infer<typeof oeapiV5Organization>;

/** Reference to another resource: its id, or the expanded object. */
const ref = <T extends z.ZodType>(expanded: T) => z.union([id, expanded]);

/** `AcademicSession`; `parent`/`year` may be ids or expanded sessions. */
export const oeapiV5AcademicSession = z.looseObject({
  academicSessionId: id,
  academicSessionType: z.string().optional(),
  primaryCode: oeapiV5IdentifierEntry.optional(),
  name: languageTypedStrings.min(1),
  startDate: isoDate,
  endDate: isoDate,
  parent: z.union([id, z.looseObject({ academicSessionId: id })]).optional(),
  consumers: z.array(oeapiV5Consumer).optional(),
});
export type OeapiV5AcademicSession = z.infer<typeof oeapiV5AcademicSession>;

/** `Course` (`CourseId` + `CourseProperties`). */
export const oeapiV5Course = z.looseObject({
  courseId: id,
  primaryCode: oeapiV5IdentifierEntry.optional(),
  name: languageTypedStrings.min(1),
  abbreviation: z.string().optional(),
  abstract: languageTypedStrings.optional(),
  description: languageTypedStrings.optional(),
  /** ISO 639-2 three-letter code. */
  teachingLanguage: z.string().optional(),
  level: z.string().optional(),
  studyLoad: oeapiV5StudyLoad.optional(),
  modeOfDelivery: z.array(z.string()).optional(),
  duration: z.string().optional(),
  /** One array of language variants per outcome. */
  learningOutcomes: z.array(languageTypedStrings).optional(),
  admissionRequirements: languageTypedStrings.optional(),
  qualificationRequirements: languageTypedStrings.optional(),
  assessment: languageTypedStrings.optional(),
  /** ISCED-F code (v5 allows one, up to 4 characters). */
  fieldsOfStudy: z.string().optional(),
  link: z.string().optional(),
  consumers: z.array(oeapiV5Consumer).optional(),
  organization: ref(z.looseObject({ organizationId: id })).optional(),
  validFrom: isoDate.optional(),
  validTo: isoDate.optional(),
});
export type OeapiV5Course = z.infer<typeof oeapiV5Course>;

/** `CourseOffering` (`Offering` + course-offering members). */
export const oeapiV5Offering = z.looseObject({
  offeringId: id,
  primaryCode: oeapiV5IdentifierEntry.optional(),
  offeringType: z.string().optional(),
  name: languageTypedStrings.optional(),
  abbreviation: z.string().optional(),
  description: languageTypedStrings.optional(),
  /** ISO 639-2 three-letter code. */
  teachingLanguage: z.string().optional(),
  modeOfDelivery: z.array(z.string()).optional(),
  startDate: isoDate,
  endDate: isoDate,
  enrollStartDate: isoDate.optional(),
  enrollEndDate: isoDate.optional(),
  academicSession: ref(oeapiV5AcademicSession).optional(),
  course: ref(z.looseObject({ courseId: id })).optional(),
  maxNumberStudents: count.optional(),
  enrolledNumberStudents: count.optional(),
  pendingNumberStudents: count.optional(),
  minNumberStudents: count.optional(),
  resultExpected: z.boolean().optional(),
  link: z.string().optional(),
  consumers: z.array(oeapiV5Consumer).optional(),
});
export type OeapiV5Offering = z.infer<typeof oeapiV5Offering>;

/** `Service` (`GET /`). */
export const oeapiV5Service = z.looseObject({
  contactEmail: z.string().optional(),
  specification: z.string().optional(),
  documentation: z.string().optional(),
});
export type OeapiV5Service = z.infer<typeof oeapiV5Service>;

/**
 * `Pagination` envelope. Items are validated one by one by the caller, so one
 * malformed item rejects that entity only; use {@link oeapiV5Page} to type them.
 */
export const oeapiV5PageEnvelope = z.looseObject({
  pageSize: z.int().min(0),
  pageNumber: z.int().min(1),
  hasPreviousPage: z.boolean(),
  hasNextPage: z.boolean(),
  totalPages: z.int().min(0).optional(),
  items: z.array(z.unknown()),
});
export type OeapiV5PageEnvelope = z.infer<typeof oeapiV5PageEnvelope>;

export const oeapiV5Page = <T extends z.ZodType>(item: T) =>
  oeapiV5PageEnvelope.extend({ items: z.array(item) });
export type OeapiV5Page<T> = Omit<OeapiV5PageEnvelope, 'items'> & { items: T[] };
