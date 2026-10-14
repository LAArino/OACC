// SPDX-License-Identifier: EUPL-1.2
// Integration settings form (spec §8.1, §8.2): form state ↔ the full `PUT
// …/integration` document, the client-side checks mirroring the API's, and the
// write-only credential (`secret`: omitted keeps, `null` deletes, a string
// replaces; `username:password` for basic).
import { isValidCron, PARTNER_BASE_URL_PATTERN } from '@oecp/schemas';
import type {
  AccessMode,
  AdminIntegration,
  AdminIntegrationInput,
  AdminSourceChannel,
  AuthScheme,
} from '~/types/admin';
import type { FormIssue } from './adminCourseForm';
import { isTimeZone } from './adminCourseForm';

export const CHANNELS: readonly AdminSourceChannel[] = ['form', 'csv', 'oeapi'];
export const ACCESS_MODES: readonly AccessMode[] = ['direct', 'surfeduhub'];
export const AUTH_SCHEMES: readonly AuthScheme[] = ['none', 'basic', 'bearer', 'api_key_header'];

/** Schedules offered as presets; anything else is a custom five-field cron expression. */
export const CRON_PRESETS = [
  { key: 'daily', cron: '0 3 * * *' },
  { key: 'twiceDaily', cron: '0 3,15 * * *' },
  { key: 'every6h', cron: '0 */6 * * *' },
  { key: 'weekly', cron: '0 3 * * 1' },
] as const;
export const CUSTOM_CRON = 'custom';

/** What happens to the stored credential on save. */
export type SecretAction = 'keep' | 'replace' | 'delete';

export interface IntegrationForm {
  authoritative_channel: AdminSourceChannel;
  /** '' = not set. */
  access_mode: AccessMode | '';
  consumer_profile: string;
  base_url: string;
  auth_scheme: AuthScheme;
  api_key_header_name: string;
  secret_action: SecretAction;
  /** Token (bearer) or header value (api_key_header). */
  secret: string;
  basic_username: string;
  basic_password: string;
  surfeduhub_endpoint_id: string;
  /** A preset cron expression or CUSTOM_CRON. */
  schedule_preset: string;
  schedule_cron: string;
  schedule_timezone: string;
  page_size: string;
  max_requests_per_second: string;
  withdraw_after_absences: string;
  enabled: boolean;
}

/** Defaults of the API for an organization without integration (spec §8.2). */
export const INTEGRATION_DEFAULTS = {
  authoritative_channel: 'form',
  consumer_profile: 'eduxchange',
  auth_scheme: 'none',
  schedule_cron: '0 3 * * *',
  schedule_timezone: 'Europe/Brussels',
  page_size: 100,
  max_requests_per_second: 2,
  withdraw_after_absences: 3,
} as const;

function presetOf(cron: string): string {
  return CRON_PRESETS.find((p) => p.cron === cron.trim())?.cron ?? CUSTOM_CRON;
}

/** The form for the stored settings, or the API defaults when none exist yet. */
export function integrationFormOf(integration: AdminIntegration | null): IntegrationForm {
  const d = INTEGRATION_DEFAULTS;
  const cron = integration?.schedule_cron ?? d.schedule_cron;
  return {
    authoritative_channel: integration?.authoritative_channel ?? d.authoritative_channel,
    access_mode: integration?.access_mode ?? '',
    consumer_profile: integration?.consumer_profile ?? d.consumer_profile,
    base_url: integration?.base_url ?? '',
    auth_scheme: integration?.auth_scheme ?? d.auth_scheme,
    api_key_header_name: integration?.api_key_header_name ?? '',
    secret_action: integration?.secret_configured ? 'keep' : 'replace',
    secret: '',
    basic_username: '',
    basic_password: '',
    surfeduhub_endpoint_id: integration?.surfeduhub_endpoint_id ?? '',
    schedule_preset: presetOf(cron),
    schedule_cron: cron,
    schedule_timezone: integration?.schedule_timezone ?? d.schedule_timezone,
    page_size: String(integration?.page_size ?? d.page_size),
    max_requests_per_second: String(
      integration?.max_requests_per_second ?? d.max_requests_per_second,
    ),
    withdraw_after_absences: String(
      integration?.withdraw_after_absences ?? d.withdraw_after_absences,
    ),
    enabled: integration?.enabled ?? false,
  };
}

