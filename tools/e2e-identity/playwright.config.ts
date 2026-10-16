// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/**
 * Identity E2E suite against the Compose stack (profile `dev`, test SAML IdP
 * enabled). The specs share one realm, Mailpit and the alliance admin's OTP
 * periods, so they run serially in one worker, in file-name order.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // Each sign-in may wait up to 30 s for a fresh OTP period.
  timeout: 5 * 60 * 1000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.OECP_E2E_PORTAL ?? 'https://oecp.localhost',
    ignoreHTTPSErrors: true,
    viewport: { width: 1100, height: 800 },
    actionTimeout: 20000,
    navigationTimeout: 30000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 800 } },
    },
  ],
});
