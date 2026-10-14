// SPDX-License-Identifier: EUPL-1.2
/**
 * Kysely table types for db/migrations/0001_init.sql (hand-written stub;
 * tables not listed here are not queried yet). `date` columns are strings
 * (see db.module.ts), `numeric` columns come back from pg as strings.
 */
import type { LifecycleStatus, LocalizedLabel, SourceChannel, SyncRunStatus } from '@oecp/schemas';
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Numeric = ColumnType<string, number | string, number | string>;
type Json<T> = ColumnType<T, T, T>;
type Overrides = Json<Record<string, { value: unknown; by: string; at: string }>>;

export interface OrganizationsTable {
  id: Generated<string>;
  parent_id: string | null;
  partner_id: string | null;
  org_type: 'alliance' | 'institution' | 'faculty' | 'department' | 'campus' | 'other';
  is_partner: Generated<boolean>;
  slug: string;
  name: Json<LocalizedLabel>;
  schac_home_organization: string | null;
  erasmus_code: string | null;
  pic: string | null;
  country_code: string | null;
  website_url: string | null;
  logo_url: string | null;
  contact_email: string | null;
  default_timezone: Generated<string>;
  ui_languages: Generated<string[]>;
  ext_id: string | null;
  keycloak_idp_alias: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface DeliveryModesTable {
  code: string;
  label: Json<LocalizedLabel>;
  schema_org: 'Onsite' | 'Online' | 'Blended';
  sort_order: Generated<number>;
  active: Generated<boolean>;
}

export interface IscedBroadFieldsTable {
  code: string;
  label: Json<LocalizedLabel>;
}

export interface AcademicSessionsTable {
  id: Generated<string>;
  organization_id: string;
  ext_id: string;
  parent_id: string | null;
  session_type: string;
  name: Json<LocalizedLabel>;
  start_date: string;
  end_date: string;
  source_channel: SourceChannel;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface CoursesTable {
  id: Generated<string>;
  organization_id: string;
  teaching_unit_id: string | null;
  ext_id: string;
  source_ref: string | null;
  source_channel: SourceChannel;
  status: Generated<LifecycleStatus>;
  ects: Numeric;
  level: string | null;
  eqf_level: number | null;
  teaching_hours: Numeric | null;
  info_url: string | null;
  contact_email: string | null;
  overrides: Generated<Overrides>;
  content_hash: Buffer | null;
  absent_count: Generated<number>;
  last_seen_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface CourseTextsTable {
  course_id: string;
  lang: string;
  title: string;
  abstract: string | null;
  description: string | null;
  learning_outcomes: string | null;
  prerequisites: string | null;
  assessment: string | null;
  keywords: Generated<string[]>;
  is_machine_translated: Generated<boolean>;
  overrides: Generated<Overrides>;
  updated_at: Generated<Timestamp>;
  search_vector: ColumnType<string, never, never>;
}

export interface CourseIscedCodesTable {
  course_id: string;
  isced_code: string;
  broad_code: string;
  is_primary: Generated<boolean>;
}

export interface CourseOfferingsTable {
  id: Generated<string>;
  course_id: string;
  ext_offering_id: string;
  source_ref: string | null;
  source_channel: SourceChannel;
  status: Generated<LifecycleStatus>;
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
  seats_updated_at: Timestamp | null;
  application_url: string | null;
  overrides: Generated<Overrides>;
  content_hash: Buffer | null;
  absent_count: Generated<number>;
  last_seen_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface CourseOfferingDeliveryModesTable {
  offering_id: string;
  mode_code: string;
}

export interface SyncRunsTable {
  id: Generated<string>;
  organization_id: string;
  channel: SourceChannel;
  trigger_kind: 'schedule' | 'manual' | 'upload' | 'form';
  triggered_by: string | null;
  schema_version: string;
  upload_object_key: string | null;
  status: Generated<SyncRunStatus>;
  is_complete: Generated<boolean>;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  n_created: Generated<number>;
  n_updated: Generated<number>;
  n_unchanged: Generated<number>;
  n_rejected: Generated<number>;
  n_withdrawn: Generated<number>;
  error_summary: string | null;
  created_at: Generated<Timestamp>;
}

export interface SyncErrorsTable {
  id: Generated<string>;
  sync_run_id: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  entity_type: string | null;
  ext_id: string | null;
  file: 'courses' | 'offerings' | null;
  row_number: number | null;
  column_name: string | null;
  json_pointer: string | null;
  created_at: Generated<Timestamp>;
}

export interface Database {
  organizations: OrganizationsTable;
  delivery_modes: DeliveryModesTable;
  isced_broad_fields: IscedBroadFieldsTable;
  academic_sessions: AcademicSessionsTable;
  courses: CoursesTable;
  course_texts: CourseTextsTable;
  course_isced_codes: CourseIscedCodesTable;
  course_offerings: CourseOfferingsTable;
  course_offering_delivery_modes: CourseOfferingDeliveryModesTable;
  sync_runs: SyncRunsTable;
  sync_errors: SyncErrorsTable;
}
