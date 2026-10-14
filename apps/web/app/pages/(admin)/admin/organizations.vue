<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Organizations module of alliance administrators (spec §8 "alliance_admin" 1):
// placeholder until it is built.
definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
useHead({ title: () => t('admin.modules.organizations.title') });
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath('/admin')">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.modules.organizations.title') }}</h1>
    <p class="notice">
      {{ t('admin.comingSoon') }}
    </p>
    <p>{{ t('admin.modules.organizations.description') }}</p>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
