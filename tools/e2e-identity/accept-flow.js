// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
// Part 2 of the identity E2E: invitation link -> sign in (PKCE) -> password -> TOTP -> callback -> accept -> re-login -> /me.
const { chromium } = require('playwright');
const fs = require('node:fs');
const { totp } = require('./totp');
const SECRETS = process.env.OECP_COMPOSE_SECRETS ?? __dirname + '/../../deploy/compose/secrets';
const OUT = (process.env.OECP_E2E_SHOTS ?? __dirname + '/shots') + '/';
const EMAIL = 'admin@aurora-universities.eu';
const password = fs.readFileSync(SECRETS + '/dev_alliance_admin_password', 'utf8').trim();
const INVITE = process.argv[2];
if (!INVITE) { console.error('usage: node accept-flow.js <invitation-link>'); process.exit(64); }
const red = (u) => u.replace(/(token|key|code|session_state)=[^&#\s]*/g, '$1=…');
const text = async (p) => (await p.innerText('body')).replace(/\s+/g, ' ').trim();

async function keycloakLogin(page, step) {
  // username/password form
  if (await page.locator('#username').count()) {
    await page.fill('#username', EMAIL);
    await page.fill('#password', password);
    await page.screenshot({ path: `${OUT}${step}-keycloak-login.png` });
    await page.locator('#kc-login, input[type=submit], button[type=submit]').first().click();
    await page.waitForLoadState('networkidle');
    console.log(' login submitted ->', red(page.url()));
  }
  for (let i = 0; i < 3; i++) {
    if (await page.locator('#kc-totp-secret-key, #mode-manual').count() || (await page.locator('#totp').count() && /Authenticator Setup/i.test(await text(page)))) {
      const manual = page.locator('#mode-manual, a:has-text("Unable to scan")');
      if (await manual.count()) { await manual.first().click(); await page.waitForTimeout(400); }
      const secret = (await page.locator('#kc-totp-secret-key').innerText()).replace(/\s+/g, '');
      fs.writeFileSync(SECRETS + '/dev_alliance_admin_totp', secret);
      await page.screenshot({ path: `${OUT}${step}-keycloak-totp-setup.png` });
      await page.fill('#totp', totp(secret));
      if (await page.locator('#userLabel').count()) await page.fill('#userLabel', 'e2e');
      await page.locator('#saveTOTPBtn, input[type=submit], button[type=submit]').first().click();
      await page.waitForLoadState('networkidle');
      const err = page.locator('#input-error-otp-code, .kc-feedback-text, span.pf-m-error');
      console.log(' totp setup submitted ->', red(page.url()), (await err.count()) ? '| error: ' + (await err.first().innerText()) : '');
    } else if (await page.locator('#otp').count()) {
      const secret = fs.readFileSync(SECRETS + '/dev_alliance_admin_totp', 'utf8').trim();
      await page.fill('#otp', totp(secret));
      await page.screenshot({ path: `${OUT}${step}-keycloak-otp.png` });
      await page.locator('#kc-login, input[type=submit], button[type=submit]').first().click();
      await page.waitForLoadState('networkidle');
      console.log(' otp submitted ->', red(page.url()));
    } else break;
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(' [browser console error]', m.text().slice(0, 200)); });

  console.log('1. open invitation link');
  await page.goto(INVITE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  console.log(' url after mount:', red(page.url()), '| hash removed:', !page.url().includes('#'));
  await page.screenshot({ path: `${OUT}10-accept-signin-prompt.png` });
  console.log(' text:', (await text(page)).slice(0, 160));

  console.log('2. click Sign in');
  await page.locator('button:has-text("Sign in")').first().click();
  await page.waitForURL(/auth\.oecp\.localhost/, { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  console.log(' ->', red(page.url()));
  await keycloakLogin(page, '11');

  console.log('3. callback and accept');
  await page.waitForURL(/oecp\.localhost\/en\/admin\/accept/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  console.log(' url:', red(page.url()));
  await page.screenshot({ path: `${OUT}12-accept-result.png` });
  const t3 = await text(page);
  console.log(' text:', t3.slice(0, 400));
  console.log(' sessionStorage pending key cleared:', await page.evaluate(() => sessionStorage.getItem('oecp.admin.pendingInvitation') === null));
  console.log(' cookies on portal origin:', (await ctx.cookies('https://oecp.localhost')).length);

  console.log('4. sign out and sign in again');
  await page.locator('button:has-text("Sign out and sign in again")').first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  console.log(' after logout ->', red(page.url()));
  if (await page.locator('button:has-text("Sign in")').count()) {
    await page.locator('button:has-text("Sign in")').first().click();
    await page.waitForURL(/auth\.oecp\.localhost/, { timeout: 20000 });
    await page.waitForLoadState('networkidle');
  }
  await keycloakLogin(page, '13');
  await page.waitForURL(/oecp\.localhost\/en\/admin(\/)?$/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}14-admin-me.png` });
  console.log(' url:', red(page.url()));
  console.log(' text:', (await text(page)).slice(0, 400));
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
