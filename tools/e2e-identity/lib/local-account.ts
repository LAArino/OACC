// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/**
 * Local (Keycloak) accounts: the invitation path of an administrator without a
 * university IdP, the bootstrap of the first alliance admin, and the alliance
 * admin's credentials and access token that the other specs use.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Browser } from '@playwright/test';
import { type AdminApiWatch, until, watchAdminApi } from './api';
import {
  BOOTSTRAP_EMAIL,
  COMPOSE_DIR,
  DEV_ALLIANCE_EMAIL,
  PORTAL,
  SECRETS,
  STATE_DIR,
} from './config';
import { completeSetupLink, localLogin, usersWithRole } from './keycloak';
import { setupLinkFromMail } from './mailpit';
import {
  type AccessTokenClaims,
  decodeJwt,
  randomPassword,
  readSecret,
  stateFile,
  writeSecret,
} from './util';

export interface LocalCredentials {
  email: string;
  password: string;
  /** File holding the TOTP secret (base32). */
  totpFile: string;
}

export const newContext = (browser: Browser) =>
  browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });

/** Credentials of a new local test account kept in the state directory. */
export function newLocalCredentials(email: string): LocalCredentials {
  const password = randomPassword();
  writeSecret(stateFile(email, 'password'), password);
  return { email, password, totpFile: stateFile(email, 'totp') };
}

/** Completes the set-up e-mail Keycloak sent to `creds.email` after `since`. */
export async function completeSetupMail(
  browser: Browser,
  creds: LocalCredentials,
  since: number,
): Promise<string[]> {
  const link = await setupLinkFromMail(creds.email, since);
  const ctx = await newContext(browser);
  try {
    return await completeSetupLink(await ctx.newPage(), link, creds);
  } finally {
    await ctx.close();
  }
}

export interface OnboardingResult {
  /** Claims of the (role-less) token used for /invitations/accept. */
  firstClaims: AccessTokenClaims;
  accept: NonNullable<AdminApiWatch['accept']>;
  /** Claims and /me after signing out and in again. */
  finalClaims: AccessTokenClaims;
  me: NonNullable<AdminApiWatch['me']>;
  /** Second-factor screens of the second sign-in. */
  secondLogin: string[];
  finalText: string;
}

/**
 * Invitation link → "Sign in" (PKCE, acr=mfa) → password and OTP → accept →
 * "Sign out and sign in again" → sign in with a fresh OTP code → /en/admin.
 */
