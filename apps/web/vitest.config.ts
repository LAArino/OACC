// SPDX-License-Identifier: EUPL-1.2
import { defineVitestConfig } from '@nuxt/test-utils/config';

// Unit tests run in Node by default; opt into the Nuxt runtime per file with
// `// @vitest-environment nuxt`.
export default defineVitestConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
