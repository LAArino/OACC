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
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
