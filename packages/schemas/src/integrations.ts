// SPDX-License-Identifier: EUPL-1.2
/**
 * Admin API contracts of partner integrations and sync runs (spec §6.2, §8):
 * `/api/admin/v1/organizations/{orgId}/integration…` and `/api/admin/v1/sync-runs…`.
 */
import { z } from 'zod';
import { orgType, sourceChannel, syncRunStatus } from './enums.js';
import { ianaTimeZone, isoDateTime, uuid } from './primitives.js';

export const accessMode = z.enum(['direct', 'surfeduhub']);
export type AccessMode = z.infer<typeof accessMode>;

export const authScheme = z.enum(['none', 'basic', 'bearer', 'api_key_header']);
export type AuthScheme = z.infer<typeof authScheme>;

/**
 * Partner base URL: absolute, no userinfo, query or fragment (DDL CHECK). `http`
 * is accepted by the schema; the API refuses it unless the deployment sets
 * `OECP_ALLOW_INSECURE_PARTNER_HTTP=true` (development mocks only).
 */
export const PARTNER_BASE_URL_PATTERN = /^https?:\/\/[^/?#@\s]+(\/[^?#\s]*)?$/;
export const partnerBaseUrl = z
  .string()
  .max(2048)
  .regex(PARTNER_BASE_URL_PATTERN)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.hostname.length > 0 && !u.username && !u.password;
      } catch {
        return false;
      }
    },
    { message: 'Invalid base URL' },
  );

const CRON_FIELDS: readonly { min: number; max: number; names?: readonly string[] }[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  {
    min: 1,
    max: 12,
    names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  },
  { min: 0, max: 7, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
];

/** Five-field cron (minute hour day-of-month month day-of-week), as BullMQ schedules it. */
export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, i) => {
    const spec = CRON_FIELDS[i];
    if (!spec) return false;
    const value = (token: string): number | undefined => {
      const named = spec.names?.indexOf(token.toUpperCase()) ?? -1;
      if (named >= 0) return named + (i === 3 ? 1 : 0);
      if (!/^\d{1,2}$/.test(token)) return undefined;
      const n = Number(token);
      return n >= spec.min && n <= spec.max ? n : undefined;
    };
    return field.split(',').every((part) => {
      const [range, step, extra] = part.split('/');
      if (extra !== undefined || range === undefined || range === '') return false;
      if (step !== undefined && !/^[1-9]\d{0,1}$/.test(step)) return false;
      if (range === '*') return true;
      const [from, to, more] = range.split('-');
      if (more !== undefined || from === undefined) return false;
      const a = value(from);
      if (a === undefined) return false;
      if (to === undefined) return true;
      const b = value(to);
      return b !== undefined && a <= b;
    });
  });
}

export const cronExpression = z
  .string()
  .trim()
  .max(100)
  .refine(isValidCron, { message: 'Expected a five-field cron expression' });

/**
 * `PUT /api/admin/v1/organizations/{orgId}/integration`: the full settings; omitted
 * members take their defaults. `secret` is write-only: omitted keeps the stored
 * credential, `null` deletes it, a string replaces it (`username:password` for
 * `basic`, the token for `bearer`, the header value for `api_key_header`).
 */
export const integrationUpdateRequest = z
  .strictObject({
    authoritative_channel: sourceChannel.default('form'),
    access_mode: accessMode.nullable().default(null),
    oeapi_version: z.literal('5').default('5'),
    consumer_profile: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .default('eduxchange'),
    base_url: partnerBaseUrl.nullable().default(null),
    auth_scheme: authScheme.default('none'),
    api_key_header_name: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/)
      .nullable()
      .default(null),
    secret: z.string().min(1).max(4096).nullable().optional(),
    surfeduhub_endpoint_id: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,200}$/)
      .nullable()
      .default(null),
    schedule_cron: cronExpression.default('0 3 * * *'),
    schedule_timezone: ianaTimeZone.default('Europe/Brussels'),
    page_size: z.int().min(10).max(250).default(100),
    max_requests_per_second: z.number().positive().max(999.9).default(2),
    withdraw_after_absences: z.int().min(1).max(30).default(3),
    enabled: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.authoritative_channel === 'oeapi' && v.access_mode === null) {
      issue('access_mode', 'oecp.integration.access_mode_required');
    }
    if (v.access_mode === 'direct' && v.base_url === null) {
      issue('base_url', 'oecp.integration.base_url_required');
    }
    if (v.access_mode === 'surfeduhub' && v.surfeduhub_endpoint_id === null) {
      issue('surfeduhub_endpoint_id', 'oecp.integration.endpoint_id_required');
    }
    if (v.auth_scheme === 'api_key_header' && v.api_key_header_name === null) {
      issue('api_key_header_name', 'oecp.integration.header_name_required');
    }
    if (v.auth_scheme === 'basic' && typeof v.secret === 'string' && !v.secret.includes(':')) {
      issue('secret', 'oecp.integration.basic_secret_format');
    }
    if (v.auth_scheme !== 'none' && v.secret === null) {
      issue('secret', 'oecp.integration.secret_required');
    }
    if (v.auth_scheme === 'none' && typeof v.secret === 'string') {
      issue('secret', 'oecp.integration.secret_not_expected');
    }
    if (v.enabled && v.authoritative_channel !== 'oeapi') {
      issue('enabled', 'oecp.sync.channel_disabled');
    }
  });
