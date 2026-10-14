<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Dashboard placeholder: shows the signed-in administrator as the API sees it
// (`GET /api/admin/v1/me`).
import type { AdminMe } from '@oecp/schemas';

definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const adminApi = useAdminApi();
const me = ref<AdminMe | null>(null);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const signInFailed = ref(false);
useHead({ title: () => t('admin.title') });

onMounted(async () => {
  if (!auth.isAuthenticated.value) return;
  loading.value = true;
  try {
    me.value = await adminApi<AdminMe>('/api/admin/v1/me');
  } catch (error) {
    failure.value = error instanceof AdminApiError ? error : toAdminApiError(undefined, undefined);
  } finally {
    loading.value = false;
  }
});

async function signIn() {
  signInFailed.value = false;
  try {
    await auth.login(localePath('/admin'));
  } catch {
    signInFailed.value = true;
  }
}
</script>

<template>
  <h1>{{ t('admin.title') }}</h1>

  <template v-if="!auth.isAuthenticated.value">
    <p>{{ t('admin.signInPrompt') }}</p>
    <button type="button" @click="signIn">
      {{ t('admin.signIn') }}
    </button>
    <AdminMessage v-if="signInFailed" kind="alert">
      <p>{{ t('admin.signInFailed') }}</p>
    </AdminMessage>
  </template>

  <template v-else>
    <AdminMessage v-if="loading" :focus="false">
      <p>{{ t('admin.loadingAccount') }}</p>
    </AdminMessage>
    <AdminProblem v-else-if="failure" :error="failure" />
    <section v-else-if="me" aria-labelledby="account-heading">
      <h2 id="account-heading">
        {{ t('admin.accountHeading') }}
      </h2>
      <dl>
        <dt>{{ t('admin.email') }}</dt>
        <dd>{{ me.email ?? t('admin.none') }}</dd>
        <dt>{{ t('admin.roles') }}</dt>
        <dd>
          {{ me.roles.length ? me.roles.map((r) => t(`roles.${r}`)).join(', ') : t('admin.none') }}
        </dd>
        <dt>{{ t('admin.organization') }}</dt>
        <dd>{{ me.org_id ?? t('admin.none') }}</dd>
        <dt>{{ t('admin.idp') }}</dt>
        <dd>{{ me.idp }}</dd>
      </dl>
      <p v-if="!me.roles.length">
        {{ t('admin.noRole') }}
      </p>
    </section>
    <button type="button" @click="auth.logout()">
      {{ t('admin.signOut') }}
    </button>
  </template>
</template>
