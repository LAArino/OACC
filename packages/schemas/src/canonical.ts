// SPDX-License-Identifier: EUPL-1.2
/**
 * Canonical DTOs produced by every ingestion channel (spec §6.1) and validated
 * before `CanonicalWriter.upsert()`. Field names follow the DDL (spec §5);
 * references to other entities use natural keys (`*_ext_id`) because only the
 * writer resolves UUIDs. Custom issue messages are stable error codes.
 */
import { z } from 'zod';
import {
  courseLevel,
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

export const courseText = z.object({
  title: z.string().min(1).max(500),
  abstract: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  learning_outcomes: z.string().nullable().optional(),
  prerequisites: z.string().nullable().optional(),
  assessment: z.string().nullable().optional(),
  keywords: z.array(z.string().min(1)).default([]),
  is_machine_translated: z.boolean().default(false),
});
export type CourseText = z.infer<typeof courseText>;

export const course = z
  .object({
    ext_id: extId,
    source_ref: z.string().min(1).nullable().optional(),
    status: lifecycleStatus,
    ects: z.number().positive().max(120),
    level: courseLevel.nullable().optional(),
    eqf_level: z.int().min(1).max(8).nullable().optional(),
    teaching_hours: z.number().positive().max(99999.9).nullable().optional(),
    teaching_unit_ext_id: extId.nullable().optional(),
    info_url: httpsUrl.nullable().optional(),
    contact_email: email.nullable().optional(),
    /** First code is the primary one. */
    isced_codes: z.array(iscedCode).default([]),
    /** Keyed by primary language subtag. */
    texts: z.record(primaryLanguage, courseText),
  })
  .superRefine((c, ctx) => {
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
