// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
// Brokered (eduGAIN-style) partner-administrator path, end to end, against the
// local Compose stack with the `dev` profile and OECP_DEV_IDP_ENABLED=true:
//   alliance admin invites partner.admin@urv.cat as partner_admin of `urv`
//   -> link from Mailpit (#token=…&idp=urv) -> accept page -> "Sign in through
//   your university" (kc_idp_hint=urv) -> test SAML IdP login -> Keycloak
//   first-broker-login (no linking) + post-broker MFA (TOTP enrolment)
//   -> accept (200, partner_admin, URV) -> sign out -> sign in again through
//   the university chooser -> /en/admin shows the role, URV and idp `urv`
//   -> admin API lists the administrator with idp `urv` -> Keycloak user has
//   the federated identity and the imported attributes.
// Re-runnable: an existing brokered user signs in with the OTP secret stored in
// deploy/compose/secrets/dev_partner_admin_totp.
const path = require('node:path');
const L = require('./brokered-lib');

const USER = L.idpUser('partner.admin');
const ROLE = 'partner_admin';
const SECRET_FILE = path.join(L.SECRETS, 'dev_partner_admin_totp');

(async () => {
  const urv = await L.organizationId('urv');
  console.log(`0. organization urv = ${urv.id}; reference idp_alias = ${urv.idp_alias}`);
  L.check('reference publishes idp_alias "urv" (IdP enabled in the realm)', urv.idp_alias === 'urv');

  console.log('1. alliance admin token (local login + TOTP)');
  let alliance = await L.allianceToken();

  console.log(`2. invite ${USER.mail} as ${ROLE} of urv`);
  const inv = await L.invite(alliance.token, { email: USER.mail, role: ROLE, organizationId: urv.id });
  console.log(`   POST /invitations -> ${inv.status}, id ${inv.id}; mail "${inv.subject}"`);
  console.log(`   link: ${L.redactLink(inv.link)}`);
  L.check('invitation link carries &idp=urv', /#token=[^&]+&idp=urv$/.test(inv.link));

  const { browser, ctx, page } = await L.newBrowserContext();
  const api = L.watchAdminApi(page);
  const authUrls = [];
  page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame() && r.url().startsWith(`${L.AUTH}/realms/oecp/protocol/openid-connect/auth`)) authUrls.push(r.url()); });

  console.log('3. open the invitation link');
  await page.goto(inv.link, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  console.log(`   url after mount: ${page.url()} (fragment removed: ${!page.url().includes('#')})`);
  await L.shot(page, '20-accept-signin-prompt');
  const federated = page.getByRole('button', { name: 'Sign in through your university' });
  L.check('accept page offers "Sign in through your university"', (await federated.count()) === 1);
  L.check('no local chooser on a brokered invitation', (await page.getByRole('button', { name: 'Continue to your university' }).count()) === 0);

  console.log('4. sign in through the university');
  await federated.click();
  for (const s of await L.idpLogin(page, USER, '21')) console.log(`   ${s}`);
  const authUrl = new URL(authUrls[0] ?? 'about:blank');
  console.log(`   authorization request: kc_idp_hint=${authUrl.searchParams.get('kc_idp_hint')}, acr_values=${authUrl.searchParams.get('acr_values')}, code_challenge_method=${authUrl.searchParams.get('code_challenge_method')}`);
  L.check('authorization request carries kc_idp_hint=urv', authUrl.searchParams.get('kc_idp_hint') === 'urv');
  for (const s of await L.keycloakSecondFactor(page, { account: USER.mail, secretFile: SECRET_FILE, step: '22' })) console.log(`   Keycloak: ${s}`);

  console.log('5. callback and acceptance');
  await page.waitForURL(/\/en\/admin\/accept/, { timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 40 && !api.accept; i++) await L.sleep(250);
  await page.waitForTimeout(800);
  await L.shot(page, '23-accept-result');
  console.log(`   url: ${L.red(page.url())}`);
  console.log(`   page: ${(await L.text(page)).slice(0, 300)}`);
  const firstClaims = api.token ? L.claimSummary(L.decodeJwt(api.token)) : null;
  console.log('   token used for /me and /accept (role-less):', JSON.stringify(firstClaims));
  console.log(`   GET /me -> ${JSON.stringify(api.me)}`);
  console.log(`   POST /invitations/accept -> ${api.accept?.status} ${JSON.stringify(api.accept?.body)}`);
  L.check('first token: idp = urv', firstClaims?.idp === 'urv');
  L.check('first token: acr = mfa', firstClaims?.acr === 'mfa');
  L.check(`first token: email = ${USER.mail}`, firstClaims?.email === USER.mail);
  L.check('accept -> 200', api.accept?.status === 200);
  L.check(`accept -> role ${ROLE}, org_id = urv`, api.accept?.body?.role === ROLE && api.accept?.body?.org_id === urv.id);

  console.log('6. sign out and sign in again through the university chooser');
  api.token = undefined; api.me = undefined;
  await page.getByRole('button', { name: 'Sign out and sign in again' }).click();
  await page.waitForURL((u) => u.href.startsWith(`${L.PORTAL}/en/admin`) && !u.href.includes('/accept'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  console.log(`   after logout: ${L.red(page.url())}`);
  const select = page.getByLabel('Your university', { exact: true });
  await select.waitFor({ timeout: 10000 });
  const options = await select.locator('option').allInnerTexts();
  console.log(`   chooser options: ${JSON.stringify(options)}`);
  await select.selectOption('urv');
  await L.shot(page, '24-admin-federated-chooser');
  await page.getByRole('button', { name: 'Continue to your university' }).click();
  for (const s of await L.idpLogin(page, USER, '25')) console.log(`   ${s}`);
  for (const s of await L.keycloakSecondFactor(page, { account: USER.mail, secretFile: SECRET_FILE, step: '25' })) console.log(`   Keycloak: ${s}`);
  await page.waitForURL((u) => /\/en\/admin\/?$/.test(u.pathname), { timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 40 && !api.me; i++) await L.sleep(250);
  await page.waitForTimeout(1000);
  await L.shot(page, '26-admin-me');
  const t = await L.text(page);
  console.log(`   url: ${L.red(page.url())}`);
  console.log(`   page: ${t.slice(0, 400)}`);
  const claims = api.token ? L.claimSummary(L.decodeJwt(api.token)) : null;
  console.log('   final token claims:', JSON.stringify(claims));
  console.log(`   GET /me -> ${JSON.stringify(api.me)}`);
  L.check('final token: roles = [partner_admin]', JSON.stringify(claims?.roles) === '["partner_admin"]');
  L.check('final token: org_id = urv', claims?.org_id === urv.id);
  L.check('final token: idp = urv, acr = mfa', claims?.idp === 'urv' && claims?.acr === 'mfa');
  L.check('/en/admin shows Partner administrator, URV and "Signed in through urv"',
    t.includes('Partner administrator') && t.includes(urv.id) && /Signed in through\s*urv/.test(t));
  await browser.close();

  console.log('7. admin API and Keycloak state');
  if (Date.now() - alliance.obtainedAt > 240000) alliance = await L.allianceToken();
  const admins = await L.adminApi(alliance.token, 'GET', `/organizations/${urv.id}/admins`);
  const listed = (admins.body?.items ?? admins.body ?? []).find?.((a) => a.email === USER.mail);
  console.log(`   GET /organizations/{urv}/admins -> ${admins.status}: ${JSON.stringify(listed)}`);
  L.check('admins list has the user with idp "urv" and role partner_admin', listed?.idp === 'urv' && listed?.roles?.includes(ROLE));
  const users = await L.keycloakAdmin('GET', `/users?email=${encodeURIComponent(USER.mail)}&exact=true&briefRepresentation=false`);
  const kcUser = users.body?.[0];
  if (kcUser) {
    const fed = await L.keycloakAdmin('GET', `/users/${kcUser.id}/federated-identity`);
    const creds = await L.keycloakAdmin('GET', `/users/${kcUser.id}/credentials`);
    console.log(`   Keycloak user: username=${kcUser.username}, email=${kcUser.email}, emailVerified=${kcUser.emailVerified}, firstName=${kcUser.firstName}, lastName=${kcUser.lastName}`);
    console.log(`   attributes: ${JSON.stringify(kcUser.attributes)}`);
    console.log(`   requiredActions: ${JSON.stringify(kcUser.requiredActions)}; credentials: ${JSON.stringify((creds.body ?? []).map((c) => c.type))}`);
    console.log(`   federated identities: ${JSON.stringify(fed.body)}`);
    L.check('federated identity urv with userId = subject-id', fed.body?.some((f) => f.identityProvider === 'urv' && f.userId === USER.subjectId));
    L.check(`attribute schacHomeOrganization = ${USER.schac}`, kcUser.attributes?.schacHomeOrganization?.[0] === USER.schac);
    L.check('attribute oecp_org_id = urv', kcUser.attributes?.oecp_org_id?.[0] === urv.id);
    L.check('no password credential (brokered), OTP enrolled', !(creds.body ?? []).some((c) => c.type === 'password') && (creds.body ?? []).some((c) => c.type === 'otp'));
  } else {
    L.check('Keycloak user exists', false, `HTTP ${users.status}`);
  }
  console.log(process.exitCode ? 'RESULT: FAILED' : 'RESULT: all checks passed');
})().catch((e) => { console.error('FAILED', e.stack ?? e.message); process.exit(1); });
