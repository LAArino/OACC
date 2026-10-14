<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// OIDC redirect URI of client `oecp-admin`: exchanges the authorization code
// (PKCE) for tokens kept in memory, then continues to the `returnTo` path that
// travelled in the OIDC state (client-side navigation keeps the tokens).
definePageMeta({ layout: 'admin', sessionRestore: false });
const { t } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const failure = ref<string | null>(null);
useHead({ title: () => t('callback.title') });

onMounted(async () => {
  try {
    const returnTo = await auth.handleCallback();
    await navigateTo(returnTo, { replace: true });
  } catch (error) {
    // Drop `code`/`state` (or Keycloak's `error`) from the address bar.
    history.replaceState(history.state, '', window.location.pathname);
    // OIDC error responses carry a short code such as `access_denied`; nothing secret.
    const code =
      typeof error === 'object' && error !== null && 'error' in error ? String(error.error) : '';
    failure.value = code;
  }
});
</script>

<template>
  <h1>{{ t('callback.title') }}</h1>
  <AdminMessage v-if="failure === null" :focus="false">
    <p>{{ t('callback.working') }}</p>
  </AdminMessage>
  <template v-else>
    <AdminMessage kind="alert">
      <p>{{ t('callback.failed') }}</p>
      <p v-if="failure">
        {{ t('admin.errorCode', { code: failure }) }}
      </p>
    </AdminMessage>
    <p>
      <NuxtLink :to="localePath('/admin')">
        {{ t('callback.backToAdmin') }}
      </NuxtLink>
    </p>
  </template>
</template>
