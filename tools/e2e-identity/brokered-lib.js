// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
// Shared helpers of the brokered (eduGAIN-style) identity checks against the
// local Compose stack with the `dev` profile and the test SAML IdP
// (`test-saml-idp`, realm IdP `urv`). Used by brokered-accept.js and
// brokered-negative.js. Tokens, invitation tokens, OTP codes and passwords are
// never printed.
const { chromium, request } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { totp } = require('./totp');

const PORTAL = process.env.OECP_PORTAL_URL ?? 'https://oecp.localhost';
const AUTH = process.env.OECP_AUTH_URL ?? 'https://auth.oecp.localhost';
const MAILPIT = process.env.OECP_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const IDP_ORIGIN = process.env.OECP_TEST_IDP_URL ?? 'http://127.0.0.1:8091';
const SECRETS = process.env.OECP_COMPOSE_SECRETS ?? path.join(__dirname, '../../deploy/compose/secrets');
const OUT = process.env.OECP_E2E_SHOTS ?? path.join(__dirname, 'shots');
const IDP_USERS_FILE = path.join(__dirname, '../../deploy/compose/test-saml-idp/users.json');
const ALLIANCE_EMAIL = process.env.OECP_ALLIANCE_ADMIN_EMAIL ?? 'admin@aurora-universities.eu';
fs.mkdirSync(OUT, { recursive: true });

const idpUsers = JSON.parse(fs.readFileSync(IDP_USERS_FILE, 'utf8')).users;
const OID = {
  subjectId: 'urn:oasis:names:tc:SAML:attribute:subject-id',
  mail: 'urn:oid:0.9.2342.19200300.100.1.3',
  schac: 'urn:oid:1.3.6.1.4.1.25178.1.2.9',
};
/** Test IdP user: login name, password, asserted mail, schacHomeOrganization and subject-id. */
function idpUser(name) {
  const u = idpUsers[name];
  if (!u) throw new Error(`unknown test IdP user ${name} (see ${IDP_USERS_FILE})`);
  return {
    name,
    password: u.password,
    mail: u.attributes[OID.mail][0],
    schac: u.attributes[OID.schac][0],
    subjectId: u.attributes[OID.subjectId][0],
  };
}

/** Removes secrets from URLs before they are printed. */
const red = (u) =>
  u.replace(/(token|key|code|session_state|SAMLRequest|SAMLResponse|RelayState|Signature|execution|tab_id|client_data|AuthState)=[^&#\s]*/g, '$1=…');
const text = async (p) => (await p.innerText('body')).replace(/\s+/g, ' ').trim();
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeJwt(jwt) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}
/** The claims of spec §4 that matter here (never the token itself). */
function claimSummary(c) {
  return {
    iss: c.iss, aud: c.aud, azp: c.azp, sub: c.sub, acr: c.acr, idp: c.idp ?? '(absent)',
    org_id: c.org_id ?? '(absent)', roles: c.roles ?? '(absent)', email: c.email,
    email_verified: c.email_verified, name: c.name, auth_time: c.auth_time !== undefined,
    schac_home_organization: 'schac_home_organization' in c ? c.schac_home_organization : '(absent)',
    lifetime_s: c.exp - c.iat,
  };
}

// --- TOTP: Keycloak refuses a code reused within its 30 s period, also across
// processes, so the last period used per account is remembered in the temp dir.
function totpState(account) {
  return path.join(os.tmpdir(), `oecp-e2e-totp-${account.replace(/[^a-z0-9]/gi, '_')}`);
}
async function freshTotp(account, secret) {
  const file = totpState(account);
  let last = -1;
  try { last = Number(fs.readFileSync(file, 'utf8')); } catch {}
  let counter = Math.floor(Date.now() / 30000);
  // Also avoid the last 3 s of a period (the code could expire in flight).
  if (counter <= last || 30000 - (Date.now() % 30000) < 3000) {
    const wait = 30000 - (Date.now() % 30000) + 500;
    console.log(`   (waiting ${Math.round(wait / 1000)} s for a fresh OTP period)`);
    await sleep(wait);
    counter = Math.floor(Date.now() / 30000);
  }
  fs.writeFileSync(file, String(counter));
  return totp(secret);
}

/**
 * Second-factor screens of Keycloak (browser flow or post-broker flow): TOTP
 * enrolment (secret read from "Unable to scan?", stored in `secretFile`) or the
 * OTP form. Returns the list of screens seen.
 */
async function keycloakSecondFactor(page, { account, secretFile, step }) {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForLoadState('networkidle');
    if (!page.url().startsWith(AUTH)) break;
    if (await page.locator('#kc-totp-secret-key, #mode-manual').count() || (await page.locator('#totp').count())) {
      const manual = page.locator('#mode-manual, a:has-text("Unable to scan")');
      if (await manual.count()) { await manual.first().click(); await page.waitForTimeout(400); }
      const secret = (await page.locator('#kc-totp-secret-key').innerText()).replace(/\s+/g, '');
      fs.writeFileSync(secretFile, secret, { mode: 0o600 });
      await shot(page, `${step}-keycloak-totp-setup`);
      seen.push(`TOTP enrolment ("${(await page.title()).trim()}"), secret stored in ${path.relative(process.cwd(), secretFile)}`);
      await page.fill('#totp', await freshTotp(account, secret));
      if (await page.locator('#userLabel').count()) await page.fill('#userLabel', 'e2e');
      await page.locator('#saveTOTPBtn, input[type=submit], button[type=submit]').first().click();
    } else if (await page.locator('#otp').count()) {
      const secret = fs.readFileSync(secretFile, 'utf8').trim();
      await page.fill('#otp', await freshTotp(account, secret));
      await shot(page, `${step}-keycloak-otp`);
      seen.push('OTP form');
      await page.locator('#kc-login, input[type=submit], button[type=submit]').first().click();
    } else {
      const t = await text(page);
      seen.push(`unexpected Keycloak page: ${t.slice(0, 200)}`);
      await shot(page, `${step}-keycloak-unexpected`);
      break;
    }
    await page.waitForLoadState('networkidle');
    const err = page.locator('#input-error-otp-code, #input-error, .kc-feedback-text, span.pf-m-error');
    if (page.url().startsWith(AUTH) && (await err.count())) seen.push(`error: ${(await err.first().innerText()).trim()}`);
  }
  return seen;
}

