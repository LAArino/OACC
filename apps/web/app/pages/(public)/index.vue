<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
const { t } = useI18n();
const localePath = useLocalePath();
useHead({ title: () => t('home.title') });
</script>

<template>
  <h1>{{ t('home.title') }}</h1>
  <form role="search" method="get" :action="localePath('/courses')">
    <label for="q">{{ t('home.searchLabel') }}</label>
    <input id="q" name="q" type="search" />
    <button type="submit">
      {{ t('home.searchButton') }}
    </button>
  </form>
</template>
