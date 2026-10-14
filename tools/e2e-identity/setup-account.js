// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
// Part 1 of the identity E2E: complete Keycloak's execute-actions (password + TOTP), any order.
const { chromium } = require('playwright');
const fs = require('node:fs');
const { totp } = require('./totp');
const SECRETS = process.env.OECP_COMPOSE_SECRETS ?? __dirname + '/../../deploy/compose/secrets';
const OUT = process.env.OECP_E2E_SHOTS ?? __dirname + '/shots';
fs.mkdirSync(OUT, { recursive: true });
const password = fs.readFileSync(SECRETS + '/dev_alliance_admin_password', 'utf8').trim();
const redact = (u) => u.replace(/key=[^&\s]*/, 'key=…');

(async () => {
  const msgs = await (await fetch('http://127.0.0.1:8025/api/v1/messages?limit=10')).json();
  const m = msgs.messages.find((x) => x.Subject.includes('Update Your Account')); // newest first
  const full = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${m.ID}`)).json();
  const link = (full.Text.match(/https:\/\/auth\.oecp\.localhost\/realms\/oecp\/login-actions\/action-token\?[^\s"<>]+/) || [])[0];
  if (!link) throw new Error('no execute-actions link in mail');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await page.goto(link, { waitUntil: 'networkidle' });
  const proceed = page.locator('a:has-text("Click here to proceed")');
  if (await proceed.count()) { await proceed.first().click(); await page.waitForLoadState('networkidle'); }
  for (let i = 0; i < 4; i++) {
    if (await page.locator('#password-new').count()) {
      await page.fill('#password-new', password);
      await page.fill('#password-confirm', password);
      await page.locator('input[type=submit], button[type=submit]').first().click();
      await page.waitForLoadState('networkidle');
      console.log(`step ${i}: password set ->`, redact(page.url()));
    } else if (await page.locator('#totp').count()) {
      const manual = page.locator('#mode-manual, a:has-text("Unable to scan")');
      if (await manual.count()) { await manual.first().click(); await page.waitForTimeout(400); }
      const secret = (await page.locator('#kc-totp-secret-key').innerText()).replace(/\s+/g, '');
      fs.writeFileSync(SECRETS + '/dev_alliance_admin_totp', secret);
      await page.fill('#totp', totp(secret));
      if (await page.locator('#userLabel').count()) await page.fill('#userLabel', 'e2e');
      await page.locator('input[type=submit], button[type=submit]').first().click();
      await page.waitForLoadState('networkidle');
      console.log(`step ${i}: totp configured ->`, redact(page.url()));
    } else break;
  }
  await page.screenshot({ path: OUT + '/setup-final.png' });
  console.log('final url:', redact(page.url()));
  console.log('final text:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 200));
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
