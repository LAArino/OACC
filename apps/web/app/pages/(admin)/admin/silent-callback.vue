<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// `silent_redirect_uri` of client `oecp-admin` (useAuth().restoreSession): Keycloak
// redirects the hidden iframe here with `code` and `state` (or `error=login_required`).
// The page only posts that URL to its parent window, on the same origin; the parent
// exchanges the code (PKCE) and keeps the tokens in memory. Nothing is stored or
// rendered here. Opened directly (not framed), it does nothing useful and says so.
definePageMeta({ layout: false, sessionRestore: false });
const { t } = useI18n();
const auth = useAuth();
useHead({
  title: () => t('admin.session.silentTitle'),
  meta: [{ name: 'robots', content: 'noindex' }],
});

onMounted(() => {
  auth.handleSilentCallback().catch(() => undefined);
});
</script>

<template>
  <main id="main" tabindex="-1">
    <p>{{ t('admin.session.silentWorking') }}</p>
  </main>
</template>