/**
 * At the test IdP (SimpleSAMLphp): log in unless the IdP still has a session
 * (single sign-on), then follow its auto-submitted response back to Keycloak.
 */
async function idpLogin(page, user, step) {
  const seen = [];
  const idpHits = [];
  const onRequest = (r) => { if (r.frame() === page.mainFrame() && r.url().startsWith(IDP_ORIGIN)) idpHits.push(r.url()); };
  page.on('request', onRequest);
  try {
    // Leave the authorization endpoint and Keycloak's redirector page first.
    await page.waitForURL((u) => u.href.startsWith(IDP_ORIGIN) || u.href.startsWith(PORTAL) ||
      (u.href.startsWith(AUTH) && !/\/protocol\/openid-connect\/auth|\/broker\/[^/]+\/login/.test(u.pathname)), { timeout: 20000 });
    await page.waitForLoadState('networkidle');
    if (page.url().startsWith(IDP_ORIGIN) && (await page.locator('input[name=username]').count())) {
      seen.push(`test IdP login page ${red(page.url()).replace(/\?.*/, '?…')}`);
      await page.fill('input[name=username]', user.name);
      await page.fill('input[name=password]', user.password);
      await shot(page, `${step}-idp-login`);
      seen.push(`IdP login form submitted (user ${user.name})`);
      await page.locator('input[name=password]').press('Enter');
      await page.waitForURL((u) => !u.href.startsWith(IDP_ORIGIN), { timeout: 20000 });
      await page.waitForLoadState('networkidle');
    } else if (idpHits.length) {
      seen.push('IdP single sign-on: existing IdP session, no login form');
    } else {
      seen.push('the test IdP was NOT visited');
    }
    seen.push(`IdP endpoints visited: ${[...new Set(idpHits.map((u) => new URL(u).pathname).filter((p) => p.endsWith('.php')))].join(', ') || 'none'}`);
    seen.push(`back at ${red(page.url()).replace(/\?.*/, '?…')}`);
    return seen;
  } finally {
    page.off('request', onRequest);
  }
}

/** Records the bearer token of every admin API request and the accept response. */
function watchAdminApi(page) {
  const state = { token: undefined, accept: undefined, me: undefined };
  page.on('request', (r) => {
    const h = r.headers().authorization;
    if (r.url().startsWith(`${PORTAL}/api/admin/v1/`) && h?.startsWith('Bearer ')) state.token = h.slice(7);
  });
  page.on('response', async (r) => {
    if (r.url() === `${PORTAL}/api/admin/v1/invitations/accept`) {
      state.accept = { status: r.status(), body: await r.json().catch(() => null) };
    } else if (r.url() === `${PORTAL}/api/admin/v1/me` && r.ok()) {
      state.me = await r.json().catch(() => null);
    }
  });
  return state;
}

async function newBrowserContext() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('   [browser console error]', m.text().slice(0, 200)); });
  return { browser, ctx, page };
}

