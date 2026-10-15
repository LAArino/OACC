// SPDX-License-Identifier: EUPL-1.2
// Admin API response shapes: those the shared schemas do not export (CSV
// uploads, mirroring apps/api/src/admin/uploads/uploads.controller.ts) and the
// course wizard contracts of `@oecp/schemas` under the admin pages' names.
import type {
  AccessMode,
  AdminCourse as SchemaAdminCourse,
  AdminCourseHistory,
  AdminCourseList as SchemaAdminCourseList,
  AdminCourseListItem as SchemaAdminCourseListItem,
  AdminCourseText as SchemaAdminCourseText,
  CourseInput as SchemaCourseInput,
  CourseTextInput as SchemaCourseTextInput,
  AdminHistoryEntry,
  AdminReference,
  AdminRole,
  AuthScheme,
  CsvUploadResponse,
  LifecycleStatus,
  OrgType,
  PartnerIntegration,
  ProblemDetails,
  ProblemError,
  SourceChannel,
  SyncRun,
} from '@oecp/schemas';

/** `POST …/uploads` 201: processed inline, with the finished run and its warnings. */
export interface CsvUploadInlineResponse extends CsvUploadResponse {
  run: SyncRun;
  warnings: ProblemError[];
}

/** `POST …/uploads` 422 problem+json extension members (spec §6.6). */
export interface CsvUploadProblem extends ProblemDetails {
  sync_run_id?: string;
  run_status?: string;
  processed_inline?: boolean;
  error_count?: number;
  warning_count?: number;
}

// ---------------------------------------------------------------------------
// Course wizard (spec §6.4, §8.1): the admin course and offering API contracts
// of `@oecp/schemas` (admin-courses.ts), under the names the admin pages use.
export type { AdminOffering, OfferingInput, OverridesPatch } from '@oecp/schemas';

// Aurora IT Handbook alignment [DL 21]: instructors, five optional texts and the
// completeness of the course against the publication rule. These members are
// additive and optional here, so the panel keeps working against an API that
// does not send them yet; the base types omit them before redeclaring, so the
// result is the same whether or not the installed @oecp/schemas declares them.

/** Optional course texts of the IT Handbook. */
export type AdminHandbookTextField =
  'mode_of_repetition' | 'methods' | 'literature' | 'privacy_notice' | 'remarks';
type HandbookTexts = { [K in AdminHandbookTextField]?: string | null };

/** Fields obligatory for publication that a course lacks (`missing`: field keys). */
export interface AdminCourseCompleteness {
  complete: boolean;
  /** e.g. `description`, `instructors`, `offerings.application_deadline`. */
  missing: string[];
}

export type AdminCourseText = Omit<SchemaAdminCourseText, AdminHandbookTextField> & HandbookTexts;

export type AdminCourse = Omit<SchemaAdminCourse, 'texts' | 'instructors' | 'completeness'> & {
  texts: Record<string, AdminCourseText>;
  instructors?: string[];
  completeness?: AdminCourseCompleteness;
};

export type AdminCourseListItem = Omit<SchemaAdminCourseListItem, 'complete' | 'missing_count'> & {
  /** Every field obligatory for publication is present. */
  complete?: boolean;
  /** How many fields obligatory for publication are missing (`completeness.missing.length`). */
  missing_count?: number;
};

export type AdminCourseList = Omit<SchemaAdminCourseList, 'items'> & {
  items: AdminCourseListItem[];
};

export type CourseTextInput = Omit<SchemaCourseTextInput, AdminHandbookTextField> & HandbookTexts;

export type CourseInput = Omit<SchemaCourseInput, 'texts' | 'instructors'> & {
  /** At most 50 names of at most 200 characters. */
  instructors?: string[];
  texts?: Record<string, CourseTextInput>;
};

/** `GET /api/admin/v1/organizations/{orgId}/reference`. */
export type AdminCourseReference = AdminReference;
export type AdminAttributeDefinitionRef = AdminReference['attribute_definitions'][number];
export type AdminHistoryItem = AdminHistoryEntry;
export type AdminHistory = AdminCourseHistory;
export type AdminLifecycleStatus = LifecycleStatus;
export type AdminSourceChannel = SourceChannel;
export type AdminAttributeValue = string | string[] | boolean;

/** A label as the API sends it: a `{bcp47: text}` map with `en` (or a plain string). */
export type AdminLabel = string | Readonly<Record<string, string>>;

/** Filters of `GET …/courses` as the list page sends them (arrays as repeated keys). */
export interface AdminCourseListQuery {
  q?: string;
  status?: string[];
  kind?: string[];
  source_channel?: string[];
  page?: number;
  page_size?: number;
}

