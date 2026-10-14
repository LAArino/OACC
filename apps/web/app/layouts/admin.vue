<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
const { t } = useI18n();
useHead({ meta: [{ name: 'robots', content: 'noindex' }] });
</script>

<template>
  <header>
    <p>{{ t('admin.title') }}</p>
  </header>
  <main id="main" tabindex="-1">
    <slot />
  </main>
</template>
