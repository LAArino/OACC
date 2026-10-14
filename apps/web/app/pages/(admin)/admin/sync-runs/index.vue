<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Sync monitor (spec §8.1): the organization's latest runs of every channel
// (`GET /api/admin/v1/organizations/{orgId}/sync-runs?limit=50`); a row opens
// the run page with its errors.
import type { SyncRun, SyncRunList } from '@oecp/schemas';

definePageMeta({ layout: 'admin' });
const { t, locale } = useI18n();
const localePath = useLocalePath();
const router = useRouter();
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
useHead({ title: () => t('admin.syncRuns.title') });

const LIMIT = 50;
const runs = ref<SyncRun[] | null>(null);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
let request = 0;

async function loadRuns() {
  const org = orgId.value;
  const current = ++request;
  runs.value = null;
  failure.value = null;
  if (!org) return;
  loading.value = true;
  try {
    const list = await adminApi<SyncRunList>(
      `/api/admin/v1/organizations/${encodeURIComponent(org)}/sync-runs`,
      { query: { limit: LIMIT } },
    );
    if (current === request) runs.value = list.items;
  } catch (error) {
    if (current === request) failure.value = asAdminApiError(error);
  } finally {
    if (current === request) loading.value = false;
  }
}

onMounted(async () => {
  if (!auth.isAuthenticated.value) return;
  await adminOrg.load();
  await loadRuns();
});
watch(orgId, (value, previous) => {
  if (value !== previous && me.value) void loadRuns();
});

function runLink(run: SyncRun) {
  return localePath({ path: `/admin/sync-runs/${run.id}`, query: orgQuery.value });
}

/** Whole-row click for pointer users; the link in the first cell serves keyboards and AT. */
function onRowClick(run: SyncRun, event: MouseEvent) {
  if ((event.target as HTMLElement | null)?.closest('a')) return;
  void router.push(runLink(run));
}
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath({ path: '/admin', query: orgQuery })">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.syncRuns.title') }}</h1>

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
            <p class="admin-actions">
              <button type="button" class="button button--secondary" @click="loadRuns">
                {{ t('admin.syncRuns.refresh') }}
              </button>
              <NuxtLink :to="localePath({ path: '/admin/csv', query: orgQuery })">
                {{ t('admin.modules.csv.title') }}
              </NuxtLink>
            </p>
            <AdminMessage v-if="loading" :focus="false">
              <p>{{ t('admin.syncRuns.loading') }}</p>
            </AdminMessage>
            <AdminProblem v-else-if="failure" :error="failure" />
            <template v-else-if="runs">
              <p v-if="!runs.length">
                {{ t('admin.syncRuns.empty') }}
              </p>
              <div
                v-else
                class="admin-table-wrap"
                role="region"
                aria-labelledby="runs-caption"
                tabindex="0"
              >
                <table class="admin-table">
                  <caption id="runs-caption">
                    {{
                      t('admin.syncRuns.caption', { n: runs.length })
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        {{ t('admin.syncRuns.started') }}
                      </th>
                      <th scope="col">
                        {{ t('admin.run.channel') }}
                      </th>
                      <th scope="col">
                        {{ t('admin.run.trigger') }}
                      </th>
                      <th scope="col">
                        {{ t('admin.run.status') }}
                      </th>
                      <th scope="col" class="num">
                        {{ t('admin.counters.created') }}
                      </th>
                      <th scope="col" class="num">
                        {{ t('admin.counters.updated') }}
                      </th>
                      <th scope="col" class="num">
                        {{ t('admin.counters.unchanged') }}
                      </th>
                      <th scope="col" class="num">
                        {{ t('admin.counters.rejected') }}
                      </th>
                      <th scope="col" class="num">
                        {{ t('admin.counters.withdrawn') }}
                      </th>
                      <th scope="col" class="num">
                        {{ t('admin.run.duration') }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="run in runs"
                      :key="run.id"
                      class="admin-table__link-row"
                      @click="onRowClick(run, $event)"
                    >
                      <th scope="row">
                        <NuxtLink :to="runLink(run)">
                          {{ formatAdminDateTime(run.started_at ?? run.created_at, locale) }}
                        </NuxtLink>
                      </th>
                      <td>{{ t(`admin.channel.${run.channel}`) }}</td>
                      <td>{{ t(`admin.trigger.${run.trigger_kind}`) }}</td>
                      <td><AdminStatusBadge :status="run.status" /></td>
                      <td class="num">
                        {{ run.n_created }}
                      </td>
                      <td class="num">
                        {{ run.n_updated }}
                      </td>
                      <td class="num">
                        {{ run.n_unchanged }}
                      </td>
                      <td class="num">
                        {{ run.n_rejected }}
                      </td>
                      <td class="num">
                        {{ run.n_withdrawn }}
                      </td>
                      <td class="num">
                        {{ formatAdminDuration(run.duration_ms, locale) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
