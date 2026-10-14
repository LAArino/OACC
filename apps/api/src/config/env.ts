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
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