export async function acceptAsLocalAccount(
  browser: Browser,
  link: string,
  creds: LocalCredentials,
): Promise<OnboardingResult> {
  const ctx = await newContext(browser);
  try {
    const page = await ctx.newPage();
    const api = watchAdminApi(page);
    await page.goto(link, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await localLogin(page, creds);
    await page.waitForURL(/\/en\/admin\/accept/, { timeout: 30000 });
    const accept = await until(() => api.accept);
    const firstClaims = decodeJwt(await until(() => api.token));

    api.token = undefined;
    api.me = undefined;
    await page.getByRole('button', { name: 'Sign out and sign in again' }).click();
    await page.waitForURL(
      (u) => u.href.startsWith(`${PORTAL}/en/admin`) && !u.href.includes('/accept'),
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const secondLogin = await localLogin(page, creds);
    await page.waitForURL((u) => /\/en\/admin\/?$/.test(u.pathname), { timeout: 30000 });
    const me = await until(() => (api.me?.roles.length ? api.me : undefined));
    const finalClaims = decodeJwt(await until(() => api.token));
    await page
      .getByText('Signed in through')
      .first()
      .waitFor()
      .catch(() => undefined);
    const finalText = (await page.innerText('body')).replace(/\s+/g, ' ');
    return { firstClaims, accept, finalClaims, me, secondLogin, finalText };
  } finally {
    await ctx.close();
  }
}

// --- Bootstrap of the first alliance admin (spec §2.1 "Bootstrap") ---------------

const exec = promisify(execFile);

/** `docker compose run --rm -T api node dist/cli.js …` in deploy/compose. */
export async function apiCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(
      'docker',
      ['compose', 'run', '--rm', '-T', 'api', 'node', 'dist/cli.js', ...args],
      { cwd: COMPOSE_DIR, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

const ALLIANCE_STATE = path.join(STATE_DIR, 'alliance-admin.json');

/**
 * Credentials of a usable alliance admin: the standing dev admin
 * (deploy/compose/secrets/dev_alliance_admin_{password,totp}), else the one a
 * previous bootstrap in this state directory created.
 */
export function knownAllianceCredentials(): LocalCredentials | undefined {
  const devPassword = path.join(SECRETS, 'dev_alliance_admin_password');
  const devTotp = path.join(SECRETS, 'dev_alliance_admin_totp');
  if (fs.existsSync(devPassword) && fs.existsSync(devTotp)) {
    return { email: DEV_ALLIANCE_EMAIL, password: readSecret(devPassword), totpFile: devTotp };
  }
  if (fs.existsSync(ALLIANCE_STATE)) {
    return JSON.parse(fs.readFileSync(ALLIANCE_STATE, 'utf8')) as LocalCredentials;
  }
  return undefined;
}

export interface BootstrapResult {
  cli: { code: number; stdout: string; stderr: string };
  link: string;
  setup: string[];
  onboarding: OnboardingResult;
  creds: LocalCredentials;
}

/**
 * Bootstraps `email` as the first alliance admin of `aurora` (CLI), completes the
 * set-up e-mail and the invitation, and stores the credentials in the state
 * directory for the other specs. Only on a stack without an alliance admin.
 */
export async function bootstrapAllianceAdmin(
  browser: Browser,
  email = BOOTSTRAP_EMAIL,
): Promise<BootstrapResult> {
  const since = Date.now();
  const cli = await apiCli(['bootstrap-alliance-admin', '--email', email, '--org', 'aurora']);
  const link = cli.stdout.trim();
  if (cli.code !== 0 || !/\/admin\/accept#token=/.test(link)) {
    throw new Error(
      `bootstrap-alliance-admin exited ${cli.code}: ${cli.stderr.trim().slice(-800)}`,
    );
  }
  const creds = newLocalCredentials(email);
  const setup = await completeSetupMail(browser, creds, since);
  const onboarding = await acceptAsLocalAccount(browser, link, creds);
  if (onboarding.accept.status === 200) writeSecret(ALLIANCE_STATE, JSON.stringify(creds));
  return { cli, link, setup, onboarding, creds };
}

/** The alliance admin's credentials, bootstrapping one on an empty stack. */
export async function allianceCredentials(browser: Browser): Promise<LocalCredentials> {
  const known = knownAllianceCredentials();
  if (known) return known;
  if ((await usersWithRole('alliance_admin')) > 0) {
    throw new Error(
      'An alliance admin exists but its credentials are unknown: put them in ' +
        'deploy/compose/secrets/dev_alliance_admin_{password,totp} (README.md)',
    );
  }
  const result = await bootstrapAllianceAdmin(browser);
  if (result.onboarding.accept.status !== 200) {
    throw new Error(`bootstrap: accept returned HTTP ${result.onboarding.accept.status}`);
  }
  return result.creds;
}

let cachedToken: { value: string; at: number } | undefined;

/**
 * Access token of the alliance admin (local sign-in with a fresh OTP code in a
 * throwaway context), reused for 150 s of its 300 s lifetime.
 */
export async function allianceToken(browser: Browser): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.at < 150000) return cachedToken.value;
  const creds = await allianceCredentials(browser);
  const ctx = await newContext(browser);
  try {
    const page = await ctx.newPage();
    const api = watchAdminApi(page);
    await page.goto(`${PORTAL}/en/admin`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await localLogin(page, creds);
    await page.waitForURL((u) => u.href.startsWith(`${PORTAL}/en/admin`), { timeout: 30000 });
    const me = await until(() => api.me);
    if (!me.roles.includes('alliance_admin')) {
      throw new Error(
        `${creds.email} is not an alliance admin (roles ${JSON.stringify(me.roles)})`,
      );
    }
    cachedToken = { value: await until(() => api.token), at: Date.now() };
    return cachedToken.value;
  } finally {
    await ctx.close();
  }
}

export const allianceEmail = async (browser: Browser) => (await allianceCredentials(browser)).email;
