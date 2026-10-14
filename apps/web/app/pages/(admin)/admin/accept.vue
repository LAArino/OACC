<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Invitation acceptance (spec §2.1 steps 3-4). The token arrives in the URL
// fragment (`#token=…`) so it never reaches server logs; it is read on mount and
// removed from the address bar at once. It survives the Keycloak login redirect
// only through sessionStorage (see utils/invitation.ts). It is never logged or
// rendered.
import type { AcceptInvitationResponse, AdminMe } from '@oecp/schemas';

definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const adminApi = useAdminApi();
useHead({ title: () => t('accept.title') });

type Phase = 'init' | 'missing' | 'signIn' | 'accepting' | 'accepted' | 'failed';
const phase = ref<Phase>('init');
const me = ref<AdminMe | null>(null);
const result = ref<AcceptInvitationResponse | null>(null);
const failure = ref<AdminApiError | null>(null);
const signInFailed = ref(false);
// Plain variable, not reactive state: nothing renders or watches the token;
// the template only needs to know whether one is held.
let token: string | null = null;
const hasToken = ref(false);
function setToken(value: string | null) {
  token = value;
  hasToken.value = value !== null;
}

const needsSignIn = computed(() => {
  if (!failure.value) return false;
  const key = problemMessageKey(failure.value);
  return key === 'problem.signInAgain' || key === 'problem.insufficientAcr';
});

onMounted(async () => {
  const fromHash = extractInvitationToken(window.location.hash);
  if (window.location.hash) {
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
  }
  // Back from Keycloak: the fragment is gone, the parked token is read and cleared.
  setToken(fromHash ?? takeParkedInvitationToken(window.sessionStorage));
  if (!token) {
    phase.value = 'missing';
    return;
  }
  if (!auth.isAuthenticated.value) {
    phase.value = 'signIn';
    return;
  }
  await accept(token);
});

async function accept(invitationToken: string) {
  phase.value = 'accepting';
  failure.value = null;
  try {
    me.value = await adminApi<AdminMe>('/api/admin/v1/me');
    result.value = await adminApi<AcceptInvitationResponse>('/api/admin/v1/invitations/accept', {
      method: 'POST',
      body: { token: invitationToken },
    });
    setToken(null);
    phase.value = 'accepted';
  } catch (error) {
    failure.value = error instanceof AdminApiError ? error : toAdminApiError(undefined, undefined);
    phase.value = 'failed';
  }
}

async function signIn() {
  if (!token) return;
  signInFailed.value = false;
  // Parked only for the round-trip; the page removes it as soon as it is back.
  parkInvitationToken(window.sessionStorage, token);
  try {
    await auth.login(localePath('/admin/accept'));
  } catch {
    takeParkedInvitationToken(window.sessionStorage);
    signInFailed.value = true;
  }
}

function signOut(returnTo?: string) {
  setToken(null);
  return auth.logout(returnTo ? { returnTo } : {});
}
</script>

<template>
  <h1>{{ t('accept.title') }}</h1>

  <AdminMessage v-if="phase === 'missing'" kind="alert">
    <p>{{ t('accept.missingToken') }}</p>
  </AdminMessage>

  <template v-else-if="phase === 'signIn'">
    <h2>{{ t('accept.signInPrompt') }}</h2>
    <p>{{ t('accept.signInHint') }}</p>
    <button type="button" @click="signIn">
      {{ t('accept.signIn') }}
    </button>
    <AdminMessage v-if="signInFailed" kind="alert">
      <p>{{ t('admin.signInFailed') }}</p>
    </AdminMessage>
  </template>

  <template v-else-if="phase !== 'init'">
    <p v-if="me?.email">
      {{ t('accept.signedInAs', { email: me.email }) }}
    </p>

    <AdminMessage v-if="phase === 'accepting'" :focus="false">
      <p>{{ t('accept.accepting') }}</p>
    </AdminMessage>

    <template v-else-if="phase === 'accepted' && result">
      <AdminMessage>
        <h2>{{ t('accept.accepted') }}</h2>
        <p>{{ t('accept.acceptedRole', { role: t(`roles.${result.role}`) }) }}</p>
        <p>{{ t('accept.acceptedOrganization', { org: result.org_id }) }}</p>
        <p>{{ t('accept.reloginRequired') }}</p>
      </AdminMessage>
      <button type="button" @click="signOut(localePath('/admin'))">
        {{ t('accept.relogin') }}
      </button>
    </template>

    <template v-else-if="phase === 'failed' && failure">
      <AdminProblem :error="failure" :heading="t('accept.failed')" />
      <button v-if="needsSignIn && hasToken" type="button" @click="signIn">
        {{ t('accept.signIn') }}
      </button>
      <button type="button" @click="signOut()">
        {{ t('accept.signOut') }}
      </button>
    </template>
  </template>
</template>
