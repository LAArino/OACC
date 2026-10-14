// SPDX-License-Identifier: EUPL-1.2
import { z } from 'zod';

/** Publication state of courses and offerings (DDL `lifecycle_status`). */
export const lifecycleStatus = z.enum(['draft', 'published', 'withdrawn', 'cancelled']);
export type LifecycleStatus = z.infer<typeof lifecycleStatus>;

/** DDL `source_channel`. */
export const sourceChannel = z.enum(['oeapi', 'csv', 'form']);
export type SourceChannel = z.infer<typeof sourceChannel>;

/** DDL `sync_run_status`. */
export const syncRunStatus = z.enum([
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
]);
export type SyncRunStatus = z.infer<typeof syncRunStatus>;

export const orgType = z.enum([
  'alliance',
  'institution',
  'faculty',
  'department',
  'campus',
  'other',
]);
export type OrgType = z.infer<typeof orgType>;

export const courseLevel = z.enum(['short_cycle', 'bachelor', 'master', 'doctoral', 'other']);
export type CourseLevel = z.infer<typeof courseLevel>;

/**
 * Kind of course (decision 18): a regular course, an Erasmus+ Blended Intensive
 * Programme, a lecture series, or anything else. DDL `courses.kind`.
 */
export const courseKind = z.enum(['course', 'bip', 'lecture_series', 'other']);
export type CourseKind = z.infer<typeof courseKind>;

/** English labels of {@link courseKind} (`/api/public/v1/reference` `kinds`). */
export const COURSE_KIND_LABELS: Readonly<Record<CourseKind, string>> = {
  course: 'Course',
  bip: 'Blended Intensive Programme (BIP)',
  lecture_series: 'Lecture series',
  other: 'Other',
};

/** Value types of alliance attribute definitions (DDL `attribute_definitions.value_type`). */
export const attributeValueType = z.enum(['enum', 'multi_enum', 'boolean', 'text']);
export type AttributeValueType = z.infer<typeof attributeValueType>;

export const sessionType = z.enum([
  'academic_year',
  'semester',
  'trimester',
  'quarter',
  'testing_period',
  'period',
]);
export type SessionType = z.infer<typeof sessionType>;

/** schema.org `courseMode` targets for `delivery_modes.schema_org`. */
export const schemaOrgCourseMode = z.enum(['Onsite', 'Online', 'Blended']);
export type SchemaOrgCourseMode = z.infer<typeof schemaOrgCourseMode>;

export const adminRole = z.enum(['partner_admin', 'alliance_admin']);
export type AdminRole = z.infer<typeof adminRole>;