const CONSUMER_PROFILE = /^[A-Za-z0-9._-]{1,64}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const ENDPOINT_ID = /^[A-Za-z0-9._-]{1,200}$/;
const MAX_SECRET = 4096;

function int(value: string): number | null {
  const v = value.trim();
  return /^\d{1,6}$/.test(v) ? Number(v) : null;
}

function decimal(value: string): number | null {
  const v = value.trim().replace(',', '.');
  return /^\d{1,4}(\.\d{1,3})?$/.test(v) ? Number(v) : null;
}

/** Whether the base URL is acceptable to the API (absolute http(s), no userinfo, query or fragment). */
export function isPartnerBaseUrl(value: string): boolean {
  if (value.length > 2048 || !PARTNER_BASE_URL_PATTERN.test(value)) return false;
  try {
    const url = new URL(value);
    return url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Host part of a base URL as the API compares it with `approved_host`. */
export function hostOfUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The credential sections apply to direct access only (SURFeduhub uses the deployment's). */
export const usesCredentials = (form: IntegrationForm) => form.access_mode === 'direct';

/**
 * Client-side checks with the API's rules (integrationUpdateRequest). Field
 * names are the form's; `code` is an `admin.integration.validation.*` key.
 */
export function validateIntegrationForm(
  form: IntegrationForm,
  context: { secretConfigured: boolean },
): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (field: string, code: string) => issues.push({ field, code });
  const oeapi = form.authoritative_channel === 'oeapi';

  if (oeapi && !form.access_mode) add('access_mode', 'accessModeRequired');
  if (!CONSUMER_PROFILE.test(form.consumer_profile.trim()))
    add('consumer_profile', 'consumerProfile');

  if (form.access_mode === 'direct') {
    const url = form.base_url.trim();
    if (!url) add('base_url', 'baseUrlRequired');
    else if (!isPartnerBaseUrl(url)) add('base_url', 'baseUrl');
  }
  if (form.access_mode === 'surfeduhub') {
    const id = form.surfeduhub_endpoint_id.trim();
    if (!id) add('surfeduhub_endpoint_id', 'endpointRequired');
    else if (!ENDPOINT_ID.test(id)) add('surfeduhub_endpoint_id', 'endpointId');
  }

  if (usesCredentials(form)) {
    if (form.auth_scheme === 'api_key_header') {
      const name = form.api_key_header_name.trim();
      if (!name) add('api_key_header_name', 'headerNameRequired');
      else if (!HEADER_NAME.test(name)) add('api_key_header_name', 'headerName');
    }
    if (form.auth_scheme !== 'none') {
      const action = context.secretConfigured ? form.secret_action : 'replace';
      if (action === 'delete') add('secret_action', 'secretRequired');
      if (action === 'replace') {
        if (form.auth_scheme === 'basic') {
          if (!form.basic_username) add('basic_username', 'usernameRequired');
          else if (form.basic_username.includes(':')) add('basic_username', 'usernameColon');
          if (!form.basic_password) add('basic_password', 'passwordRequired');
          if (form.basic_username.length + form.basic_password.length + 1 > MAX_SECRET) {
            add('basic_password', 'secretTooLong');
          }
        } else if (!form.secret) add('secret', 'secretRequired');
        else if (form.secret.length > MAX_SECRET) add('secret', 'secretTooLong');
      }
    }
  }

  const cron =
    form.schedule_preset === CUSTOM_CRON ? form.schedule_cron.trim() : form.schedule_preset;
  if (!cron || cron.length > 100 || !isValidCron(cron)) add('schedule_cron', 'cron');
  if (!isTimeZone(form.schedule_timezone)) add('schedule_timezone', 'timezone');

  const pageSize = int(form.page_size);
  if (pageSize === null || pageSize < 10 || pageSize > 250) add('page_size', 'pageSize');
  const rps = decimal(form.max_requests_per_second);
  if (rps === null || rps <= 0 || rps > 999.9) add('max_requests_per_second', 'rate');
  const absences = int(form.withdraw_after_absences);
  if (absences === null || absences < 1 || absences > 30)
    add('withdraw_after_absences', 'absences');

  if (form.enabled && !oeapi) add('enabled', 'enabledNeedsOeapi');
  return issues;
}

/**
 * The `PUT` document. Fields of the other access mode are sent only when valid
 * (so switching modes does not lose a stored value nor fail on a stale one).
 * The credential is sent only with direct access: `replace` sends the new value,
 * `delete` (or scheme `none` with a stored credential) sends `null`, `keep` omits it.
 */
export function integrationBody(
  form: IntegrationForm,
  context: { secretConfigured: boolean; stored?: AdminIntegration | null },
): AdminIntegrationInput {
  const url = form.base_url.trim();
  const endpoint = form.surfeduhub_endpoint_id.trim();
  const direct = usesCredentials(form);
  const stored = context.stored ?? null;
  const cron =
    form.schedule_preset === CUSTOM_CRON ? form.schedule_cron.trim() : form.schedule_preset;

  const body: AdminIntegrationInput = {
    authoritative_channel: form.authoritative_channel,
    access_mode: form.access_mode || null,
    oeapi_version: '5',
    consumer_profile: form.consumer_profile.trim(),
    base_url: url && isPartnerBaseUrl(url) ? url : null,
    // Hidden credential settings (not direct) are sent back as stored.
    auth_scheme: direct ? form.auth_scheme : (stored?.auth_scheme ?? 'none'),
    api_key_header_name: direct
      ? form.auth_scheme === 'api_key_header'
        ? form.api_key_header_name.trim()
        : null
      : (stored?.api_key_header_name ?? null),
    surfeduhub_endpoint_id: endpoint && ENDPOINT_ID.test(endpoint) ? endpoint : null,
    schedule_cron: cron,
    schedule_timezone: form.schedule_timezone,
    page_size: int(form.page_size) ?? INTEGRATION_DEFAULTS.page_size,
    max_requests_per_second:
      decimal(form.max_requests_per_second) ?? INTEGRATION_DEFAULTS.max_requests_per_second,
    withdraw_after_absences:
      int(form.withdraw_after_absences) ?? INTEGRATION_DEFAULTS.withdraw_after_absences,
    enabled: form.enabled,
  };
  if (!direct) return body;
  if (form.auth_scheme === 'none') {
    if (context.secretConfigured) body.secret = null;
    return body;
  }
  const action = context.secretConfigured ? form.secret_action : 'replace';
  if (action === 'delete') body.secret = null;
  else if (action === 'replace') {
    body.secret =
      form.auth_scheme === 'basic' ? `${form.basic_username}:${form.basic_password}` : form.secret;
  }
  return body;
}

/** Form field of a server pointer (`/secret` → the visible credential control). */
export function integrationFieldOf(pointer: string, form: IntegrationForm): string {
  const field = pointer.replace(/^\//, '').split('/')[0] ?? '';
  if (field === 'secret') return form.auth_scheme === 'basic' ? 'basic_username' : 'secret';
  return field;
}

/** `admin.integration.validation.*` key of a stable server code, if the page explains it. */
export const INTEGRATION_SERVER_CODES: Readonly<Record<string, string>> = {
  'oecp.integration.access_mode_required': 'accessModeRequired',
  'oecp.integration.base_url_required': 'baseUrlRequired',
  'oecp.integration.endpoint_id_required': 'endpointRequired',
  'oecp.integration.header_name_required': 'headerNameRequired',
  'oecp.integration.basic_secret_format': 'usernameColon',
  'oecp.integration.secret_required': 'secretRequired',
  'oecp.integration.secret_not_expected': 'secretNotExpected',
  'oecp.integration.insecure_url': 'insecureUrl',
  'oecp.sync.channel_disabled': 'enabledNeedsOeapi',
};
