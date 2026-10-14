<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
const { t } = useI18n();
const localePath = useLocalePath();
const config = useRuntimeConfig();
</script>

<template>
  <header class="site-header">
    <div class="site-header__inner">
      <NuxtLink class="site-header__brand" :to="localePath('/')">
        {{ t('site.name') }}
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