/** Local login of the alliance administrator in a throwaway browser; returns its access token. */
async function allianceToken() {
  const password = fs.readFileSync(path.join(SECRETS, 'dev_alliance_admin_password'), 'utf8').trim();
  const secretFile = path.join(SECRETS, 'dev_alliance_admin_totp');
  const { browser, page } = await newBrowserContext();
  try {
    const api = watchAdminApi(page);
    await page.goto(`${PORTAL}/en/admin`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL((u) => u.href.startsWith(AUTH), { timeout: 20000 });
    await page.waitForLoadState('networkidle');
    await page.fill('#username', ALLIANCE_EMAIL);
    await page.fill('#password', password);
    await page.locator('#kc-login').click();
    await keycloakSecondFactor(page, { account: ALLIANCE_EMAIL, secretFile, step: '00-alliance' });
    await page.waitForURL((u) => u.href.startsWith(`${PORTAL}/en/admin`), { timeout: 20000 });
    for (let i = 0; i < 40 && !api.token; i++) await sleep(250);
    if (!api.token) throw new Error('no admin API call with a bearer token after the alliance login');
    return { token: api.token, obtainedAt: Date.now() };
  } finally {
    await browser.close();
  }
}

/** Admin API call with a bearer token (TLS errors ignored for the dev certificate). */
async function adminApi(token, method, apiPath, body) {
  const rq = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const res = await rq.fetch(`${PORTAL}/api/admin/v1${apiPath}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { data: body } : {}),
    });
    const raw = await res.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch {}
    return { status: res.status(), body: json ?? raw };
  } finally {
    await rq.dispose();
  }
}

/** Keycloak Admin REST API as the master bootstrap admin (through the allowlisted /admin route). */
async function keycloakAdmin(method, apiPath) {
  const password = fs.readFileSync(path.join(SECRETS, 'keycloak_admin_password'), 'utf8').trim();
  const rq = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const tok = await rq.post(`${AUTH}/realms/master/protocol/openid-connect/token`, {
      form: { grant_type: 'password', client_id: 'admin-cli', username: process.env.KEYCLOAK_ADMIN_USER ?? 'admin', password },
    });
    if (!tok.ok()) throw new Error(`master admin token: HTTP ${tok.status()}`);
    const { access_token } = await tok.json();
    const res = await rq.fetch(`${AUTH}/admin/realms/oecp${apiPath}`, { method, headers: { authorization: `Bearer ${access_token}` } });
    return { status: res.status(), body: await res.json().catch(() => null) };
  } finally {
    await rq.dispose();
  }
}

async function organizationId(slug) {
  const rq = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const ref = await (await rq.get(`${PORTAL}/api/public/v1/reference`)).json();
    const org = ref.organizations.find((o) => o.slug === slug);
    if (!org) throw new Error(`organization ${slug} not in /api/public/v1/reference`);
    return org;
  } finally {
    await rq.dispose();
  }
}

/** Newest invitation link e-mailed to `to` after `since` (Mailpit REST API). */
async function invitationLinkFromMailpit(to, since) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
    const m = list.messages.find((x) => x.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) && new Date(x.Created).getTime() >= since - 2000 && x.Subject.startsWith('Invitation'));
    if (m) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const link = (full.Text.match(/https:\/\/\S+\/admin\/accept#\S+/) || [])[0];
      if (link) return { link, subject: m.Subject };
    }
    await sleep(500);
  }
  throw new Error(`no invitation e-mail to ${to} in Mailpit`);
}

/** Creates an invitation through the admin API and returns its id and e-mailed link. */
async function invite(token, { email, role, organizationId: orgId, ttlHours = 24 }) {
  const since = Date.now();
  const res = await adminApi(token, 'POST', '/invitations', { email, role, organization_id: orgId, ttl_hours: ttlHours });
  if (res.status !== 201 && res.status !== 200) throw new Error(`POST /invitations: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  const { link, subject } = await invitationLinkFromMailpit(email, since);
  return { id: res.body.id, link, subject, status: res.status };
}

/** The invitation link with its secret token hidden, for printing. */
const redactLink = (link) => link.replace(/token=[^&]*/, 'token=…');

function check(label, ok, detail = '') {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

module.exports = {
  PORTAL, AUTH, MAILPIT, IDP_ORIGIN, SECRETS, OUT,
  idpUser, red, redactLink, text, shot, sleep, decodeJwt, claimSummary, freshTotp,
  keycloakSecondFactor, idpLogin, watchAdminApi, newBrowserContext, allianceToken,
  adminApi, keycloakAdmin, organizationId, invite, check,
};
