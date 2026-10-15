<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Error page: unknown pages and courses (404) and the catalogue being
// temporarily unavailable (503, also used for API 501/5xx and network errors).
import type { NuxtError } from '#app';

// Nuxt requires the file name `error.vue`; the component itself gets a
// multi-word name.
defineOptions({ name: 'ErrorPage' });

const props = defineProps<{ error: NuxtError }>();
const { t } = useI18n();
const localePath = useLocalePath();

const status = computed(() => props.error.statusCode ?? 500);
const kind = computed(() =>
  status.value === 404 ? 'notFound' : status.value === 503 ? 'unavailable' : 'generic',
);
// Nuxt renders this page instead of app.vue: it sets <html lang> itself (WCAG 3.1.1).
const localeHead = useLocaleHead();
useHead(() => ({
  title: t(`errors.${kind.value}.title`),
  htmlAttrs: { lang: localeHead.value.htmlAttrs.lang, dir: localeHead.value.htmlAttrs.dir },
  meta: [{ name: 'robots', content: 'noindex' }],
}));
</script>

<template>
  <SkipLink />
  <NuxtLayout>
    <div class="error-page">
      <h1>{{ t(`errors.${kind}.title`) }}</h1>
      <p>{{ t(`errors.${kind}.body`) }}</p>
      <ul class="error-page__links">
        <li>
          <a :href="localePath('/courses')">{{ t('errors.toCatalogue') }}</a>
        </li>
        <li>
          <a :href="localePath('/')">{{ t('errors.toHome') }}</a>
        </li>
      </ul>
      <p class="error-page__code">{{ t('errors.code', { status }) }}</p>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.error-page {
  max-width: 44rem;
  padding: 1rem 0 2rem;
}
.error-page__links {
  padding-left: 1.25rem;
}
.error-page__code {
  color: var(--c-muted);
  font-size: 0.9rem;
}
</style>
