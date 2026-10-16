// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/**
 * Where the suite finds the stack, and where it keeps the secrets it creates.
 * Every value can be overridden through the environment (README.md).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../../..');

/** Public portal origin (Nuxt, /api/admin, /api/public). */
export const PORTAL = (process.env.OECP_E2E_PORTAL ?? 'https://oecp.localhost').replace(/\/+$/, '');
/** Keycloak origin: the auth host of the portal unless set. */
export const AUTH = (process.env.OECP_E2E_AUTH ?? `https://auth.${new URL(PORTAL).host}`).replace(
  /\/+$/,
  '',
);
export const MAILPIT = (process.env.OECP_E2E_MAILPIT ?? 'http://127.0.0.1:8025').replace(
  /\/+$/,
  '',
);
/** The dev-only test SAML IdP (service `test-saml-idp`) playing URV. */
export const TEST_IDP = (process.env.OECP_E2E_TEST_IDP ?? 'http://127.0.0.1:8091').replace(
  /\/+$/,
  '',
);
/** deploy/compose: `docker compose run … api node dist/cli.js` runs from here. */
export const COMPOSE_DIR = process.env.OECP_E2E_COMPOSE_DIR ?? path.join(REPO, 'deploy/compose');
/** Docker secrets of the stack (keycloak_admin_password) and the dev_* test-account files. */
export const SECRETS = process.env.OECP_COMPOSE_SECRETS ?? path.join(COMPOSE_DIR, 'secrets');
export const IDP_USERS_FILE = path.join(COMPOSE_DIR, 'test-saml-idp/users.json');
export const ORGANIZATIONS_SEED = path.join(REPO, 'apps/api/db/seed/organizations.json');
/** Master-realm bootstrap admin (KEYCLOAK_ADMIN_USER of deploy/compose/.env). */
export const KEYCLOAK_ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';

/**
 * Passwords and TOTP seeds created by the suite, and the last OTP period used per
 * account. Private directory outside the repository: $OECP_E2E_STATE_DIR, else
 * $RUNNER_TEMP/oecp-e2e on GitHub Actions, else the system temp directory.
 */
export const STATE_DIR =
  process.env.OECP_E2E_STATE_DIR ?? path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'oecp-e2e');
fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

/** E-mail of the alliance admin the bootstrap creates on an empty stack (CI). */
export const BOOTSTRAP_EMAIL = process.env.OECP_E2E_BOOTSTRAP_EMAIL ?? 'ci.alliance@e2e.example';
/** E-mail of the standing local dev admin whose secrets are dev_alliance_admin_*. */
export const DEV_ALLIANCE_EMAIL =
  process.env.OECP_E2E_ALLIANCE_EMAIL ?? 'admin@aurora-universities.eu';
/** Organization with an IdP alias but no identity provider in the realm (spec d). */
export const UNROUTED_ORG = process.env.OECP_E2E_UNROUTED_ORG ?? 'cbs';

/** Short id of this run, for unique test addresses (`local.<run>@e2e.example`). */
export const RUN_ID = Date.now().toString(36);
