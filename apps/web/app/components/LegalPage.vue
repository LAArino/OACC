<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Body of a public legal page: the title as <h1> and the Markdown text of the
// branding directory rendered by `renderMarkdown` (everything escaped, only a
// fixed set of tags produced), or the "not published yet" message.
defineProps<{
  title: string;
  /** Sanitised HTML from `renderMarkdown`. */
  html: string;
  published: boolean;
  /** Language of the text when it differs from the page's. */
  lang?: string;
}>();
const { t } = useI18n();
</script>

<template>
  <article class="legal" :lang="lang">
    <h1>{{ title }}</h1>
    <!-- eslint-disable-next-line vue/no-v-html -- output of renderMarkdown, which escapes all text -->
    <div v-if="published" class="legal__body" v-html="html" />
    <p v-else class="notice">{{ t('legal.unpublished') }}</p>
  </article>
</template>
