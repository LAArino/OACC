<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Invitations of one organization (spec §2.1): create (e-mail, role, validity),
// list with status, revoke and resend with confirmation. Alliance administrators
// may invite either role; partner administrators cannot invite (alliance_admin only, spec §2.1).
// The API e-mails the link; the token is never returned to the browser.
// The API refuses invitations to an organization whose identity provider is not
// enabled in the realm (`oecp.invitation.idp_not_enabled`); the panel warns first.
import type { AdminRole } from '@oecp/schemas';
import { EMAIL_PATTERN, INVITATION_DEFAULT_TTL_HOURS } from '@oecp/schemas';
import type { AdminInvitation, AdminInvitationStatus } from '~/types/admin';

const props = withDefaults(
  defineProps<{
    orgId: string;
    /** The caller is an alliance administrator (may invite alliance administrators). */
    isAlliance: boolean;
    /** Heading level of the panel's sections (2 on its own page, 3 inside the organization page). */
    level?: 2 | 3;
    /** The organization's `keycloak_idp_alias` when the caller has it (fetched otherwise). */
    idpAlias?: string | null;
  }>(),
  { level: 2, idpAlias: undefined },
);
const { t, locale } = useI18n();
const localePath = useLocalePath();
const api = useAdminAllianceApi();
const reference = useAdminReference();
const uid = useId();
const id = (name: string) => `${uid}-${name}`;
const heading = computed(() => `h${props.level}`);

const TTL_OPTIONS = [INVITATION_DEFAULT_TTL_HOURS, 72, 24] as const;
const roles = computed<AdminRole[]>(() =>
  props.isAlliance ? ['partner_admin', 'alliance_admin'] : ['partner_admin'],
);

const items = ref<AdminInvitation[] | null>(null);
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

const email = ref('');
const role = ref<AdminRole>('partner_admin');
const ttl = ref(String(INVITATION_DEFAULT_TTL_HOURS));
const emailError = ref<string | null>(null);
const createFailure = ref<AdminApiError | null>(null);
const emailInput = ref<HTMLInputElement | null>(null);
let request = 0;

