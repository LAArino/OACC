<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
const { t } = useI18n();
// Sets <html lang> plus hreflang alternates for every enabled locale.
const head = useLocaleHead({ seo: true });

useHead(() => ({
  htmlAttrs: { lang: head.value.htmlAttrs.lang, dir: head.value.htmlAttrs.dir },
  link: head.value.link,
  meta: head.value.meta,
}));
</script>

<template>
  <a class="skip-link" href="#main">{{ t('a11y.skipToContent') }}</a>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<style>
.skip-link {
  position: absolute;
  left: 0.5rem;
  top: -3rem;
  padding: 0.5rem 1rem;
  background: #000;
  color: #fff;
  z-index: 100;
}
.skip-link:focus {
  top: 0.5rem;
}
</style>
