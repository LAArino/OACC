// SPDX-License-Identifier: EUPL-1.2
/**
 * Canonical DTOs produced by every ingestion channel (spec §6.1) and validated
 * before `CanonicalWriter.upsert()`. Field names follow the DDL (spec §5);
 * references to other entities use natural keys (`*_ext_id`) because only the
 * writer resolves UUIDs. Custom issue messages are stable error codes.
 */
import { z } from 'zod';
import { courseAttributes } from './attributes.js';
import {
  courseKind,
  courseLevel,
  type CourseLevel,
  lifecycleStatus,
  orgType,
  schemaOrgCourseMode,
  sessionType,
} from './enums.js';
import {
  deliveryModeCode,
  email,
  extId,
  httpsUrl,
  ianaTimeZone,
  iscedCode,
  isoDate,
  isoDateTime,
  languageTag,
  localizedLabel,
  primaryLanguage,
  slug,
  uuid,
} from './primitives.js';

export const organization = z.object({
  parent_id: uuid.nullable().optional(),
  org_type: orgType,
  is_partner: z.boolean().default(false),
  slug,
  name: localizedLabel,
  schac_home_organization: z.string().min(1).max(253).nullable().optional(),
  erasmus_code: z.string().min(1).max(40).nullable().optional(),
  pic: z
    .string()
    .regex(/^[0-9]{9}$/)
    .nullable()
    .optional(),
  country_code: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  website_url: httpsUrl.nullable().optional(),
  logo_url: httpsUrl.nullable().optional(),
  contact_email: email.nullable().optional(),
  default_timezone: ianaTimeZone.default('Europe/Brussels'),
  ui_languages: z.array(languageTag).min(1).default(['en']),
  ext_id: z.string().min(1).max(200).nullable().optional(),
  keycloak_idp_alias: z.string().min(1).max(100).nullable().optional(),
});
export type Organization = z.infer<typeof organization>;

export const deliveryMode = z.object({
  code: deliveryModeCode,
  label: localizedLabel,
  schema_org: schemaOrgCourseMode,
  sort_order: z.int().min(-32768).max(32767).default(0),
  active: z.boolean().default(true),
});
export type DeliveryMode = z.infer<typeof deliveryMode>;

export const academicSession = z
  .object({
    ext_id: extId,
    parent_ext_id: extId.nullable().optional(),
    session_type: sessionType,
    name: localizedLabel,
    start_date: isoDate,
    end_date: isoDate,
  })
  .superRefine((s, ctx) => {
    if (s.end_date < s.start_date) {
      ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'oecp.content.date_order' });
    }
  });
export type AcademicSession = z.infer<typeof academicSession>;

/**
 * The five optional multilingual texts of the Aurora IT Handbook §3.4 (decision
 * 21b), columns of `course_texts` (migration 0007): mode of repetition (e.g.
 * "every winter semester"), teaching methods, literature, privacy notice and
 * free remarks. None of them is required to publish.
 */
export const HANDBOOK_TEXT_FIELDS = [
  'mode_of_repetition',
  'methods',
  'literature',
  'privacy_notice',
  'remarks',
] as const;
export type HandbookTextField = (typeof HANDBOOK_TEXT_FIELDS)[number];

export const courseText = z.object({
  title: z.string().min(1).max(500),
  abstract: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  learning_outcomes: z.string().nullable().optional(),
  prerequisites: z.string().nullable().optional(),
  assessment: z.string().nullable().optional(),
  mode_of_repetition: z.string().nullable().optional(),
  methods: z.string().nullable().optional(),
  literature: z.string().nullable().optional(),
  privacy_notice: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  keywords: z.array(z.string().min(1)).default([]),
  is_machine_translated: z.boolean().default(false),
});
export type CourseText = z.infer<typeof courseText>;

/** `courses.instructors` limits (DDL `oecp_valid_instructors`, migration 0007). */
export const INSTRUCTORS_MAX = 50;
export const INSTRUCTOR_MAX_LENGTH = 200;

/**
 * One entry of `courses.instructors` (decision 21a): the name of a member of the
 * teaching staff, or a role description ("Course team, University of Iceland"),
 * as the university publishes it in its own catalogue. Trimmed, 1–200 characters.
 */
export const instructorName = z
  .string()
  .trim()
  .min(1, { error: 'oecp.content.invalid_value' })
  .max(INSTRUCTOR_MAX_LENGTH, { error: 'oecp.content.invalid_value' });

/** `courses.instructors`: at most 50 distinct entries, primary (e.g. the coordinator) first. */
export const instructorList = z
  .array(instructorName)
  .max(INSTRUCTORS_MAX, { error: 'oecp.content.invalid_value' })
  .refine((list) => new Set(list).size === list.length, { error: 'oecp.content.invalid_value' });

