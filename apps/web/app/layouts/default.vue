<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
const { t } = useI18n();
const localePath = useLocalePath();
</script>

<template>
  <header>
    <nav :aria-label="t('nav.main')">
      <NuxtLink :to="localePath('/')">
        {{ t('nav.home') }}
      </NuxtLink>
      <NuxtLink :to="localePath('/courses')">
        {{ t('nav.courses') }}
      </NuxtLink>
    </nav>
  </header>
  <main id="main" tabindex="-1">
    <slot />
  </main>
</template>