async function load() {
  const current = ++request;
  loading.value = true;
  failure.value = null;
  try {
    const list = await api.listInvitations(props.orgId);
    if (current !== request) return;
    items.value = [...list.items].sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (error) {
    if (current === request) failure.value = asAdminApiError(error);
  } finally {
    if (current === request) loading.value = false;
  }
}

// Alias of the organization's identity provider when the public reference does
// not publish it, i.e. it is missing or disabled in the realm (the reference is
// cached up to 5 minutes). Unknown (a request failed): no warning.
const disabledIdp = ref<string | null>(null);
let idpRequest = 0;

async function checkIdp() {
  const current = ++idpRequest;
  disabledIdp.value = null;
  if (!props.isAlliance) return;
  try {
    const alias =
      props.idpAlias !== undefined
        ? props.idpAlias
        : (await api.getOrganization(props.orgId)).keycloak_idp_alias;
    if (!alias) return;
    const entry = (await reference.load()).organizations.find((o) => o.id === props.orgId);
    if (current === idpRequest && entry && !entry.idp_alias) disabledIdp.value = alias;
  } catch {
    // The API remains the authority: it refuses the invitation if needed.
  }
}

onMounted(() => {
  void load();
  void checkIdp();
});
watch(
  () => props.orgId,
  () => {
    items.value = null;
    notice.value = null;
    actionFailure.value = null;
    void load();
  },
);
watch(() => [props.orgId, props.isAlliance, props.idpAlias], checkIdp);
watch(roles, (value) => {
  if (!value.includes(role.value)) role.value = 'partner_admin';
});

async function create() {
  const address = email.value.trim();
  createFailure.value = null;
  notice.value = null;
  emailError.value = !address
    ? t('admin.validation.required')
    : address.length > 320 || !EMAIL_PATTERN.test(address)
      ? t('admin.validation.email')
      : null;
  if (emailError.value) {
    emailInput.value?.focus();
    return;
  }
  busy.value = true;
  try {
    const created = await api.createInvitation(props.orgId, {
      email: address,
      role: role.value,
      ttl_hours: Number(ttl.value),
    });
    notice.value = t('admin.invitations.created', {
      email: created.email,
      date: formatAdminDateTime(created.expires_at, locale.value),
    });
    email.value = '';
    await load();
  } catch (error) {
    createFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
}

// Revoking and resending (which revokes and sends a new link) are alliance actions (spec §8.2).
const canRevoke = (i: AdminInvitation) => props.isAlliance && i.status === 'pending';
const canResend = (i: AdminInvitation) => props.isAlliance && i.status !== 'accepted';

async function revoke(invitation: AdminInvitation) {
  const ok = await confirm.value?.ask({
    title: t('admin.invitations.revokeTitle'),
    message: t('admin.invitations.revokeMessage', { email: invitation.email }),
    confirmLabel: t('admin.invitations.revoke'),
    danger: true,
  });
  if (!ok) return;
  await act(async () => {
    await api.revokeInvitation(invitation.id);
    notice.value = t('admin.invitations.revoked', { email: invitation.email });
  });
}

async function resend(invitation: AdminInvitation) {
  const ok = await confirm.value?.ask({
    title: t('admin.invitations.resendTitle'),
    message: t('admin.invitations.resendMessage', { email: invitation.email }),
    confirmLabel: t('admin.invitations.resend'),
  });
  if (!ok) return;
  await act(async () => {
    const created = await api.resendInvitation(invitation.id);
    notice.value = t('admin.invitations.resent', {
      email: created.email,
      date: formatAdminDateTime(created.expires_at, locale.value),
    });
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

const TONES: Record<AdminInvitationStatus, 'ok' | 'warn' | 'neutral'> = {
  pending: 'warn',
  accepted: 'ok',
  expired: 'neutral',
  revoked: 'neutral',
};

function when(i: AdminInvitation): string {
  if (i.status === 'accepted') {
    return t('admin.invitations.acceptedOn', {
      date: formatAdminDateTime(i.accepted_at, locale.value),
    });
  }
  if (i.status === 'revoked') {
    return t('admin.invitations.revokedOn', {
      date: formatAdminDateTime(i.revoked_at, locale.value),
    });
  }
  const key = i.status === 'expired' ? 'expiredOn' : 'expiresOn';
  return t(`admin.invitations.${key}`, { date: formatAdminDateTime(i.expires_at, locale.value) });
}
</script>

<template>
  <div class="admin-invitations">
    <div class="notice">
      <p>{{ t('admin.invitations.info') }}</p>
      <p>{{ t('admin.invitations.infoBrokered') }}</p>
    </div>

    <section :aria-labelledby="id('create')">
      <component :is="heading" :id="id('create')">
        {{ t('admin.invitations.createHeading') }}
      </component>
      <div v-if="props.isAlliance && disabledIdp" class="notice" role="status">
        <p>{{ t('admin.invitations.idpNotEnabled', { alias: disabledIdp }) }}</p>
        <p>
          <NuxtLink :to="localePath(`/admin/organizations/${props.orgId}`)">
            {{ t('admin.invitations.idpNotEnabledLink') }}
          </NuxtLink>
        </p>
      </div>
      <form v-if="props.isAlliance" class="admin-form" novalidate @submit.prevent="create">
        <div class="admin-form__row">
          <div class="admin-field" :class="{ 'admin-field--invalid': emailError }">
            <label :for="id('email')">
              {{ t('admin.invitations.email') }}
              <span class="admin-required">{{ t('admin.form.required') }}</span>
            </label>
            <AdminFieldError :id="id('email-error')" :message="emailError" />
            <input
              :id="id('email')"
              ref="emailInput"
              v-model="email"
              type="email"
              autocomplete="off"
              maxlength="320"
              aria-required="true"
              :aria-invalid="emailError ? 'true' : undefined"
              :aria-describedby="emailError ? id('email-error') : undefined"
            />
          </div>
          <div class="admin-field">
            <label :for="id('role')">{{ t('admin.invitations.role') }}</label>
            <select :id="id('role')" v-model="role" :disabled="roles.length < 2">
              <option v-for="r in roles" :key="r" :value="r">
                {{ t(`roles.${r}`) }}
              </option>
            </select>
          </div>
          <div class="admin-field">
            <label :for="id('ttl')">{{ t('admin.invitations.validity') }}</label>
            <select :id="id('ttl')" v-model="ttl">
              <option v-for="h in TTL_OPTIONS" :key="h" :value="String(h)">
                {{ t('admin.invitations.days', { n: h / 24 }, h / 24) }}
              </option>
            </select>
          </div>
        </div>
        <p class="admin-actions">
          <button type="submit" class="button" :disabled="busy">
            {{ t('admin.invitations.send') }}
          </button>
        </p>
      </form>
      <p v-else class="admin-hint">
        {{ t('admin.invitations.partnerRoleHint') }}
      </p>
      <AdminProblem v-if="createFailure" :error="createFailure" />
    </section>

    <AdminMessage v-if="notice">
      <p>{{ notice }}</p>
    </AdminMessage>
    <AdminProblem v-if="actionFailure" :error="actionFailure" />

    <section :aria-labelledby="id('list')">
      <component :is="heading" :id="id('list')">
        {{ t('admin.invitations.listHeading') }}
      </component>
      <p class="admin-actions">
        <button type="button" class="button button--secondary" :disabled="loading" @click="load">
          {{ t('admin.invitations.refresh') }}
        </button>
      </p>
      <AdminMessage v-if="loading && !items" :focus="false">
        <p>{{ t('admin.invitations.loading') }}</p>
      </AdminMessage>
      <AdminProblem v-else-if="failure" :error="failure" />
      <template v-else-if="items">
        <p v-if="!items.length">
          {{ t('admin.invitations.empty') }}
        </p>
        <div
          v-else
          class="admin-table-wrap"
          role="region"
          :aria-labelledby="id('caption')"
          tabindex="0"
        >
          <table class="admin-table">
            <caption :id="id('caption')">
              {{
                t('admin.invitations.caption', { n: items.length }, items.length)
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('admin.invitations.email') }}</th>
                <th scope="col">{{ t('admin.invitations.role') }}</th>
                <th scope="col">{{ t('admin.invitations.status') }}</th>
                <th scope="col">{{ t('admin.invitations.dates') }}</th>
                <th scope="col">{{ t('admin.invitations.sent') }}</th>
                <th v-if="props.isAlliance" scope="col">
                  {{ t('admin.invitations.actions') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in items" :key="i.id">
                <th scope="row">{{ i.email }}</th>
                <td>{{ t(`roles.${i.role}`) }}</td>
                <td>
                  <AdminBadge
                    :tone="TONES[i.status]"
                    :label="t(`admin.invitations.statuses.${i.status}`)"
                  />
                </td>
                <td>{{ when(i) }}</td>
                <td>{{ formatAdminDateTime(i.created_at, locale) }}</td>
                <td v-if="props.isAlliance">
                  <span class="admin-row-actions">
                    <button
                      v-if="canResend(i)"
                      type="button"
                      class="button button--secondary"
                      :disabled="busy"
                      :aria-label="t('admin.invitations.resendFor', { email: i.email })"
                      @click="resend(i)"
                    >
                      {{ t('admin.invitations.resend') }}
                    </button>
                    <button
                      v-if="canRevoke(i)"
                      type="button"
                      class="button button--secondary button--danger-text"
                      :disabled="busy"
                      :aria-label="t('admin.invitations.revokeFor', { email: i.email })"
                      @click="revoke(i)"
                    >
                      {{ t('admin.invitations.revoke') }}
                    </button>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="items.length && !props.isAlliance" class="admin-hint">
          {{ t('admin.invitations.partnerActionsHint') }}
        </p>
      </template>
    </section>
    <AdminConfirm ref="confirm" />
  </div>
</template>
