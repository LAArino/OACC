<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const auth = useAuth();
useHead({ title: () => t('admin.title') });
</script>

<template>
  <h1>{{ t('admin.title') }}</h1>
  <button v-if="auth.isAuthenticated.value" type="button" @click="auth.logout()">
    {{ t('admin.signOut') }}
  </button>
  <button v-else type="button" @click="auth.login()">
    {{ t('admin.signIn') }}
  </button>
</template>
