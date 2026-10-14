<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Integration settings (spec §8.1, §8.2; Guide B steps 5-8): the authoritative
// channel and the OEAPI harvesting settings of the organization
// (`GET`/`PUT /api/admin/v1/organizations/{orgId}/integration`), host approval
// (alliance administrators), "Test connection" and "Sync now" on the saved
// settings, and the last run. The credential is write-only: the page only shows
// whether one is stored, and keeps, replaces or deletes it.
import type {
  AdminIntegration,
  AdminSyncNowResponse,
  AdminTestConnectionResult,
} from '~/types/admin';
import type { FormIssue } from '~/utils/adminCourseForm';
import {
  ACCESS_MODES,
  AUTH_SCHEMES,
  CHANNELS,
  CRON_PRESETS,
  CUSTOM_CRON,
  hostOfUrl,
  INTEGRATION_SERVER_CODES,
  integrationBody,
  integrationFieldOf,
  integrationFormOf,
  usesCredentials,
  validateIntegrationForm,
} from '~/utils/integrationForm';

definePageMeta({ layout: 'admin' });
const { t, te, locale } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const api = useAdminAllianceApi();
const adminOrg = useAdminOrg();
const {
  me,
  failure: meFailure,
  loading: meLoading,
  isAlliance,
  canManage,
  orgId,
  orgQuery,
} = adminOrg;
useHead({ title: () => t('admin.integration.title') });