// ---------------------------------------------------------------------------
// Alliance administration (spec §2.1, §8): invitations, integration settings,
// organizations, administrators and network status. The shapes the shared
// schemas already export are re-exported; the others mirror the admin API
// contract of v0.2 (organizations, administrators, network status).
export type {
  AccessMode,
  AuthScheme,
  Invitation as AdminInvitation,
  InvitationList as AdminInvitationList,
  InvitationStatus as AdminInvitationStatus,
  PartnerIntegration as AdminIntegration,
  SyncNowResponse as AdminSyncNowResponse,
  TestConnectionResult as AdminTestConnectionResult,
} from '@oecp/schemas';

/** `POST /organizations/{orgId}/invitations`. */
export interface AdminInvitationInput {
  email: string;
  role: AdminRole;
  ttl_hours?: number;
}

/** `PUT /organizations/{orgId}/integration` (spec §8.2); `secret` omitted keeps the stored one. */
export interface AdminIntegrationInput {
  authoritative_channel: AdminSourceChannel;
  access_mode: AccessMode | null;
  oeapi_version: '5';
  consumer_profile: string;
  base_url: string | null;
  auth_scheme: AuthScheme;
  api_key_header_name: string | null;
  secret?: string | null;
  surfeduhub_endpoint_id: string | null;
  schedule_cron: string;
  schedule_timezone: string;
  page_size: number;
  max_requests_per_second: number;
  withdraw_after_absences: number;
  enabled: boolean;
}

export type AdminIntegrationRun = NonNullable<PartnerIntegration['last_run']>;

/** An organization as `GET /organizations[/{id}]` returns it. */
export interface AdminOrganizationRecord {
  id: string;
  slug: string;
  org_type: OrgType;
  is_partner: boolean;
  parent_id: string | null;
  /** The partner institution the organization belongs to (itself for partners); not editable. */
  partner_id: string | null;
  name: Record<string, string>;
  country_code: string | null;
  schac_home_organization: string | null;
  keycloak_idp_alias: string | null;
  contact_email: string | null;
  default_timezone: string;
  ui_languages: string[];
  website_url: string | null;
  logo_url: string | null;
  erasmus_code: string | null;
  pic: string | null;
  ext_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  counts: { courses_total: number; courses_published: number; sub_units: number };
}

export interface AdminOrganizationList {
  items: AdminOrganizationRecord[];
}

/** `POST /organizations` and `PUT /organizations/{id}` (`slug` is ignored after create). */
export type AdminOrganizationInput = Omit<
  AdminOrganizationRecord,
  'id' | 'partner_id' | 'deleted_at' | 'created_at' | 'updated_at' | 'counts'
>;

/** `GET /organizations/{orgId}/admins` item: a Keycloak user holding an OECP role there. */
export interface AdminAccount {
  sub: string;
  username: string | null;
  email: string | null;
  name: string | null;
  roles: AdminRole[];
  /** Identity provider alias, `local` for OECP accounts. */
  idp: string;
  enabled: boolean;
  email_verified: boolean;
  created_at: string | null;
  last_login_at: string | null;
  /** Pending Keycloak required actions, e.g. `UPDATE_PASSWORD`, `CONFIGURE_TOTP`. */
  required_actions: string[];
}

export interface AdminAccountList {
  items: AdminAccount[];
}

export type AdminNetworkHealth = 'ok' | 'warning' | 'error' | 'unconfigured';

/** `GET /network-status` row: one organization's channel, last run and counts. */
export interface AdminNetworkStatusItem {
  organization: {
    id: string;
    slug: string;
    name: Record<string, string>;
    is_partner: boolean;
    org_type: OrgType;
    parent_id?: string | null;
  };
  /** `form` when no integration is stored. */
  authoritative_channel: AdminSourceChannel;
  access_mode: AccessMode | null;
  enabled: boolean;
  host_approved: boolean;
  secret_configured: boolean;
  schedule_cron: string | null;
  last_run: {
    id: string;
    channel: AdminSourceChannel;
    status: SyncRun['status'];
    is_complete: boolean;
    started_at: string | null;
    finished_at: string | null;
    n_created: number;
    n_updated: number;
    n_unchanged: number;
    n_rejected: number;
    n_withdrawn: number;
  } | null;
  last_success_at: string | null;
  courses_total: number;
  courses_published: number;
  offerings_upcoming: number;
  /** Null when the login service did not answer. */
  admins_count: number | null;
  pending_invitations: number;
  health: AdminNetworkHealth;
}

export interface AdminNetworkStatus {
  generated_at: string;
  items: AdminNetworkStatusItem[];
}

// ---------------------------------------------------------------------------
// Maintenance jobs (spec §8.2, §10): `GET /maintenance/runs`,
// `POST /maintenance/jobs/{name}/run`, alliance_admin only.
export type {
  MaintenanceJobRunResponse as AdminMaintenanceJobRunResponse,
  MaintenanceRun as AdminMaintenanceRun,
  MaintenanceRunList as AdminMaintenanceRunList,
  MaintenanceRunStatus as AdminMaintenanceRunStatus,
  MaintenanceTrigger as AdminMaintenanceTrigger,
} from '@oecp/schemas';
