<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Shown by admin pages when nobody is signed in (tokens live in memory only, so
// a page reload also lands here); sign-in returns to the current page.
const { t } = useI18n();
const auth = useAuth();
const route = useRoute();
const failed = ref(false);

async function signIn() {
  failed.value = false;
  try {
    await auth.login(route.fullPath);
  } catch {
    failed.value = true;
  }
}
</script>

<template>
  <div>
    <p>{{ t('admin.signInPrompt') }}</p>
    <button type="button" class="button" @click="signIn">
      {{ t('admin.signIn') }}
    </button>
    <AdminMessage v-if="failed" kind="alert">
      <p>{{ t('admin.signInFailed') }}</p>
    </AdminMessage>
  </div>
</template>
