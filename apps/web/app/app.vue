<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Sets <html lang> plus hreflang alternates for every enabled locale.
const head = useLocaleHead({ seo: true });
// <link rel="icon">: the deployment's favicon or the portal's own.
useFavicon();

useHead(() => ({
  htmlAttrs: { lang: head.value.htmlAttrs.lang, dir: head.value.htmlAttrs.dir },
  link: head.value.link,
  meta: head.value.meta,
}));
</script>

<template>
  <SkipLink />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
