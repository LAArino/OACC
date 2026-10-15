<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
const { t } = useI18n();
const localePath = useLocalePath();
const config = useRuntimeConfig();
// Optional alliance logo of the deployment (NUXT_PUBLIC_LOGO_IMAGE): replaces the
// text brand; its alt text, the alliance name, stays the link's accessible name.
const logoImage = computed(() => config.public.logoImage);
const logoAlt = computed(() => config.public.allianceName || t('site.name'));
</script>

<template>
  <header class="site-header">
    <div class="site-header__inner">
      <NuxtLink class="site-header__brand" :to="localePath('/')">
        <img
          v-if="logoImage"
          class="site-header__logo"
          :src="logoImage"
          :alt="logoAlt"
          height="40"
          decoding="async"
        />
        <template v-else>
          {{ t('site.name') }}
        </template>
      </NuxtLink>
      <nav class="site-nav" :aria-label="t('nav.main')">
        <ul>
          <li>
            <NuxtLink :to="localePath('/')">
              {{ t('nav.home') }}
            </NuxtLink>
          </li>
          <li>
            <NuxtLink :to="localePath('/courses')">
              {{ t('nav.courses') }}
            </NuxtLink>
          </li>
        </ul>
      </nav>
    </div>
  </header>
  <main id="main" class="site-main" tabindex="-1">
    <slot />
  </main>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <p>{{ t('site.footer', { alliance: config.public.allianceName }) }}</p>
    </div>
  </footer>
</template>
