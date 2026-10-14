<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// The invitation token travels in the URL fragment so it never reaches server
// logs (spec §2.1); it is read on the client and removed from the address bar.
definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const auth = useAuth();
const token = ref<string | null>(null);

onMounted(() => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  token.value = params.get('token');
  history.replaceState(null, '', window.location.pathname + window.location.search);
});
useHead({ title: () => t('accept.title') });
</script>

<template>
  <h1>{{ t('accept.title') }}</h1>
  <p v-if="!token" role="alert">
    {{ t('accept.missingToken') }}
  </p>
  <button v-else type="button" @click="auth.login()">
    {{ t('accept.signIn') }}
  </button>
</template>
