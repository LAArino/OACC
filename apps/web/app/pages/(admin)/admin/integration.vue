<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Integration settings (spec §8.1.1) are not built yet: this placeholder shows
// the current settings summary (`GET /api/admin/v1/organizations/{orgId}/integration`)
// when the organization has one.
import type { PartnerIntegration } from '@oecp/schemas';

definePageMeta({ layout: 'admin' });
const { t, locale } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const adminApi = useAdminApi();
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

const integration = ref<PartnerIntegration | null>(null);
const notConfigured = ref(false);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
let request = 0;

async function loadIntegration() {
  const org = orgId.value;
  const current = ++request;
  integration.value = null;
  notConfigured.value = false;
  failure.value = null;
  if (!org) return;
  loading.value = true;
  try {
    const data = await adminApi<PartnerIntegration>(
      `/api/admin/v1/organizations/${encodeURIComponent(org)}/integration`,
    );
    if (current === request) integration.value = data;
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

const lastRunLink = computed(() =>
  integration.value?.last_run
    ? localePath({
        path: `/admin/sync-runs/${integration.value.last_run.id}`,
        query: orgQuery.value,
      })
    : null,
);
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath({ path: '/admin', query: orgQuery })">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.integration.title') }}</h1>
    <p class="notice">
      {{ t('admin.comingSoon') }}
    </p>

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
            <p v-else-if="notConfigured">
              {{ t('admin.integration.notConfigured') }}
            </p>
            <section
              v-else-if="integration"
              aria-labelledby="integration-heading"
              class="admin-card"
            >
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
                  <template v-if="integration.last_run && lastRunLink">
                    <AdminStatusBadge :status="integration.last_run.status" />
                    {{ ' ' }}
                    <NuxtLink :to="lastRunLink">
                      {{
                        formatAdminDateTime(
                          integration.last_run.started_at ?? integration.last_run.created_at,
                          locale,
                        )
                      }}
                    </NuxtLink>
                  </template>
                  <template v-else>
                    {{ t('admin.none') }}
                  </template>
                </dd>
              </dl>
            </section>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
