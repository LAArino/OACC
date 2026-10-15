// SPDX-License-Identifier: EUPL-1.2
import { defineConfig } from 'vitest/config';

// Tests that build the app and request it from a production server
// (@nuxt/test-utils/e2e `setup`); run by `pnpm test` after the unit tests.
export default defineConfig({
  test: {
    include: ['test/**/*.render.test.ts'],
    environment: 'node',
    hookTimeout: 300_000,
  },
});
