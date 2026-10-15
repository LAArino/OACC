// SPDX-License-Identifier: EUPL-1.2
import { defineVitestConfig } from '@nuxt/test-utils/config';

// Unit tests run in Node by default; opt into the Nuxt runtime per file with
// `// @vitest-environment nuxt`.
// `*.render.test.ts` build the app and run it as a production server: they have
// their own config (vitest.render.config.ts) and run after these (`pnpm test`),
// so that the build does not compete with the unit tests for the CPU.
export default defineVitestConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.render.test.ts'],
    environment: 'node',
  },
});
