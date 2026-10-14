// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
const { chromium } = require('playwright');
const fs = require('node:fs');
const { totp } = require('./totp');
const SECRETS = process.env.OECP_COMPOSE_SECRETS ?? __dirname + '/../../deploy/compose/secrets';
const OUT = (process.env.OECP_E2E_SHOTS ?? __dirname + '/shots') + '/';
const password = fs.readFileSync(SECRETS + '/dev_alliance_admin_password', 'utf8').trim();
const secret = fs.readFileSync(SECRETS + '/dev_alliance_admin_totp', 'utf8').trim();
const text = async (p) => (await p.innerText('body')).replace(/\s+/g, ' ').trim();
(async () => {
  // wait for a fresh TOTP period so the code was never used before
  const wait = 30000 - (Date.now() % 30000) + 500; console.log('waiting', wait, 'ms for a fresh OTP period'); await new Promise(r => setTimeout(r, wait));
  const b = await chromium.launch();
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  await page.goto('https://oecp.localhost/en/admin', { waitUntil: 'networkidle' });
  await page.locator('button:has-text("Sign in")').first().click();
  await page.waitForURL(/auth\.oecp\.localhost/, { timeout: 20000 }); await page.waitForLoadState('networkidle');
  await page.fill('#username', 'admin@aurora-universities.eu'); await page.fill('#password', password);
  await page.locator('#kc-login').click(); await page.waitForLoadState('networkidle');
  await page.fill('#otp', totp(secret));
  await page.screenshot({ path: OUT + '13-keycloak-otp.png' });
  await page.locator('#kc-login').click();
  await page.waitForURL(/oecp\.localhost\/en\/admin/, { timeout: 20000 }); await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '14-admin-me.png' });
  console.log('url:', page.url()); console.log('text:', (await text(page)).slice(0, 400));
  console.log('cookies on portal origin:', (await ctx.cookies('https://oecp.localhost')).length);
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
