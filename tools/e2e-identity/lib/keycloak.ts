// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/**
 * Keycloak: the Admin REST API as the master bootstrap admin (test set-up and
 * clean-up only), and the login pages the browser goes through.
 */
import fs from 'node:fs';
import path from 'node:path';
import { type Page, request } from '@playwright/test';
import { AUTH, IDP_USERS_FILE, KEYCLOAK_ADMIN_USER, SECRETS, TEST_IDP } from './config';
import { bodyText, forgetAccount, freshTotp, readSecret, writeSecret } from './util';

// --- Admin REST API --------------------------------------------------------------

let masterToken: { value: string; at: number } | undefined;

async function adminToken(): Promise<string> {
  if (masterToken && Date.now() - masterToken.at < 30000) return masterToken.value;
  const rq = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const res = await rq.post(`${AUTH}/realms/master/protocol/openid-connect/token`, {
      form: {
        grant_type: 'password',
        client_id: 'admin-cli',
        username: KEYCLOAK_ADMIN_USER,
        password: readSecret(path.join(SECRETS, 'keycloak_admin_password')),
      },
    });
    if (!res.ok()) throw new Error(`Keycloak master admin token: HTTP ${res.status()}`);
    masterToken = {
      value: ((await res.json()) as { access_token: string }).access_token,
      at: Date.now(),
    };
    return masterToken.value;
  } finally {
    await rq.dispose();
  }
}

/** Keycloak Admin REST call on realm `oecp` (through Traefik's allowlisted /admin route). */
export async function keycloakAdmin<T = unknown>(
  method: string,
  apiPath: string,
  data?: unknown,
): Promise<{ status: number; body: T }> {
  const rq = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const res = await rq.fetch(`${AUTH}/admin/realms/oecp${apiPath}`, {
      method,
      headers: { authorization: `Bearer ${await adminToken()}` },
      ...(data === undefined ? {} : { data }),
    });
    return { status: res.status(), body: (await res.json().catch(() => null)) as T };
  } finally {
    await rq.dispose();
  }
}

export interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  attributes?: Record<string, string[]>;
  requiredActions?: string[];
}

export async function findUserByEmail(email: string): Promise<KeycloakUser | undefined> {
  const res = await keycloakAdmin<KeycloakUser[]>(
    'GET',
    `/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=false`,
  );
  return res.body?.[0];
}

/**
 * Deletes the Keycloak user with this e-mail, if any, and the suite's state
 * files for it (test accounts only).
 */
export async function deleteUserByEmail(email: string): Promise<boolean> {
  const user = await findUserByEmail(email);
  if (user) {
    const res = await keycloakAdmin('DELETE', `/users/${user.id}`);
    if (res.status !== 204) throw new Error(`DELETE Keycloak user ${email}: HTTP ${res.status}`);
  }
  forgetAccount(email);
  return user !== undefined;
}

/** Number of users holding a realm role (e.g. alliance_admin). */
export async function usersWithRole(role: string): Promise<number> {
  const res = await keycloakAdmin<unknown[]>('GET', `/roles/${role}/users?max=100`);
  if (res.status !== 200) throw new Error(`GET /roles/${role}/users: HTTP ${res.status}`);
  return res.body.length;
}

// --- Test SAML IdP users (deploy/compose/test-saml-idp/users.json) ---------------

const OID = {
  subjectId: 'urn:oasis:names:tc:SAML:attribute:subject-id',
  mail: 'urn:oid:0.9.2342.19200300.100.1.3',
  schac: 'urn:oid:1.3.6.1.4.1.25178.1.2.9',
};

export interface IdpUser {
  name: string;
  password: string;
  mail: string;
  schac: string;
  subjectId: string;
}

/** A user of the test IdP: login, password and the attributes it asserts. */
export function idpUser(name: string): IdpUser {
  const users = JSON.parse(fs.readFileSync(IDP_USERS_FILE, 'utf8')).users as Record<
    string,
    { password: string; attributes: Record<string, string[]> }
  >;
  const u = users[name];
  if (!u) throw new Error(`unknown test IdP user ${name} (see ${IDP_USERS_FILE})`);
  return {
    name,
    password: u.password,
    mail: u.attributes[OID.mail][0],
    schac: u.attributes[OID.schac][0],
    subjectId: u.attributes[OID.subjectId][0],
  };
}

// --- Browser: Keycloak pages ------------------------------------------------------

/** The secret behind "Unable to scan?" on Keycloak's TOTP enrolment page. */
async function readTotpSecret(page: Page): Promise<string> {
  const manual = page.locator('#mode-manual, a:has-text("Unable to scan")');
  if (await manual.count()) await manual.first().click();
  const key = page.locator('#kc-totp-secret-key');
  await key.waitFor();
  return (await key.innerText()).replace(/\s+/g, '');
}