export type IntegrationUpdateRequest = z.infer<typeof integrationUpdateRequest>;

/** A sync run as listed by the sync monitor (spec §8.1.4). */
export const syncRun = z.object({
  id: uuid,
  organization_id: uuid,
  channel: sourceChannel,
  trigger_kind: z.enum(['schedule', 'manual', 'upload', 'form']),
  triggered_by: z.string().nullable(),
  schema_version: z.string(),
  status: syncRunStatus,
  is_complete: z.boolean(),
  started_at: isoDateTime.nullable(),
  finished_at: isoDateTime.nullable(),
  duration_ms: z.int().nonnegative().nullable(),
  n_created: z.int(),
  n_updated: z.int(),
  n_unchanged: z.int(),
  n_rejected: z.int(),
  n_withdrawn: z.int(),
  error_summary: z.string().nullable(),
  created_at: isoDateTime,
});
export type SyncRun = z.infer<typeof syncRun>;

/** `GET /api/admin/v1/organizations/{orgId}/sync-runs?limit=` */
export const syncRunListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const syncRunList = z.object({ items: z.array(syncRun) });
export type SyncRunList = z.infer<typeof syncRunList>;

export const syncError = z.object({
  id: z.string(),
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  entity_type: z.string().nullable(),
  ext_id: z.string().nullable(),
  file: z.enum(['courses', 'offerings']).nullable(),
  row_number: z.int().nullable(),
  column_name: z.string().nullable(),
  json_pointer: z.string().nullable(),
  created_at: isoDateTime,
});
export type SyncError = z.infer<typeof syncError>;

/** `GET /api/admin/v1/sync-runs/{id}?page=&page_size=&severity=` */
export const syncRunDetailQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(100),
  severity: z.enum(['error', 'warning']).optional(),
});
export type SyncRunDetailQuery = z.infer<typeof syncRunDetailQuery>;

export const syncRunDetail = syncRun.extend({
  /**
   * Courses this run published, or would have published, while missing fields of
   * the IT Handbook publication rule (distinct `ext_id` of the warnings
   * `oecp.content.handbook_incomplete`; decision 21c).
   */
  handbook_incomplete: z.int().min(0),
  errors: z.object({
    items: z.array(syncError),
    page: z.int(),
    page_size: z.int(),
    total: z.int(),
  }),
});
export type SyncRunDetail = z.infer<typeof syncRunDetail>;

