<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// "Sign in through your university" (spec §2.1 step 3): partner identity
// providers are hidden on the Keycloak login page (`hideOnLogin`), so the
// administrator chooses their organization here and the login request carries
// `kc_idp_hint={alias}`. The choices are the partner organizations of the public
// reference that have an IdP alias; the last choice is preselected on this
// browser (localStorage, a convenience only).
import type { AdminOrganization } from '~/composables/useAdminReference';

const props = withDefaults(
  defineProps<{
    /** Same-origin path to return to after sign-in (default: the current page). */
    returnTo?: string;
    /** Alias to preselect (e.g. from an invitation link), before the remembered one. */
    preferred?: string | null;
  }>(),
  { returnTo: undefined, preferred: null },
);
const emit = defineEmits<{ start: [alias: string]; failed: [] }>();
const { t } = useI18n();
const auth = useAuth();
const route = useRoute();
const reference = useAdminReference();
const selectId = useId();
const hintId = useId();
const headingId = useId();

type BrokeredOrganization = AdminOrganization & { idp_alias?: string | null };
const choices = ref<{ alias: string; label: string }[]>([]);
const alias = ref('');
const failed = ref(false);

onMounted(async () => {
  try {
    const orgs = (await reference.load()).organizations as BrokeredOrganization[];
    choices.value = orgs
      .filter((o) => o.is_partner && isIdpAlias(o.idp_alias))
      .map((o) => ({ alias: o.idp_alias as string, label: organizationName(o) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    choices.value = [];
  }
  const known = (value: string | null) =>
    value && choices.value.some((c) => c.alias === value) ? value : null;
  alias.value = known(props.preferred) ?? known(recallIdpAlias()) ?? '';
});

async function signIn() {
  if (!alias.value) return;
  failed.value = false;
  rememberIdpAlias(alias.value);
  emit('start', alias.value);
  try {
    await auth.login(props.returnTo ?? route.fullPath, { idpHint: alias.value });
  } catch {
    failed.value = true;
    emit('failed');
  }
}
</script>

<template>
  <section v-if="choices.length" class="admin-card admin-federated" :aria-labelledby="headingId">
    <h2 :id="headingId">
      {{ t('admin.federated.heading') }}
    </h2>
    <form @submit.prevent="signIn">
      <div class="admin-field">
        <label :for="selectId">{{ t('admin.federated.label') }}</label>
        <p :id="hintId" class="admin-hint">
          {{ t('admin.federated.hint') }}
        </p>
        <select :id="selectId" v-model="alias" :aria-describedby="hintId">
          <option value="">
            {{ t('admin.federated.choose') }}
          </option>
          <option v-for="c in choices" :key="c.alias" :value="c.alias">
            {{ c.label }}
          </option>
        </select>
      </div>
      <button type="submit" class="button" :disabled="!alias">
        {{ t('admin.federated.submit') }}
      </button>
    </form>
    <AdminMessage v-if="failed" kind="alert">
      <p>{{ t('admin.signInFailed') }}</p>
    </AdminMessage>
  </section>
</template>
