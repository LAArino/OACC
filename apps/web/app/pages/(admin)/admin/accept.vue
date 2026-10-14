<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Invitation acceptance (spec §2.1 steps 3-4). The token arrives in the URL
// fragment (`#token=…&idp=…`) so it never reaches server logs; it is read on mount
// and removed from the address bar at once. It survives the Keycloak login
// redirect only through sessionStorage (see utils/invitation.ts), together with
// the organization's IdP alias, which is sent as `kc_idp_hint` so that brokered
// administrators land on their university's login page. The token is never
// logged or rendered. The page restores a live Keycloak session itself, after
// the fragment is cleared (hence `sessionRestore: false` for the layout).
import type { AcceptInvitationResponse, AdminMe } from '@oecp/schemas';

definePageMeta({ layout: 'admin', sessionRestore: false });
const { t } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const adminApi = useAdminApi();
useHead({ title: () => t('accept.title') });

type Phase = 'init' | 'restoring' | 'missing' | 'signIn' | 'accepting' | 'accepted' | 'failed';
const phase = ref<Phase>('init');
const me = ref<AdminMe | null>(null);
const result = ref<AcceptInvitationResponse | null>(null);
const failure = ref<AdminApiError | null>(null);
const signInFailed = ref(false);
// Plain variable, not reactive state: nothing renders or watches the token;
// the template only needs to know whether one is held.
let token: string | null = null;
const hasToken = ref(false);
/** IdP alias of the invited organization (`kc_idp_hint`), null for local accounts. */
const idp = ref<string | null>(null);
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
  const fromHash = extractInvitation(window.location.hash);
  if (window.location.hash) {
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
  }
  // Back from Keycloak: the fragment is gone, the parked invitation is read and cleared.
  const invitation = fromHash ?? takeParkedInvitation(window.sessionStorage);
  setToken(invitation?.token ?? null);
  idp.value = invitation?.idp ?? null;
  if (!token) {
    phase.value = 'missing';
    return;
  }
  if (!auth.isAuthenticated.value) {
    phase.value = 'restoring';
    await auth.restoreSession();
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

/** Parks the invitation for the round-trip; the page removes it as soon as it is back. */
function park(alias: string | null = idp.value) {
  if (token) parkInvitation(window.sessionStorage, { token, idp: alias });
}

async function signIn() {
  if (!token) return;
  signInFailed.value = false;
  park();
  try {
    await auth.login(localePath('/admin/accept'), idp.value ? { idpHint: idp.value } : {});
  } catch {
    takeParkedInvitation(window.sessionStorage);
    signInFailed.value = true;
  }
}

/** The federated chooser starts its own login: park the invitation (and the choice) first. */
function onFederatedStart(alias: string) {
  park(alias);
}

function onFederatedFailed() {
  takeParkedInvitation(window.sessionStorage);
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

  <AdminMessage v-else-if="phase === 'restoring'" :focus="false">
    <p>{{ t('admin.session.restoring') }}</p>
  </AdminMessage>

  <template v-else-if="phase === 'signIn'">
    <h2>{{ t('accept.signInPrompt') }}</h2>
    <p>{{ idp ? t('accept.signInHintFederated') : t('accept.signInHint') }}</p>
    <button type="button" @click="signIn">
      {{ idp ? t('accept.signInFederated') : t('accept.signIn') }}
    </button>
    <AdminMessage v-if="signInFailed" kind="alert">
      <p>{{ t('admin.signInFailed') }}</p>
    </AdminMessage>
    <AdminFederatedSignIn
      v-if="!idp"
      :return-to="localePath('/admin/accept')"
      @start="onFederatedStart"
      @failed="onFederatedFailed"
    />
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