/** `GET`/`PUT …/integration`; the credential is never returned. */
export const partnerIntegration = z.object({
  organization_id: uuid,
  authoritative_channel: sourceChannel,
  access_mode: accessMode.nullable(),
  oeapi_version: z.enum(['5', '6']),
  consumer_profile: z.string(),
  base_url: z.string().nullable(),
  auth_scheme: authScheme,
  api_key_header_name: z.string().nullable(),
  /** Whether a credential is stored; the credential itself is write-only. */
  secret_configured: z.boolean(),
  surfeduhub_endpoint_id: z.string().nullable(),
  approved_host: z.string().nullable(),
  approved_by: z.string().nullable(),
  approved_at: isoDateTime.nullable(),
  /** `access_mode = direct` and `approved_host` equals the host of `base_url`. */
  host_approved: z.boolean(),
  schedule_cron: z.string(),
  schedule_timezone: z.string(),
  page_size: z.int(),
  max_requests_per_second: z.number(),
  withdraw_after_absences: z.int(),
  enabled: z.boolean(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
  last_run: syncRun.nullable(),
});
export type PartnerIntegration = z.infer<typeof partnerIntegration>;

/** `POST …/integration/test-connection`; remote failures are `ok: false`, not HTTP errors. */
export const testConnectionResult = z.object({
  ok: z.boolean(),
  /** Request target, without credentials (base URL, or gateway URL plus endpoint id). */
  target: z.string(),
  duration_ms: z.int().nonnegative(),
  service: z
    .object({
      contact_email: z.string().nullable(),
      specification: z.string().nullable(),
      documentation: z.string().nullable(),
    })
    .nullable(),
  /** `primaryCode.code` of the first course of `GET /courses?pageSize=1`, if any. */
  first_course_primary_code: z.string().nullable(),
  courses_available: z.boolean().nullable(),
  error: z.object({ code: z.string(), message: z.string(), status: z.int().optional() }).nullable(),
});
export type TestConnectionResult = z.infer<typeof testConnectionResult>;

/** `POST …/integration/sync-now` (202). */
export const syncNowResponse = z.object({
  sync_run_id: uuid,
  status: z.literal('queued'),
});
export type SyncNowResponse = z.infer<typeof syncNowResponse>;

/**
 * Health of an organization's data supply in `GET /api/admin/v1/network-status`.
 *
 * Channel A (`authoritative_channel = oeapi`), judged on the latest finished
 * harvest (`succeeded`, `partial` or `failed`; queued, running and cancelled
 * runs are ignored):
 *
 * - `error`: harvesting is enabled and the integration is blocked (host not
 *   approved, insecure or missing base URL, missing endpoint id…), or the latest
 *   finished harvest failed;
 * - `warning`: harvesting is disabled; or enabled but no harvest has finished yet,
 *   the latest one is `partial` and incomplete, or it finished longer ago than
 *   twice the longest gap of `schedule_cron` (stale);
 * - `ok`: enabled, the latest finished harvest `succeeded` or is `partial` with
 *   a complete listing, and it is not stale.
 *
 * Other organizations (no integration, or `csv`/`form` authoritative), judged on
 * CSV uploads and form saves:
 *
 * - `unconfigured`: no CSV upload or form save ever;
 * - `warning`: the latest finished one failed;
 * - `ok`: otherwise.
 */
export const networkHealth = z.enum(['ok', 'warning', 'error', 'unconfigured']);
export type NetworkHealth = z.infer<typeof networkHealth>;

/** The run members shown by the network status page. */
export const networkStatusRun = syncRun.pick({
  id: true,
  channel: true,
  status: true,
  is_complete: true,
  started_at: true,
  finished_at: true,
  n_created: true,
  n_updated: true,
  n_unchanged: true,
  n_rejected: true,
  n_withdrawn: true,
});
export type NetworkStatusRun = z.infer<typeof networkStatusRun>;

export const networkStatusItem = z.object({
  organization: z.object({
    id: uuid,
    slug: z.string(),
    name: z.record(z.string(), z.string()),
    is_partner: z.boolean(),
    org_type: orgType,
    parent_id: uuid.nullable(),
  }),
  /** `form` when no integration is stored (the default). */
  authoritative_channel: sourceChannel,
  access_mode: accessMode.nullable(),
  enabled: z.boolean(),
  host_approved: z.boolean(),
  secret_configured: z.boolean(),
  schedule_cron: z.string().nullable(),
  /**
   * Latest run of the authoritative channel: `oeapi` runs for Channel A, else
   * CSV uploads and form saves. Any status, so a running harvest shows here.
   */
  last_run: networkStatusRun.nullable(),
  /** End of the latest run of those channels that succeeded or was partial but complete. */
  last_success_at: isoDateTime.nullable(),
  /** Courses of the organization itself (sub-units are separate items), not deleted. */
  courses_total: z.int().nonnegative(),
  courses_published: z.int().nonnegative(),
  /** Published offerings of non-deleted courses starting today (UTC) or later. */
  offerings_upcoming: z.int().nonnegative(),
  /** Keycloak users with `oecp_org_id` = the organization; null if Keycloak did not answer. */
  admins_count: z.int().nonnegative().nullable(),
  /** Unaccepted, unrevoked, unexpired invitations. */
  pending_invitations: z.int().nonnegative(),
  health: networkHealth,
});
export type NetworkStatusItem = z.infer<typeof networkStatusItem>;

/**
 * `GET /api/admin/v1/network-status` (alliance_admin): every organization that is
 * not deleted, alliance first, then partners, then other organizations, by slug.
 */
export const networkStatus = z.object({
  generated_at: isoDateTime,
  items: z.array(networkStatusItem),
});
export type NetworkStatus = z.infer<typeof networkStatus>;