/**
 * Keycloak's second-factor pages (browser flow or post-broker flow): TOTP
 * enrolment (the secret goes to `secretFile`) or the OTP form. Returns the
 * screens seen, e.g. ['totp-enrolment'] or ['otp'].
 */
export async function keycloakSecondFactor(
  page: Page,
  account: string,
  secretFile: string,
): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForLoadState('networkidle');
    if (!page.url().startsWith(AUTH)) break;
    if (await page.locator('#kc-totp-secret-key, #mode-manual, #totp').count()) {
      const secret = await readTotpSecret(page);
      writeSecret(secretFile, secret);
      await page.fill('#totp', await freshTotp(account, secret));
      if (await page.locator('#userLabel').count()) await page.fill('#userLabel', 'e2e');
      await page.locator('#saveTOTPBtn, input[type=submit], button[type=submit]').first().click();
      seen.push('totp-enrolment');
    } else if (await page.locator('#otp').count()) {
      await page.fill('#otp', await freshTotp(account, readSecret(secretFile)));
      await page.locator('#kc-login, input[type=submit], button[type=submit]').first().click();
      seen.push('otp');
    } else {
      seen.push(`unexpected: ${(await bodyText(page)).slice(0, 200)}`);
      break;
    }
    await page.waitForLoadState('networkidle');
    const err = page.locator('#input-error-otp-code, #input-error, span.pf-m-error');
    if (page.url().startsWith(AUTH) && (await err.count())) {
      seen.push(`error: ${(await err.first().innerText()).trim()}`);
    }
  }
  return seen;
}

/** Username/password form, then the second factor, of a local account. */
export async function localLogin(
  page: Page,
  creds: { email: string; password: string; totpFile: string },
): Promise<string[]> {
  await page.waitForURL((u) => u.href.startsWith(AUTH), { timeout: 20000 });
  await page.locator('#username').waitFor();
  await page.fill('#username', creds.email);
  await page.fill('#password', creds.password);
  await page.locator('#kc-login').click();
  return keycloakSecondFactor(page, creds.email, creds.totpFile);
}

/**
 * Completes Keycloak's execute-actions link (set a password, configure TOTP, in
 * whatever order Keycloak asks) and stores the TOTP secret in `totpFile`.
 * Returns the actions completed.
 */
export async function completeSetupLink(
  page: Page,
  link: string,
  creds: { email: string; password: string; totpFile: string },
): Promise<string[]> {
  const done: string[] = [];
  await page.goto(link, { waitUntil: 'networkidle' });
  const proceed = page.locator('a:has-text("Click here to proceed")');
  if (await proceed.count()) {
    await proceed.first().click();
    await page.waitForLoadState('networkidle');
  }
  for (let i = 0; i < 4; i++) {
    if (await page.locator('#password-new').count()) {
      await page.fill('#password-new', creds.password);
      await page.fill('#password-confirm', creds.password);
      await page.locator('input[type=submit], button[type=submit]').first().click();
      done.push('password');
    } else if (await page.locator('#totp').count()) {
      const secret = await readTotpSecret(page);
      writeSecret(creds.totpFile, secret);
      await page.fill('#totp', await freshTotp(creds.email, secret));
      if (await page.locator('#userLabel').count()) await page.fill('#userLabel', 'e2e');
      await page.locator('input[type=submit], button[type=submit]').first().click();
      done.push('totp');
    } else break;
    await page.waitForLoadState('networkidle');
  }
  return done;
}

/**
 * At the test IdP (SimpleSAMLphp): log in unless it still has a session, and
 * follow its auto-submitted response back to Keycloak. Returns whether the IdP
 * login form was shown.
 */
export async function idpLogin(page: Page, user: IdpUser): Promise<{ idpVisited: boolean }> {
  let idpVisited = false;
  const onRequest = (r: { url(): string; frame(): unknown }) => {
    if (r.frame() === page.mainFrame() && r.url().startsWith(TEST_IDP)) idpVisited = true;
  };
  page.on('request', onRequest);
  try {
    // Leave the authorization endpoint and Keycloak's redirector page first.
    await page.waitForURL(
      (u) =>
        u.href.startsWith(TEST_IDP) ||
        (!u.href.startsWith(AUTH) && !u.href.startsWith('about:')) ||
        (u.href.startsWith(AUTH) &&
          !/\/protocol\/openid-connect\/auth|\/broker\/[^/]+\/login/.test(u.pathname)),
      { timeout: 20000 },
    );
    await page.waitForLoadState('networkidle');
    if (page.url().startsWith(TEST_IDP) && (await page.locator('input[name=username]').count())) {
      await page.fill('input[name=username]', user.name);
      await page.fill('input[name=password]', user.password);
      await page.locator('input[name=password]').press('Enter');
      await page.waitForURL((u) => !u.href.startsWith(TEST_IDP), { timeout: 20000 });
      await page.waitForLoadState('networkidle');
    }
    return { idpVisited };
  } finally {
    page.off('request', onRequest);
  }
}
