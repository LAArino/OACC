// SPDX-License-Identifier: EUPL-1.2
import { z } from 'zod';

const url = (protocols: readonly string[]) =>
  z.url().refine((v) => protocols.includes(new URL(v).protocol), {
    message: `Expected ${protocols.join(' or ')} URL`,
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * Request logs carry no client address, `X-Forwarded-For`, `X-Real-IP` or
   * `User-Agent`. When true, a salted SHA-256 of the client address is added
   * (never the address itself). Access logs with addresses are Traefik's (spec §10).
   */
  OECP_LOG_CLIENT_ADDRESSES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_URL: url(['postgres:', 'postgresql:']),
  VALKEY_URL: url(['redis:', 'rediss:', 'valkey:', 'valkeys:']),
  /** `https://{auth-host}/realms/oecp`; compared exactly with the `iss` claim. */
  KEYCLOAK_ISSUER: url(['https:', 'http:']),
  KEYCLOAK_JWKS_URL: url(['https:', 'http:']),
  /** Docker secret holding the AES-256-GCM master key for the `secrets` table. */
  OECP_MASTER_KEY_FILE: z.string().min(1),
  /** Public origin of the portal, e.g. `https://campus.example.org`; used in invitation links. */
  OECP_PUBLIC_BASE_URL: url(['https:', 'http:']).transform((v) => v.replace(/\/+$/, '')),
  /** Internal base URL of Keycloak for the Admin API, e.g. `http://keycloak:8080`. */
  KEYCLOAK_ADMIN_URL: url(['https:', 'http:']).transform((v) => v.replace(/\/+$/, '')),
  KEYCLOAK_REALM: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default('oecp'),
  /** Confidential client with the realm-management roles manage-users and view-users. */
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).default('oecp-backend'),
  /** Docker secret holding the client secret of `KEYCLOAK_ADMIN_CLIENT_ID`. */
  KEYCLOAK_ADMIN_CLIENT_SECRET_FILE: z.string().min(1),
  /** Outgoing mail relay; when empty, invitation e-mails are only logged (development). */
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(25),
  SMTP_FROM: z.string().min(3).default('no-reply@example.org'),
  /** SMTP AUTH user (with `SMTP_PASSWORD_FILE`); empty: relay by source address. */
  SMTP_USER: z.string().default(''),
  /** Docker secret holding the SMTP AUTH password; required with `SMTP_USER`. */
  SMTP_PASSWORD_FILE: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** true: require STARTTLS (fail if not offered); false: STARTTLS when offered. */
  SMTP_STARTTLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Escape hatch: with `NODE_ENV=production` an empty `SMTP_HOST` stops the
   * process (invitation links would only be logged) unless this is `true`.
   */
  OECP_MAIL_LOG_LINKS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** SURFeduhub gateway for `access_mode = surfeduhub` (spec §6.2.2); allowlisted host. */
  SURFEDUHUB_GATEWAY_URL: url(['https:'])
    .transform((v) => v.replace(/\/+$/, ''))
    .default('https://gateway.surfeduhub.nl'),
  /** `db:<uuid>` of the alliance-level SURFeduhub Basic credential (`username:password`). */
  SURFEDUHUB_SECRET_REF: z
    .string()
    .regex(/^(db:[0-9a-f-]{36}|openbao:[A-Za-z0-9/_-]+)$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /**
   * Directory of uploaded CSV files (spec §6.3, kept 90 days), shared by `api`
   * (writes) and `worker` (reads, purges): `<dir>/<orgId>/<uploadId>/<file>.csv`.
   */
  OECP_UPLOADS_DIR: z.string().min(1).default('/data/uploads'),
  /**
   * Development only: lets partner endpoints use plain http, any port and private,
   * loopback, CGNAT or ULA addresses (e.g. the OEAPI mock on the Compose network).
   * Link-local, multicast and unspecified addresses stay refused. Never in production.
   */
  OECP_ALLOW_INSECURE_PARTNER_HTTP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Aurora IT Handbook publication rule (decision 21c, spec §6.1): `warn` publishes
   * incomplete courses with the warning `oecp.content.handbook_incomplete`;
   * `enforce` stores them as `draft` with the same warning. Read by `api` (form,
   * CSV uploads processed inline) and `worker` (harvests, queued uploads): set both.
   */
  OECP_PUBLISH_RULE: z.enum(['warn', 'enforce']).default('warn'),
  /**
   * Prometheus metrics (spec §10): `GET /metrics` on the api (port `PORT`) and on
   * the worker's internal server (`WORKER_HEALTH_PORT`). Internal network only:
   * Traefik routes neither. `false`: both answer 404 and nothing is collected.
   */
  OECP_METRICS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Commit the image was built from, exported as `oecp_build_info{commit}`; else `unknown`. */
  OECP_GIT_COMMIT: z
    .string()
    .regex(/^[0-9A-Za-z._-]{1,64}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Worker process only: port of its internal `/health`, `/ready` and `/metrics` HTTP server. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  /** Spec §10 retention (months): `ext_metadata_history` partitions (raw payloads). */
  OECP_RETENTION_HISTORY_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
  /** Spec §10 retention (months): `sync_errors`. */
  OECP_RETENTION_SYNC_ERRORS_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
  /** Spec §10 retention (months): `sync_runs` (with their remaining errors). */
  OECP_RETENTION_SYNC_RUNS_MONTHS: z.coerce.number().int().min(1).max(120).default(24),
  /** Spec §10 retention (months): `audit_log`. */
  OECP_RETENTION_AUDIT_MONTHS: z.coerce.number().int().min(1).max(240).default(36),
  /**
   * Spec §5, §10 retention (months): records soft-deleted (`deleted_at`) longer
   * ago are purged (courses with their texts, ISCED codes and offerings;
   * offerings; organizations without remaining children).
   */
  OECP_RETENTION_SOFT_DELETED_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
  /** Spec §2.2: OECP roles are removed after this many days without activity. */
  OECP_DORMANCY_DAYS: z.coerce.number().int().min(30).max(3650).default(180),
  /**
   * Spec §2.2: when true (the default), the dormancy job only reports the
   * administrators it would revoke (log and `maintenance_runs.details`).
   */
  OECP_DORMANCY_DRY_RUN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * Spec §2.2, §10: Keycloak accounts without an OECP role are deleted this many
   * months after their last role removal (revocation or dormancy). At most
   * `OECP_RETENTION_AUDIT_MONTHS`, since the audit rows are the evidence.
   */
  OECP_ACCOUNT_DELETE_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
  /**
   * When true (the default), the `account-cleanup` job only reports the accounts
   * it would delete (log and `maintenance_runs.details`).
   */
  OECP_ACCOUNT_CLEANUP_DRY_RUN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * Federation metadata aggregate for the daily `idp-metadata-refresh` job (spec §4),
   * e.g. the eduGAIN aggregate `https://mds.edugain.org/edugain-v2.xml`. When empty
   * the job only logs that it is not configured.
   */
  OECP_IDP_METADATA_URL: z
    .union([z.literal('').transform(() => undefined), z.url({ protocol: /^https$/ })])
    .optional(),
  /** PEM certificate of the aggregate's signer (pinned); required with `OECP_IDP_METADATA_URL`. */
  OECP_IDP_METADATA_SIGNING_CERT_FILE: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Refuse an aggregate without `validUntil` (one in the past is always refused). */
  OECP_IDP_METADATA_REQUIRE_VALID_UNTIL: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Last good aggregate, reused for up to 7 days when a download or verification fails. */
  OECP_IDP_METADATA_CACHE_DIR: z.string().min(1).default('/data/idp-metadata'),
  /** Download limit in bytes (default 150 MiB: the eduGAIN aggregate is ~94 MB). */
  OECP_IDP_METADATA_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(150 * 1024 * 1024),
  /** Also refresh IdPs that are disabled in Keycloak. */
  OECP_IDP_METADATA_INCLUDE_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * The worker also runs the job shortly after it starts (reusing an aggregate cached
   * less than 24 h ago), so a keycloak-config-cli re-import is corrected within minutes.
   */
  OECP_IDP_METADATA_REFRESH_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/** Cross-field rules, checked by {@link validateEnv}. */
function crossFieldRules(env: Env, ctx: z.RefinementCtx): void {
  if (env.OECP_IDP_METADATA_URL && !env.OECP_IDP_METADATA_SIGNING_CERT_FILE) {
    ctx.addIssue({
      code: 'custom',
      path: ['OECP_IDP_METADATA_SIGNING_CERT_FILE'],
      message: 'Required when OECP_IDP_METADATA_URL is set (pinned signing certificate)',
    });
  }
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST && !env.OECP_MAIL_LOG_LINKS) {
    ctx.addIssue({
      code: 'custom',
      path: ['SMTP_HOST'],
      message:
        'Required in production: without it invitation e-mails are not sent and their links ' +
        'are only logged. Set OECP_MAIL_LOG_LINKS=true to accept that explicitly',
    });
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD_FILE)) {
    ctx.addIssue({
      code: 'custom',
      path: [env.SMTP_USER ? 'SMTP_PASSWORD_FILE' : 'SMTP_USER'],
      message: 'SMTP_USER and SMTP_PASSWORD_FILE go together (SMTP authentication)',
    });
  }
  if (env.OECP_ACCOUNT_DELETE_MONTHS > env.OECP_RETENTION_AUDIT_MONTHS) {
    ctx.addIssue({
      code: 'custom',
      path: ['OECP_ACCOUNT_DELETE_MONTHS'],
      message:
        'Must not exceed OECP_RETENTION_AUDIT_MONTHS (the revocation audit rows are the evidence)',
    });
  }
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.superRefine(crossFieldRules).safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
