<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Layout of the client-rendered admin pages. After a reload nobody is signed in
// (tokens live in memory only): the layout tries once to restore the Keycloak
// session silently (useAuth().restoreSession, hidden iframe with prompt=none).
// It holds the page back for at most RESTORE_GRACE_MS, so that a working restore
// (normally well under a second) does not flash the sign-in prompt; after that
// the page shows its sign-in prompt while the restore goes on (up to its own
// 60-second limit, e.g. when framing or third-party cookies are blocked), and a
// late success re-mounts the page so that it loads as signed in. Pages that
// handle sign-in themselves opt out with `definePageMeta({ sessionRestore: false })`.
const RESTORE_GRACE_MS = 3000;

const { t } = useI18n();
const auth = useAuth();
const route = useRoute();
useHead({ meta: [{ name: 'robots', content: 'noindex' }] });

const waiting = ref(!auth.isAuthenticated.value && route.meta.sessionRestore !== false);
/** Bumped to re-mount the page after a late restore. */
const generation = ref(0);

onMounted(() => {
  if (!waiting.value) return;
  const timer = setTimeout(stopWaiting, RESTORE_GRACE_MS);
  void auth.restoreSession().then((restored) => {
    clearTimeout(timer);
    const pageShown = !waiting.value;
    waiting.value = false;
    if (restored && pageShown) generation.value++;
  });
});

/** Shows the page (and its sign-in prompt) without waiting for the restore to finish. */
function stopWaiting() {
  waiting.value = false;
}
</script>

<template>
  <header>
    <p>{{ t('admin.title') }}</p>
  </header>
  <main id="main" tabindex="-1">
    <div v-if="waiting" class="admin-page">
      <AdminMessage :focus="false">
        <p>{{ t('admin.session.restoring') }}</p>
      </AdminMessage>
      <p class="admin-actions">
        <button type="button" class="button button--secondary" @click="stopWaiting">
          {{ t('admin.session.skip') }}
        </button>
      </p>
    </div>
    <template v-else>
      <div v-if="auth.restoring.value && !auth.isAuthenticated.value" class="admin-page">
        <AdminMessage :focus="false">
          <p>{{ t('admin.session.stillRestoring') }}</p>
        </AdminMessage>
      </div>
      <div :key="generation">
        <slot />
      </div>
    </template>
  </main>
</template>

<style src="~/assets/css/admin.css"></style>