/**
 * `level` (primary, the one OEAPI can express) and `levels` (all study cycles)
 * kept consistent: a non-empty `levels` wins and its first entry is the level;
 * otherwise a lone `level` becomes `[level]`. Duplicates are dropped.
 */
export function resolveLevels(
  level: CourseLevel | null | undefined,
  levels: readonly CourseLevel[] | null | undefined,
): { level: CourseLevel | null; levels: CourseLevel[] } {
  const list = [...new Set(levels ?? [])];
  if (list.length > 0) return { level: list[0] as CourseLevel, levels: list };
  return level ? { level, levels: [level] } : { level: null, levels: [] };
}

/** `course_offerings.application_instructions`: how to apply, keyed by primary language subtag. */
export const applicationInstructions = z.record(primaryLanguage, z.string().min(1).max(20_000));
export type ApplicationInstructions = z.infer<typeof applicationInstructions>;

export const course = z
  .object({
    ext_id: extId,
    source_ref: z.string().min(1).nullable().optional(),
    status: lifecycleStatus,
    kind: courseKind.default('course'),
    ects: z.number().positive().max(120),
    /** Primary level; equals `levels[0]` when `levels` is not empty. */
    level: courseLevel.nullable().optional(),
    /** Every study cycle the course is open to, primary first (decision 18). */
    levels: z.array(courseLevel).max(5).default([]),
    eqf_level: z.int().min(1).max(8).nullable().optional(),
    teaching_hours: z.number().positive().max(99999.9).nullable().optional(),
    teaching_unit_ext_id: extId.nullable().optional(),
    info_url: httpsUrl.nullable().optional(),
    contact_email: email.nullable().optional(),
    /** First code is the primary one. */
    isced_codes: z.array(iscedCode).default([]),
    /** Teaching staff as published by the university (decision 21a); may be empty. */
    instructors: instructorList.default([]),
    /** Keyed by primary language subtag. */
    texts: z.record(primaryLanguage, courseText),
    /** Alliance attributes; checked against `attribute_definitions` by the writer. */
    attributes: courseAttributes.default({}),
  })
  .superRefine((c, ctx) => {
    if (new Set(c.levels).size !== c.levels.length) {
      ctx.addIssue({ code: 'custom', path: ['levels'], message: 'oecp.content.invalid_value' });
    }
    if (c.levels.length > 0 && c.level != null && c.level !== c.levels[0]) {
      ctx.addIssue({ code: 'custom', path: ['level'], message: 'oecp.content.invalid_value' });
    }
    if (c.status === 'published' && !c.texts['en']) {
      ctx.addIssue({
        code: 'custom',
        path: ['texts', 'en'],
        message: 'oecp.content.english_missing',
      });
    }
    if (new Set(c.isced_codes).size !== c.isced_codes.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['isced_codes'],
        message: 'oecp.content.duplicate_isced',
      });
    }
  });
export type Course = z.infer<typeof course>;

export const courseOffering = z
  .object({
    course_ext_id: extId,
    ext_offering_id: extId,
    source_ref: z.string().min(1).nullable().optional(),
    status: lifecycleStatus,
    academic_session_ext_id: extId.nullable().optional(),
    start_date: isoDate,
    end_date: isoDate,
    enrol_start_date: isoDate.nullable().optional(),
    application_deadline: isoDate.nullable().optional(),
    timezone: ianaTimeZone,
    teaching_languages: z.array(languageTag).min(1),
    delivery_modes: z.array(deliveryModeCode).min(1),
    campus: z.string().max(200).nullable().optional(),
    max_students: z.int().positive().nullable().optional(),
    alliance_seats: z.int().nonnegative().nullable().optional(),
    seats_available: z.int().nonnegative().nullable().optional(),
    seats_updated_at: isoDateTime.nullable().optional(),
    application_url: httpsUrl.nullable().optional(),
    /** How to apply (e.g. a nomination process), next to `application_url`. */
    application_instructions: applicationInstructions.default({}),
  })
  .superRefine((o, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (o.end_date < o.start_date) issue('end_date', 'oecp.content.date_order');
    if (o.application_deadline && o.application_deadline > o.end_date) {
      issue('application_deadline', 'oecp.content.date_order');
    }
    if (
      o.enrol_start_date &&
      o.application_deadline &&
      o.enrol_start_date > o.application_deadline
    ) {
      issue('enrol_start_date', 'oecp.content.date_order');
    }
    if (o.alliance_seats != null && o.max_students != null && o.alliance_seats > o.max_students) {
      issue('alliance_seats', 'oecp.content.seats_exceed_capacity');
    }
    if (o.seats_available != null && o.seats_updated_at == null) {
      issue('seats_updated_at', 'oecp.content.seats_without_timestamp');
    }
    if (o.seats_available != null && o.max_students != null && o.seats_available > o.max_students) {
      issue('seats_available', 'oecp.content.seats_exceed_capacity');
    }
  });
export type CourseOffering = z.infer<typeof courseOffering>;
