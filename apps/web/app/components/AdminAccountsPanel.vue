<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Administrators of one organization (spec §8 "Administrators"): the Keycloak
// users holding an OACC role there. Removing takes the role away (the account
// itself stays); nobody can remove themselves, and the last alliance
// administrator cannot be removed (the API enforces both; the page explains them
// up front). Local OACC accounts can get their set-up e-mail (password and
// second factor) again.
import type { AdminAccount } from '~/types/admin';

const props = defineProps<{
  orgId: string;
  /** `sub` of the signed-in administrator. */
  selfSub: string | null;
}>();
const { t, locale } = useI18n();
const api = useAdminAllianceApi();
const uid = useId();
const captionId = `${uid}-caption`;

const items = ref<AdminAccount[] | null>(null);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const actionFailure = ref<AdminApiError | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
const confirm = ref<{
  ask: (o: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
} | null>(null);
let request = 0;

async function load() {
  const current = ++request;
  loading.value = true;
  failure.value = null;
  try {
    const list = await api.listAdmins(props.orgId);
    if (current === request) items.value = list.items;
  } catch (error) {
    if (current === request) failure.value = asAdminApiError(error);
  } finally {
    if (current === request) loading.value = false;
  }
}
onMounted(load);
watch(
  () => props.orgId,
  () => {
    items.value = null;
    void load();
  },
);

const allianceCount = computed(
  () => (items.value ?? []).filter((a) => a.roles.includes('alliance_admin')).length,
);
const display = (a: AdminAccount) => a.name || a.email || a.username || a.sub;
const isSelf = (a: AdminAccount) => a.sub === props.selfSub;
const isLastAlliance = (a: AdminAccount) =>
  a.roles.includes('alliance_admin') && allianceCount.value <= 1;
const isLocal = (a: AdminAccount) => a.idp === 'local';
/** The set-up e-mail exists for local accounts with pending set-up only (the API refuses others). */
const canResendSetup = (a: AdminAccount) => isLocal(a) && a.required_actions.length > 0;
/** Why the account cannot be removed here, if it cannot. */
function removalBlock(a: AdminAccount): string | null {
  if (isSelf(a)) return t('admin.admins.cannotRemoveSelf');
  if (isLastAlliance(a)) return t('admin.admins.lastAllianceAdmin');
  return null;
}

/** Keycloak required actions the page names; others are shown as sent. */
const REQUIRED_ACTIONS: Readonly<Record<string, string>> = {
  UPDATE_PASSWORD: 'updatePassword',
  CONFIGURE_TOTP: 'configureTotp',
  VERIFY_EMAIL: 'verifyEmail',
  'webauthn-register': 'webauthnRegister',
};

function stateText(a: AdminAccount): string {
  if (!a.enabled) return t('admin.admins.disabled');
  if (a.required_actions.length) {
    return t('admin.admins.setupPending', {
      actions: a.required_actions
        .map((action) =>
          REQUIRED_ACTIONS[action] ? t(`admin.admins.actions.${REQUIRED_ACTIONS[action]}`) : action,
        )
        .join(', '),
    });
  }
  return t('admin.admins.active');
}

async function remove(a: AdminAccount) {
  const ok = await confirm.value?.ask({
    title: t('admin.admins.removeTitle'),
    message: t('admin.admins.removeMessage', { name: display(a) }),
    confirmLabel: t('admin.admins.remove'),
    danger: true,
  });
  if (!ok) return;
  await act(async () => {
    await api.removeAdmin(props.orgId, a.sub);
    notice.value = t('admin.admins.removed', { name: display(a) });
  });
}

async function resendSetup(a: AdminAccount) {
  const ok = await confirm.value?.ask({
    title: t('admin.admins.resendSetupTitle'),
    message: t('admin.admins.resendSetupMessage', { email: a.email ?? display(a) }),
    confirmLabel: t('admin.admins.resendSetup'),
  });
  if (!ok) return;
  await act(async () => {
    await api.resendSetup(props.orgId, a.sub);
    notice.value = t('admin.admins.setupSent', { email: a.email ?? display(a) });
  });
}

async function act(run: () => Promise<void>) {
  busy.value = true;
  actionFailure.value = null;
  notice.value = null;
  try {
    await run();
    await load();
  } catch (error) {
    actionFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="admin-accounts">
    <p>{{ t('admin.admins.intro') }}</p>
    <AdminMessage v-if="notice">
      <p>{{ notice }}</p>
    </AdminMessage>
    <AdminProblem v-if="actionFailure" :error="actionFailure" />
    <AdminMessage v-if="loading && !items" :focus="false">
      <p>{{ t('admin.admins.loading') }}</p>
    </AdminMessage>
    <AdminProblem v-else-if="failure" :error="failure" />
    <template v-else-if="items">
      <p v-if="!items.length">
        {{ t('admin.admins.empty') }}
      </p>
      <div v-else class="admin-table-wrap" role="region" :aria-labelledby="captionId" tabindex="0">
        <table class="admin-table">
          <caption :id="captionId">
            {{
              t('admin.admins.caption', { n: items.length }, items.length)
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('admin.admins.name') }}</th>
              <th scope="col">{{ t('admin.admins.email') }}</th>
              <th scope="col">{{ t('admin.admins.roles') }}</th>
              <th scope="col">{{ t('admin.admins.signIn') }}</th>
              <th scope="col">{{ t('admin.admins.state') }}</th>
              <th scope="col">{{ t('admin.admins.lastLogin') }}</th>
              <th scope="col">{{ t('admin.admins.actionsColumn') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in items" :key="a.sub">
              <th scope="row">
                {{ display(a) }}
                <span v-if="isSelf(a)">{{ t('admin.admins.you') }}</span>
              </th>
              <td>{{ a.email ?? t('admin.none') }}</td>
              <td>{{ a.roles.map((r) => t(`roles.${r}`)).join(', ') }}</td>
              <td>
                {{
                  isLocal(a)
                    ? t('admin.admins.localAccount')
                    : t('admin.admins.brokered', { idp: a.idp })
                }}
              </td>
              <td>{{ stateText(a) }}</td>
              <td>
                {{
                  a.last_login_at
                    ? formatAdminDateTime(a.last_login_at, locale)
                    : t('admin.admins.never')
                }}
              </td>
              <td>
                <span class="admin-row-actions">
                  <button
                    v-if="canResendSetup(a)"
                    type="button"
                    class="button button--secondary"
                    :disabled="busy"
                    :aria-label="t('admin.admins.resendSetupFor', { name: display(a) })"
                    @click="resendSetup(a)"
                  >
                    {{ t('admin.admins.resendSetup') }}
                  </button>
                  <button
                    v-if="!removalBlock(a)"
                    type="button"
                    class="button button--secondary button--danger-text"
                    :disabled="busy"
                    :aria-label="t('admin.admins.removeFor', { name: display(a) })"
                    @click="remove(a)"
                  >
                    {{ t('admin.admins.remove') }}
                  </button>
                  <span v-else class="admin-hint">{{ removalBlock(a) }}</span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <AdminConfirm ref="confirm" />
  </div>
</template>
