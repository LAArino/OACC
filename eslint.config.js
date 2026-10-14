// SPDX-License-Identifier: EUPL-1.2
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/.nuxt/**',
    '**/.output/**',
    'packages/schemas/json/**',
    'docs/**',
    'deploy/**',
    'identity/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
    rules: {
      // Nuxt auto-imports composables; TypeScript already reports undefined names.
      'no-undef': 'off',
    },
  },
  {
    // Nuxt derives route and layout names from file names.
    files: ['apps/web/app/pages/**/*.vue', 'apps/web/app/layouts/**/*.vue', 'apps/web/app/app.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Developer tools written as CommonJS scripts (Playwright E2E helpers).
    files: ['tools/e2e-identity/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  prettier,
);
