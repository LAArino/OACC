// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
// Negative acceptance checks of the brokered path (spec §2.1 step 5), each with
// a fresh invitation to organization `urv` that is revoked afterwards:
//   email  invitation for someone.else@urv.cat, IdP asserts partner.admin@urv.cat
//          -> 403 oecp.invitation.mismatch (e-mail)
//   idp    invitation for the local alliance admin's address, `&idp=urv` removed
//          from the link, local sign-in (no `idp` claim = local)
//          -> 403 oecp.invitation.mismatch (identity provider)
//   schac  invitation for visiting.scholar@urv.cat, whose IdP entry asserts
//          schacHomeOrganization=example.edu instead of urv.cat
//          -> 403 oecp.invitation.mismatch (home organization)
//   linking the IdP asserts the e-mail of the local alliance admin
//          (email.collision): first-broker-login must NOT link the accounts;
//          Keycloak refuses the login and creates no user (no invitation needed)
// Usage: node brokered-negative.js [email|idp|schac|linking|all]   (default all)
const fs = require('node:fs');
const path = require('node:path');
const L = require('./brokered-lib');

const ALLIANCE_EMAIL = process.env.OECP_ALLIANCE_ADMIN_EMAIL ?? 'admin@aurora-universities.eu';
const DETAIL = {
  email: 'The e-mail address of the signed-in account is not the invited address',
  idp: "The account did not sign in through the organization's identity provider",
  schac: 'The identity provider did not assert the home organization of the invitation',
};

/** No account linking by e-mail (spec §2.1 step 3, realm flow oecp-first-broker-login). */
async function runLinking() {
  console.log('\n== case linking');
  const user = L.idpUser('email.collision');
  const before = await L.keycloakAdmin('GET', `/users?email=${encodeURIComponent(user.mail)}&exact=true`);
  const local = before.body?.[0];
  console.log(`   existing local account with ${user.mail}: ${local ? local.username : 'none'}`);
  const { browser, page } = await L.newBrowserContext();
  try {
    await page.goto(`${L.PORTAL}/en/admin`, { waitUntil: 'networkidle' });
    await page.getByLabel('Your university', { exact: true }).selectOption('urv');
    await page.getByRole('button', { name: 'Continue to your university' }).click();
    for (const s of await L.idpLogin(page, user, '35-linking')) console.log(`   ${s}`);
    await page.waitForLoadState('networkidle');
    await L.shot(page, '36-linking-keycloak-result');
    const t = await L.text(page);
    console.log(`   Keycloak page: ${L.red(page.url()).replace(/\?.*/, '?…')}: ${t.slice(0, 220)}`);
    L.check('linking: login refused at Keycloak (not back at the portal)', page.url().startsWith(L.AUTH) && !page.url().startsWith(L.PORTAL));
  } finally {
    await browser.close();
  }
  if (local) {
    const fed = await L.keycloakAdmin('GET', `/users/${local.id}/federated-identity`);
    console.log(`   federated identities of the local account: ${JSON.stringify(fed.body)}`);
    L.check('linking: local account NOT linked to IdP urv', Array.isArray(fed.body) && !fed.body.some((f) => f.identityProvider === 'urv'));
  }
  const created = await L.keycloakAdmin('GET', `/users?username=${encodeURIComponent(user.subjectId)}&exact=true`);
  L.check(`linking: no brokered user ${user.subjectId} created`, Array.isArray(created.body) && created.body.length === 0);
}

