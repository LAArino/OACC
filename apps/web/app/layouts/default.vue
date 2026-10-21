<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
const { t } = useI18n();
const localePath = useLocalePath();
const config = useRuntimeConfig();
// Optional alliance logo of the deployment (NUXT_PUBLIC_LOGO_IMAGE): replaces the
// text brand; its alt text, the alliance name, stays the link's accessible name.
const logoImage = computed(() => config.public.logoImage);
const logoAlt = computed(() => config.public.allianceName || t('site.name'));
// Legal pages (texts in the branding directory): linked only once their English
// text is published, since the pages answer 404 before that.
const { files } = useBrandingIndex();
const legalLinks = computed(() =>
  (['privacy', 'accessibility'] as const)
    .filter((kind) => files.value.includes(`${kind}.en.md`))
    .map((kind) => ({ kind, label: t(`site.${kind}`), to: localePath(`/${kind}`) })),
);
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
      <nav v-if="legalLinks.length" class="site-footer__legal" :aria-label="t('site.legalNav')">
        <ul>
          <li v-for="link in legalLinks" :key="link.kind">
            <NuxtLink :to="link.to">{{ link.label }}</NuxtLink>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
</template>
