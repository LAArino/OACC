<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// "Skip to main content" (WCAG 2.4.1): the first focusable element of every
// page, including the error page, which Nuxt renders without app.vue. Every
// layout has `<main id="main" tabindex="-1">`. Styles in main.css.
const { t } = useI18n();
</script>

<template>
  <a class="skip-link" href="#main">{{ t('a11y.skipToContent') }}</a>
</template>
