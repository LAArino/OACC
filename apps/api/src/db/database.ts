// SPDX-License-Identifier: EUPL-1.2
/**
 * Kysely table types for db/migrations (hand-written; tables not listed here are
 * not queried yet). `date` columns are strings (see db.module.ts), `numeric`
 * columns come back from pg as strings, `bigint` identities as strings.
 */
import type {
  AdminRole,
  AttributeOption,
  AttributeValueType,
  CourseAttributes,
  CourseKind,
  LifecycleStatus,
  LocalizedLabel,
  SourceChannel,
  SyncRunStatus,
} from '@oecp/schemas';
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Numeric = ColumnType<string, number | string, number | string>;
type Json<T> = ColumnType<T, T, T>;
export type OverrideMap = Record<string, { value: unknown; by: string; at: string }>;
/** `overrides` jsonb (spec §5 "Overrides"); DEFAULT '{}' makes it optional on insert. */
type Overrides = ColumnType<OverrideMap, OverrideMap | undefined, OverrideMap>;
/** jsonb object with DEFAULT '{}' (optional on insert). */
type JsonObject<T> = ColumnType<T, T | undefined, T>;

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
  created_at: Timestamp;
  updated_at: Timestamp;
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
  created_at: Timestamp;
  updated_at: Timestamp;
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
  kind: Generated<CourseKind>;
  ects: Numeric;
  /** Primary level, `levels[1]` (kept consistent by CanonicalWriter). */
  level: string | null;
  levels: Generated<string[]>;
  attributes: JsonObject<CourseAttributes>;
  eqf_level: number | null;
  teaching_hours: Numeric | null;
  info_url: string | null;
  contact_email: string | null;
  overrides: Overrides;
  content_hash: Buffer | null;
  absent_count: Generated<number>;
  last_seen_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
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
  overrides: Overrides;
  updated_at: Timestamp;
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
  /** `{lang: text}` (primary subtags). */
  application_instructions: JsonObject<Record<string, string>>;
  overrides: Overrides;
  content_hash: Buffer | null;
  absent_count: Generated<number>;
  last_seen_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface AttributeDefinitionsTable {
  key: string;
  value_type: AttributeValueType;
  label: Json<LocalizedLabel>;
  description: Json<LocalizedLabel> | null;
  options: Json<AttributeOption[]> | null;
  filterable: Generated<boolean>;
  show_as_tag: Generated<boolean>;
  sort_order: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
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
  created_at: Timestamp;
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
  created_at: Timestamp;
}

export interface SecretsTable {
  id: string;
  purpose: string;
  key_version: number;
  nonce: Buffer;
  /** AES-256-GCM ciphertext followed by the 16-byte authentication tag. */
  ciphertext: Buffer;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PartnerIntegrationsTable {
  id: Generated<string>;
  organization_id: string;
  authoritative_channel: Generated<SourceChannel>;
  access_mode: 'direct' | 'surfeduhub' | null;
  oeapi_version: Generated<'5' | '6'>;
  consumer_profile: Generated<string>;
  base_url: string | null;
  auth_scheme: Generated<'none' | 'basic' | 'bearer' | 'api_key_header'>;
  api_key_header_name: string | null;
  secret_ref: string | null;
  surfeduhub_endpoint_id: string | null;
  approved_host: string | null;
  approved_by: string | null;
  approved_at: Timestamp | null;
  schedule_cron: Generated<string>;
  schedule_timezone: Generated<string>;
  page_size: Generated<number>;
  max_requests_per_second: ColumnType<string, number | string | undefined, number | string>;
  withdraw_after_absences: Generated<number>;
  enabled: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type HistoryEntityType = 'organization' | 'academic_session' | 'course' | 'course_offering';

export interface ExtMetadataHistoryTable {
  id: Generated<string>;
  received_at: Timestamp;
  sync_run_id: string;
  organization_id: string;
  entity_type: HistoryEntityType;
  entity_id: string | null;
  ext_id: string;
  channel: SourceChannel;
  schema_version: string;
  payload_sha256: Buffer;
  validation_result: 'accepted' | 'rejected';
  raw_payload: Json<unknown>;
}

export interface AdminInvitationsTable {
  id: Generated<string>;
  /** Stored lower-case; compared case-insensitively with the `email` claim. */
  email: string;
  role: AdminRole;
  organization_id: string;
  /** SHA-256 of the 256-bit token; the token itself is never stored. */
  token_sha256: Buffer;
  /** JWT `sub` of the inviting administrator, or `system:<job>`. */
  invited_by: string;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  accepted_sub: string | null;
  revoked_at: Timestamp | null;
  /** Timestamp already makes the column optional on insert (DEFAULT now()). */
  created_at: Timestamp;
}

export interface AuditLogTable {
  /** bigint identity; pg returns int8 as string. */
  id: Generated<string>;
  occurred_at: Timestamp;
  /** JWT `sub` or `system:<job>`. */
  actor_sub: string;
  actor_org_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | null | undefined,
    Record<string, unknown> | null
  >;
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
  attribute_definitions: AttributeDefinitionsTable;
  secrets: SecretsTable;
  partner_integrations: PartnerIntegrationsTable;
  sync_runs: SyncRunsTable;
  sync_errors: SyncErrorsTable;
  ext_metadata_history: ExtMetadataHistoryTable;
  admin_invitations: AdminInvitationsTable;
  audit_log: AuditLogTable;
}