const integration = ref<AdminIntegration | null>(null);
const notConfigured = ref(false);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const form = ref(integrationFormOf(null));
const pristine = ref(JSON.stringify(form.value));
const issues = ref<FormIssue[]>([]);
const submitted = ref(false);
const saving = ref(false);
const saveFailure = ref<AdminApiError | null>(null);
const notice = ref<string | null>(null);
const summary = ref<HTMLElement | null>(null);
const confirm = ref<{
  ask: (o: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
} | null>(null);
let request = 0;

const secretConfigured = computed(() => integration.value?.secret_configured ?? false);
const dirty = computed(() => JSON.stringify(form.value) !== pristine.value);

function reset(value: AdminIntegration | null) {
  integration.value = value;
  form.value = integrationFormOf(value);
  pristine.value = JSON.stringify(form.value);
  issues.value = [];
  submitted.value = false;
}

async function loadIntegration() {
  const org = orgId.value;
  const current = ++request;
  reset(null);
  notConfigured.value = false;
  failure.value = null;
  notice.value = null;
  saveFailure.value = null;
  testResult.value = null;
  testFailure.value = null;
  syncResult.value = null;
  syncFailure.value = null;
  if (!org) return;
  loading.value = true;
  try {
    const data = await api.getIntegration(org);
    if (current === request) reset(data);
  } catch (error) {
    if (current !== request) return;
    const err = asAdminApiError(error);
    if (err.codes.includes('oecp.integration.not_configured')) notConfigured.value = true;
    else failure.value = err;
  } finally {
    if (current === request) loading.value = false;
  }
}

onMounted(async () => {
  if (!auth.isAuthenticated.value) return;
  await adminOrg.load();
  await loadIntegration();
});
watch(orgId, (value, previous) => {
  if (value !== previous && me.value) void loadIntegration();
});

// Validation ------------------------------------------------------------------

const fid = (field: string) => `integration-${field}`;
function issueText(issue: FormIssue): string {
  const key = issue.code.startsWith('oecp.') ? INTEGRATION_SERVER_CODES[issue.code] : issue.code;
  if (key && te(`admin.integration.validation.${key}`)) {
    return t(`admin.integration.validation.${key}`);
  }
  return issue.message ?? t('admin.validation.invalid');
}
const errors = computed(() => {
  const out: Record<string, string> = {};
  for (const issue of issues.value) out[issue.field] ??= issueText(issue);
  return out;
});
const err = (field: string) => errors.value[field] ?? null;
const summaryIssues = computed(() =>
  issues.value.map((i) => ({ id: fid(i.field), message: issueText(i) })),
);
watch(
  form,
  () => {
    if (submitted.value) {
      issues.value = validateIntegrationForm(form.value, {
        secretConfigured: secretConfigured.value,
      });
    }
  },
  { deep: true },
);

function focusField(id: string) {
  document.getElementById(id)?.focus();
}

async function save() {
  const org = orgId.value;
  if (!org) return;
  submitted.value = true;
  notice.value = null;
  saveFailure.value = null;
  issues.value = validateIntegrationForm(form.value, { secretConfigured: secretConfigured.value });
  if (issues.value.length) {
    await nextTick();
    summary.value?.querySelector<HTMLElement>('[role="alert"]')?.focus();
    return;
  }
  saving.value = true;
  try {
    const body = integrationBody(form.value, {
      secretConfigured: secretConfigured.value,
      stored: integration.value,
    });
    const saved = await api.saveIntegration(org, body);
    reset(saved);
    notConfigured.value = false;
    notice.value = t('admin.integration.saved');
  } catch (error) {
    const e = asAdminApiError(error);
    const fieldIssues = serverFormIssues(e.problem)
      .filter((i) => i.field)
      .map((i) => ({ ...i, field: integrationFieldOf(i.field, form.value) }));
    if (fieldIssues.length) {
      issues.value = fieldIssues;
      await nextTick();
      summary.value?.querySelector<HTMLElement>('[role="alert"]')?.focus();
    } else {
      saveFailure.value = e;
    }
  } finally {
    saving.value = false;
  }
}

// Options ---------------------------------------------------------------------

const accessOptions = computed(() => [
  { value: '', label: t('admin.integration.mode.none') },
  ...ACCESS_MODES.map((m) => ({ value: m, label: t(`admin.integration.mode.${m}`) })),
]);
const schemeOptions = computed(() =>
  AUTH_SCHEMES.map((s) => ({ value: s, label: t(`admin.integration.scheme.${s}`) })),
);
const presetOptions = computed(() => [
  ...CRON_PRESETS.map((p) => ({
    value: p.cron,
    label: t(`admin.integration.presets.${p.key}`),
  })),
  { value: CUSTOM_CRON, label: t('admin.integration.presets.custom') },
]);
const timezoneOptions = computed(() =>
  timeZoneOptions([form.value.schedule_timezone, 'Europe/Brussels']).map((z) => ({
    value: z,
    label: z,
  })),
);
const SECRET_ACTIONS = ['keep', 'replace', 'delete'] as const;
const showCredentials = computed(() => usesCredentials(form.value));
const secretFieldLabel = computed(() =>
  form.value.auth_scheme === 'api_key_header'
    ? t('admin.integration.fields.apiKey')
    : t('admin.integration.fields.token'),
);

// Host approval -------------------------------------------------------------------

const storedHost = computed(() => hostOfUrl(integration.value?.base_url));
const approving = ref(false);
const approveFailure = ref<AdminApiError | null>(null);

async function approveHost() {
  const org = orgId.value;
  const host = storedHost.value;
  if (!org || !host) return;
  const ok = await confirm.value?.ask({
    title: t('admin.integration.approve.confirmTitle'),
    message: t('admin.integration.approve.confirmMessage', { host }),
    confirmLabel: t('admin.integration.approve.button', { host }),
  });
  if (!ok) return;
  approving.value = true;
  approveFailure.value = null;
  notice.value = null;
  try {
    const updated = await api.approveHost(org);
    // Keeps unsaved edits: only the approval fields change.
    if (integration.value) {
      integration.value = {
        ...integration.value,
        approved_host: updated.approved_host,
        approved_by: updated.approved_by,
        approved_at: updated.approved_at,
        host_approved: updated.host_approved,
      };
    } else reset(updated);
    notice.value = t('admin.integration.approve.done', { host });
  } catch (error) {
    approveFailure.value = asAdminApiError(error);
  } finally {
    approving.value = false;
  }
}

// Test connection and Sync now ----------------------------------------------------

const testing = ref(false);
const testResult = ref<AdminTestConnectionResult | null>(null);
const testFailure = ref<AdminApiError | null>(null);
const TEST_ERROR_HINTS = [
  'oecp.oeapi.unauthorized',
  'oecp.oeapi.unreachable',
  'oecp.oeapi.timeout',
  'oecp.oeapi.address_refused',
  'oecp.oeapi.invalid_payload',
];
const testHint = computed(() => {
  const code = testResult.value?.error?.code;
  return code && TEST_ERROR_HINTS.includes(code)
    ? t(`admin.integration.test.hints.${code.split('.').pop()}`)
    : null;
});

async function testConnection() {
  const org = orgId.value;
  if (!org) return;
  testing.value = true;
  testResult.value = null;
  testFailure.value = null;
  try {
    testResult.value = await api.testConnection(org);
  } catch (error) {
    testFailure.value = asAdminApiError(error);
  } finally {
    testing.value = false;
  }
}

const syncing = ref(false);
const syncResult = ref<AdminSyncNowResponse | null>(null);
const syncFailure = ref<AdminApiError | null>(null);
const syncMessageKey = computed(() =>
  syncFailure.value?.codes.includes('oecp.sync.channel_disabled')
    ? 'admin.integration.sync.channelDisabled'
    : undefined,
);

async function syncNow() {
  const org = orgId.value;
  if (!org) return;
  syncing.value = true;
  syncResult.value = null;
  syncFailure.value = null;
  try {
    const response = await api.syncNow(org);
    syncResult.value = response.data;
  } catch (error) {
    syncFailure.value = asAdminApiError(error);
  } finally {
    syncing.value = false;
  }
}

const runLink = (id: string) =>
  localePath({ path: `/admin/sync-runs/${id}`, query: orgQuery.value });
const historyLink = computed(() => localePath({ path: '/admin/sync-runs', query: orgQuery.value }));
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath({ path: '/admin', query: orgQuery })">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.integration.title') }}</h1>

    <AdminSignInPrompt v-if="!auth.isAuthenticated.value" />
    <template v-else>
      <AdminMessage v-if="meLoading" :focus="false">
        <p>{{ t('admin.loadingAccount') }}</p>
      </AdminMessage>
      <AdminProblem v-else-if="meFailure" :error="meFailure" />
      <template v-else-if="me">
        <AdminMessage v-if="!canManage" kind="alert">
          <p>{{ t('problem.forbidden') }}</p>
        </AdminMessage>
        <template v-else>
          <AdminOrgPicker :org-id="orgId" :editable="isAlliance" />
          <p v-if="!orgId">
            {{ t('admin.modules.chooseOrganization') }}
          </p>
          <template v-else>
            <AdminMessage v-if="loading" :focus="false">
              <p>{{ t('admin.integration.loading') }}</p>
            </AdminMessage>
            <AdminProblem v-else-if="failure" :error="failure" />
            <template v-else>
              <p v-if="notConfigured" class="notice">
                {{ t('admin.integration.notConfigured') }}
              </p>

              <!-- Current state ------------------------------------------------ -->
              <section v-if="integration" aria-labelledby="integration-heading" class="admin-card">
                <h2 id="integration-heading">
                  {{ t('admin.integration.summaryHeading') }}
                </h2>
                <dl class="facts">
                  <dt>{{ t('admin.integration.channel') }}</dt>
                  <dd>{{ t(`admin.channel.${integration.authoritative_channel}`) }}</dd>
                  <dt>{{ t('admin.integration.accessMode') }}</dt>
                  <dd>
                    {{
                      integration.access_mode
                        ? t(`admin.integration.mode.${integration.access_mode}`)
                        : t('admin.none')
                    }}
                  </dd>
                  <dt>{{ t('admin.integration.enabled') }}</dt>
                  <dd>{{ integration.enabled ? t('admin.yes') : t('admin.no') }}</dd>
                  <dt>{{ t('admin.integration.lastRun') }}</dt>
                  <dd>
                    <template v-if="integration.last_run">
                      <AdminStatusBadge :status="integration.last_run.status" />
                      {{ ' ' }}
                      <NuxtLink :to="runLink(integration.last_run.id)">
                        {{
                          formatAdminDateTime(
                            integration.last_run.started_at ?? integration.last_run.created_at,
                            locale,
                          )
                        }}
                      </NuxtLink>
                      {{ ' ' }}
                      <span>{{
                        t('admin.integration.lastRunCounters', {
                          created: integration.last_run.n_created,
                          updated: integration.last_run.n_updated,
                          rejected: integration.last_run.n_rejected,
                          withdrawn: integration.last_run.n_withdrawn,
                        })
                      }}</span>
                    </template>
                    <template v-else>
                      {{ t('admin.none') }}
                    </template>
                  </dd>
                </dl>
                <p>
                  <NuxtLink :to="historyLink">
                    {{ t('admin.integration.history') }}
                  </NuxtLink>
                </p>
              </section>

              <!-- Host approval ------------------------------------------------ -->
              <section
                v-if="integration?.access_mode === 'direct' && storedHost"
                aria-labelledby="approval-heading"
                class="admin-card"
              >
                <h2 id="approval-heading">
                  {{ t('admin.integration.approve.heading') }}
                </h2>
                <p>{{ t('admin.integration.approve.intro') }}</p>
                <dl class="facts">
                  <dt>{{ t('admin.integration.approve.host') }}</dt>
                  <dd>
                    <code>{{ storedHost }}</code>
                  </dd>
                  <dt>{{ t('admin.integration.approve.status') }}</dt>
                  <dd>
                    <AdminBadge
                      :tone="integration.host_approved ? 'ok' : 'warn'"
                      :label="
                        integration.host_approved
                          ? t('admin.integration.approve.approved')
                          : t('admin.integration.approve.pending')
                      "
                    />
                  </dd>
                  <template v-if="integration.approved_host && integration.approved_at">
                    <dt>{{ t('admin.integration.approve.approvedHost') }}</dt>
                    <dd>
                      {{
                        t('admin.integration.approve.approvedOn', {
                          host: integration.approved_host,
                          date: formatAdminDateTime(integration.approved_at, locale),
                        })
                      }}
                    </dd>
                  </template>
                </dl>
                <template v-if="!integration.host_approved">
                  <p v-if="isAlliance" class="admin-actions">
                    <button type="button" class="button" :disabled="approving" @click="approveHost">
                      {{ t('admin.integration.approve.button', { host: storedHost }) }}
                    </button>
                  </p>
                  <p v-else>
                    {{ t('admin.integration.approve.askAlliance') }}
                  </p>
                </template>
                <AdminProblem v-if="approveFailure" :error="approveFailure" />
              </section>

              <AdminMessage v-if="notice">
                <p>{{ notice }}</p>
              </AdminMessage>

              <!-- Settings form ----------------------------------------------- -->
              <form class="admin-form" novalidate @submit.prevent="save">
                <h2>{{ t('admin.integration.formHeading') }}</h2>
                <div ref="summary">
                  <AdminErrorSummary
                    :heading="
                      t(
                        'admin.form.errorSummary',
                        { n: summaryIssues.length },
                        summaryIssues.length,
                      )
                    "
                    :issues="summaryIssues"
                    @select="focusField"
                  />
                </div>

                <fieldset class="admin-fieldset">
                  <legend>{{ t('admin.integration.sections.channel') }}</legend>
                  <p id="integration-channel-hint" class="admin-hint">
                    {{ t('admin.integration.hints.channel') }}
                  </p>
                  <ul class="admin-choices">
                    <li v-for="c in CHANNELS" :key="c">
                      <input
                        :id="fid(`authoritative_channel-${c}`)"
                        v-model="form.authoritative_channel"
                        type="radio"
                        name="authoritative_channel"
                        :value="c"
                        aria-describedby="integration-channel-hint"
                      />
                      <label :for="fid(`authoritative_channel-${c}`)">
                        {{ t(`admin.integration.channels.${c}`) }}
                      </label>
                    </li>
                  </ul>
                </fieldset>

                <fieldset class="admin-fieldset">
                  <legend>{{ t('admin.integration.sections.access') }}</legend>
                  <p class="admin-hint">
                    {{ t('admin.integration.hints.access') }}
                  </p>
                  <AdminInputField
                    :id="fid('access_mode')"
                    v-model="form.access_mode"
                    as="select"
                    :options="accessOptions"
                    :label="t('admin.integration.accessMode')"
                    :required="form.authoritative_channel === 'oeapi'"
                    :error="err('access_mode')"
                  />
                  <AdminInputField
                    v-if="form.access_mode === 'direct'"
                    :id="fid('base_url')"
                    v-model="form.base_url"
                    type="url"
                    inputmode="url"
                    :maxlength="2048"
                    required
                    :label="t('admin.integration.fields.baseUrl')"
                    :hint="t('admin.integration.hints.baseUrl')"
                    :error="err('base_url')"
                  />
                  <AdminInputField
                    v-if="form.access_mode === 'surfeduhub'"
                    :id="fid('surfeduhub_endpoint_id')"
                    v-model="form.surfeduhub_endpoint_id"
                    :maxlength="200"
                    required
                    :label="t('admin.integration.fields.endpointId')"
                    :hint="t('admin.integration.hints.endpointId')"
                    :error="err('surfeduhub_endpoint_id')"
                  />
                  <AdminInputField
                    :id="fid('consumer_profile')"
                    v-model="form.consumer_profile"
                    :maxlength="64"
                    required
                    :label="t('admin.integration.fields.consumerProfile')"
                    :hint="t('admin.integration.hints.consumerProfile')"
                    :error="err('consumer_profile')"
                  />
                </fieldset>

                <fieldset v-if="showCredentials" class="admin-fieldset">
                  <legend>{{ t('admin.integration.sections.credentials') }}</legend>
                  <p class="admin-hint">
                    {{ t('admin.integration.hints.credentials') }}
                  </p>
                  <AdminInputField
                    :id="fid('auth_scheme')"
                    v-model="form.auth_scheme"
                    as="select"
                    :options="schemeOptions"
                    :label="t('admin.integration.fields.authScheme')"
                    :error="err('auth_scheme')"
                  />
                  <AdminInputField
                    v-if="form.auth_scheme === 'api_key_header'"
                    :id="fid('api_key_header_name')"
                    v-model="form.api_key_header_name"
                    :maxlength="64"
                    required
                    :label="t('admin.integration.fields.headerName')"
                    :hint="t('admin.integration.hints.headerName')"
                    :error="err('api_key_header_name')"
                  />
                  <p class="admin-secret-state">
                    <AdminBadge
                      :tone="secretConfigured ? 'ok' : 'neutral'"
                      :label="
                        secretConfigured
                          ? t('admin.integration.secret.configured')
                          : t('admin.integration.secret.notConfigured')
                      "
                    />
                  </p>
                  <p v-if="form.auth_scheme === 'none' && secretConfigured" class="admin-hint">
                    {{ t('admin.integration.secret.deletedWithNone') }}
                  </p>
                  <template v-if="form.auth_scheme !== 'none'">
                    <fieldset
                      v-if="secretConfigured"
                      class="admin-fieldset admin-fieldset--plain"
                      :class="{ 'admin-field--invalid': err('secret_action') }"
                    >
                      <legend>{{ t('admin.integration.secret.actionLegend') }}</legend>
                      <AdminFieldError
                        :id="fid('secret_action-error')"
                        :message="err('secret_action')"
                      />
                      <ul class="admin-choices">
                        <li v-for="(a, index) in SECRET_ACTIONS" :key="a">
                          <input
                            :id="index === 0 ? fid('secret_action') : fid(`secret_action-${a}`)"
                            v-model="form.secret_action"
                            type="radio"
                            name="secret_action"
                            :value="a"
                            :aria-describedby="
                              err('secret_action') ? fid('secret_action-error') : undefined
                            "
                          />
                          <label
                            :for="index === 0 ? fid('secret_action') : fid(`secret_action-${a}`)"
                          >
                            {{ t(`admin.integration.secret.${a}`) }}
                          </label>
                        </li>
                      </ul>
                    </fieldset>
                    <template v-if="!secretConfigured || form.secret_action === 'replace'">
                      <div v-if="form.auth_scheme === 'basic'" class="admin-form__row">
                        <AdminInputField
                          :id="fid('basic_username')"
                          v-model="form.basic_username"
                          required
                          autocomplete="off"
                          :label="t('admin.integration.fields.username')"
                          :error="err('basic_username')"
                        />
                        <AdminInputField
                          :id="fid('basic_password')"
                          v-model="form.basic_password"
                          type="password"
                          required
                          autocomplete="new-password"
                          :label="t('admin.integration.fields.password')"
                          :error="err('basic_password')"
                        />
                      </div>
                      <AdminInputField
                        v-else
                        :id="fid('secret')"
                        v-model="form.secret"
                        type="password"
                        required
                        autocomplete="new-password"
                        :label="secretFieldLabel"
                        :hint="t('admin.integration.hints.secret')"
                        :error="err('secret')"
                      />
                    </template>
                  </template>
                </fieldset>

                <fieldset class="admin-fieldset">
                  <legend>{{ t('admin.integration.sections.schedule') }}</legend>
                  <div class="admin-form__row">
                    <AdminInputField
                      :id="fid('schedule_preset')"
                      v-model="form.schedule_preset"
                      as="select"
                      :options="presetOptions"
                      :label="t('admin.integration.fields.schedule')"
                      :error="form.schedule_preset === CUSTOM_CRON ? null : err('schedule_cron')"
                    />
                    <AdminInputField
                      :id="fid('schedule_timezone')"
                      v-model="form.schedule_timezone"
                      as="select"
                      :options="timezoneOptions"
                      :label="t('admin.integration.fields.timezone')"
                      :error="err('schedule_timezone')"
                    />
                  </div>
                  <AdminInputField
                    v-if="form.schedule_preset === CUSTOM_CRON"
                    :id="fid('schedule_cron')"
                    v-model="form.schedule_cron"
                    :maxlength="100"
                    required
                    :label="t('admin.integration.fields.cron')"
                    :hint="t('admin.integration.hints.cron')"
                    :error="err('schedule_cron')"
                  />
                </fieldset>

                <fieldset class="admin-fieldset">
                  <legend>{{ t('admin.integration.sections.limits') }}</legend>
                  <div class="admin-form__row">
                    <AdminInputField
                      :id="fid('page_size')"
                      v-model="form.page_size"
                      inputmode="numeric"
                      required
                      :label="t('admin.integration.fields.pageSize')"
                      :hint="t('admin.integration.hints.pageSize')"
                      :error="err('page_size')"
                    />
                    <AdminInputField
                      :id="fid('max_requests_per_second')"
                      v-model="form.max_requests_per_second"
                      inputmode="decimal"
                      required
                      :label="t('admin.integration.fields.rate')"
                      :hint="t('admin.integration.hints.rate')"
                      :error="err('max_requests_per_second')"
                    />
                    <AdminInputField
                      :id="fid('withdraw_after_absences')"
                      v-model="form.withdraw_after_absences"
                      inputmode="numeric"
                      required
                      :label="t('admin.integration.fields.absences')"
                      :hint="t('admin.integration.hints.absences')"
                      :error="err('withdraw_after_absences')"
                    />
                  </div>
                </fieldset>

                <fieldset class="admin-fieldset">
                  <legend>{{ t('admin.integration.sections.enabled') }}</legend>
                  <AdminFieldError :id="fid('enabled-error')" :message="err('enabled')" />
                  <p class="admin-check">
                    <input
                      :id="fid('enabled')"
                      v-model="form.enabled"
                      type="checkbox"
                      :aria-describedby="
                        [fid('enabled-hint'), err('enabled') ? fid('enabled-error') : '']
                          .filter(Boolean)
                          .join(' ')
                      "
                      :aria-invalid="err('enabled') ? 'true' : undefined"
                    />
                    <label :for="fid('enabled')">{{ t('admin.integration.fields.enabled') }}</label>
                  </p>
                  <p :id="fid('enabled-hint')" class="admin-hint">
                    {{ t('admin.integration.hints.enabled') }}
                  </p>
                </fieldset>

                <p class="admin-actions">
                  <button type="submit" class="button" :disabled="saving">
                    {{ t('admin.integration.save') }}
                  </button>
                  <span v-if="dirty" class="admin-hint">{{ t('admin.integration.unsaved') }}</span>
                </p>
                <AdminProblem v-if="saveFailure" :error="saveFailure" />
              </form>

              <!-- Test connection and Sync now ------------------------------------ -->
              <section v-if="integration" aria-labelledby="actions-heading">
                <h2 id="actions-heading">
                  {{ t('admin.integration.actionsHeading') }}
                </h2>
                <p class="admin-hint">
                  {{ t('admin.integration.actionsHint') }}
                </p>
                <p class="admin-actions">
                  <button
                    type="button"
                    class="button button--secondary"
                    :disabled="testing"
                    @click="testConnection"
                  >
                    {{ t('admin.integration.test.button') }}
                  </button>
                  <button
                    type="button"
                    class="button button--secondary"
                    :disabled="syncing"
                    @click="syncNow"
                  >
                    {{ t('admin.integration.sync.button') }}
                  </button>
                  <NuxtLink :to="historyLink">
                    {{ t('admin.integration.history') }}
                  </NuxtLink>
                </p>
                <AdminMessage v-if="testing" :focus="false">
                  <p>{{ t('admin.integration.test.running') }}</p>
                </AdminMessage>
                <section
                  v-if="testResult"
                  aria-labelledby="test-heading"
                  class="admin-card"
                  :class="testResult.ok ? 'admin-result--ok' : 'admin-result--bad'"
                >
                  <AdminMessage :kind="testResult.ok ? 'status' : 'alert'">
                    <h3 id="test-heading">
                      {{
                        testResult.ok
                          ? t('admin.integration.test.ok')
                          : t('admin.integration.test.failed')
                      }}
                    </h3>
                  </AdminMessage>
                  <dl class="facts">
                    <dt>{{ t('admin.integration.test.target') }}</dt>
                    <dd>
                      <code>{{ testResult.target }}</code>
                    </dd>
                    <dt>{{ t('admin.integration.test.duration') }}</dt>
                    <dd>{{ formatAdminDuration(testResult.duration_ms, locale) }}</dd>
                    <template v-if="testResult.service">
                      <dt>{{ t('admin.integration.test.contact') }}</dt>
                      <dd>{{ testResult.service.contact_email ?? t('admin.none') }}</dd>
                      <dt>{{ t('admin.integration.test.specification') }}</dt>
                      <dd>{{ testResult.service.specification ?? t('admin.none') }}</dd>
                      <dt>{{ t('admin.integration.test.documentation') }}</dt>
                      <dd>{{ testResult.service.documentation ?? t('admin.none') }}</dd>
                    </template>
                    <dt>{{ t('admin.integration.test.coursesAvailable') }}</dt>
                    <dd>
                      {{
                        testResult.courses_available === null
                          ? t('admin.integration.test.unknown')
                          : testResult.courses_available
                            ? t('admin.yes')
                            : t('admin.no')
                      }}
                    </dd>
                    <template v-if="testResult.first_course_primary_code">
                      <dt>{{ t('admin.integration.test.firstCourse') }}</dt>
                      <dd>
                        <code>{{ testResult.first_course_primary_code }}</code>
                      </dd>
                    </template>
                    <template v-if="testResult.error">
                      <dt>{{ t('admin.integration.test.error') }}</dt>
                      <dd>
                        {{ testResult.error.message }}
                        <template v-if="testResult.error.status">
                          ({{
                            t('admin.integration.test.httpStatus', {
                              status: testResult.error.status,
                            })
                          }})
                        </template>
                        <br />
                        {{ t('admin.errorCode', { code: testResult.error.code }) }}
                      </dd>
                    </template>
                  </dl>
                  <p v-if="testHint">
                    {{ testHint }}
                  </p>
                </section>
                <AdminProblem
                  v-if="testFailure"
                  :error="testFailure"
                  :heading="t('admin.integration.test.blocked')"
                />

                <AdminMessage v-if="syncResult">
                  <p>{{ t('admin.integration.sync.queued') }}</p>
                  <p>
                    <NuxtLink :to="runLink(syncResult.sync_run_id)">
                      {{ t('admin.integration.sync.openRun') }}
                    </NuxtLink>
                  </p>
                </AdminMessage>
                <AdminProblem
                  v-if="syncFailure"
                  :error="syncFailure"
                  :heading="t('admin.integration.sync.failed')"
                  :message-key="syncMessageKey"
                />
              </section>
            </template>
          </template>
        </template>
      </template>
    </template>
    <AdminConfirm ref="confirm" />
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