async function runCase(name, urv, alliance) {
  console.log(`\n== case ${name}`);
  const spec = {
    email: { invitee: 'someone.else@urv.cat', idpUser: 'partner.admin', secret: 'dev_partner_admin_totp' },
    idp: { invitee: ALLIANCE_EMAIL, local: true, secret: 'dev_alliance_admin_totp' },
    schac: { invitee: L.idpUser('visiting.scholar').mail, idpUser: 'visiting.scholar', secret: 'dev_visiting_scholar_totp' },
  }[name];
  const inv = await L.invite(alliance.token, { email: spec.invitee, role: 'partner_admin', organizationId: urv.id });
  console.log(`   invitation ${inv.id} for ${spec.invitee}: ${L.redactLink(inv.link)}`);
  const link = spec.local ? inv.link.replace(/&idp=[^&]*/, '') : inv.link;
  if (spec.local) console.log('   link opened WITHOUT &idp=urv (local sign-in)');

  const { browser, page } = await L.newBrowserContext();
  const api = L.watchAdminApi(page);
  try {
    await page.goto(link, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await L.shot(page, `30-${name}-accept-prompt`);
    const secretFile = path.join(L.SECRETS, spec.secret);
    if (spec.local) {
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((u) => u.href.startsWith(L.AUTH), { timeout: 20000 });
      await page.waitForLoadState('networkidle');
      console.log(`   Keycloak login page (local), kc_idp_hint absent: ${!page.url().includes('kc_idp_hint')}`);
      await page.fill('#username', ALLIANCE_EMAIL);
      await page.fill('#password', fs.readFileSync(path.join(L.SECRETS, 'dev_alliance_admin_password'), 'utf8').trim());
      await page.locator('#kc-login').click();
      for (const s of await L.keycloakSecondFactor(page, { account: ALLIANCE_EMAIL, secretFile, step: `31-${name}` })) console.log(`   Keycloak: ${s}`);
    } else {
      const user = L.idpUser(spec.idpUser);
      await page.getByRole('button', { name: 'Sign in through your university' }).click();
      for (const s of await L.idpLogin(page, user, `31-${name}`)) console.log(`   ${s}`);
      for (const s of await L.keycloakSecondFactor(page, { account: user.mail, secretFile, step: `31-${name}` })) console.log(`   Keycloak: ${s}`);
    }
    await page.waitForURL(/\/en\/admin\/accept/, { timeout: 30000 }).catch(() => {});
    for (let i = 0; i < 40 && !api.accept; i++) await L.sleep(250);
    await page.waitForTimeout(800);
    await L.shot(page, `32-${name}-accept-result`);
    const claims = api.token ? L.claimSummary(L.decodeJwt(api.token)) : null;
    console.log(`   token: idp=${claims?.idp} acr=${claims?.acr} email=${claims?.email} roles=${JSON.stringify(claims?.roles)}`);
    console.log(`   POST /invitations/accept -> ${api.accept?.status} ${JSON.stringify(api.accept?.body)}`);
    console.log(`   page: ${(await L.text(page)).slice(0, 260)}`);
    L.check(`${name}: 403 oecp.invitation.mismatch`, api.accept?.status === 403 && JSON.stringify(api.accept?.body ?? '').includes('oecp.invitation.mismatch'));
    L.check(`${name}: detail names the ${name} check`, api.accept?.body?.detail === DETAIL[name], api.accept?.body?.detail);
  } finally {
    await browser.close();
    const del = await L.adminApi(alliance.token, 'DELETE', `/invitations/${inv.id}`);
    console.log(`   cleanup: DELETE /invitations/${inv.id} -> ${del.status}`);
  }
}

(async () => {
  const which = process.argv[2] ?? 'all';
  const cases = which === 'all' ? ['email', 'idp', 'schac', 'linking'] : [which];
  if (!cases.every((c) => c in DETAIL || c === 'linking')) { console.error('usage: node brokered-negative.js [email|idp|schac|linking|all]'); process.exit(64); }
  const urv = await L.organizationId('urv');
  if (urv.idp_alias !== 'urv') throw new Error('IdP urv is not enabled (reference idp_alias is null); see identity/keycloak/README.md');
  let alliance = null;
  for (const c of cases) {
    if (c === 'linking') { await runLinking(); continue; }
    if (!alliance || Date.now() - alliance.obtainedAt > 150000) {
      console.log('\n(alliance admin token)');
      alliance = await L.allianceToken();
    }
    await runCase(c, urv, alliance);
  }
  console.log(process.exitCode ? '\nRESULT: FAILED' : '\nRESULT: all checks passed');
})().catch((e) => { console.error('FAILED', e.stack ?? e.message); process.exit(1); });
