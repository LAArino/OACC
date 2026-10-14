<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// One sync run (spec §8.1 "Sync monitor"): summary and its stored errors, paged
// and filtered by severity on the server
// (`GET /api/admin/v1/sync-runs/{id}?page=&page_size=&severity=`).
import type { SyncRunDetail } from '@oecp/schemas';
import type { IssueSeverityFilter } from '~/utils/csvConsole';

definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();
const auth = useAuth();
const adminApi = useAdminApi();
const adminOrg = useAdminOrg();
useHead({ title: () => t('admin.run.title') });

const PAGE_SIZE = 50;
const runId = computed(() => String(route.params.id ?? ''));
const run = ref<SyncRunDetail | null>(null);
const page = ref(1);
const severity = ref<IssueSeverityFilter>('all');
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const errorsHeading = ref<HTMLElement | null>(null);
let request = 0;

const pages = computed(() =>
  run.value ? Math.max(1, Math.ceil(run.value.errors.total / run.value.errors.page_size)) : 1,
);
const issues = computed(() => (run.value ? issuesFromSyncErrors(run.value.errors.items) : []));
const backLink = computed(() =>
  localePath({
    path: '/admin/sync-runs',
    query: run.value ? { org: run.value.organization_id } : adminOrg.orgQuery.value,
  }),
);

async function loadRun(focusErrors = false) {
  const current = ++request;
  loading.value = true;
  failure.value = null;
  try {
    const detail = await adminApi<SyncRunDetail>(
      `/api/admin/v1/sync-runs/${encodeURIComponent(runId.value)}`,
      {
        query: {
          page: page.value,
          page_size: PAGE_SIZE,
          ...(severity.value === 'all' ? {} : { severity: severity.value }),
        },
      },
    );
    if (current !== request) return;
    run.value = detail;
  } catch (error) {
    if (current === request) failure.value = asAdminApiError(error);
  } finally {
    if (current === request) loading.value = false;
  }
  if (focusErrors) {
    await nextTick();
    errorsHeading.value?.focus();
  }
}

onMounted(() => {
  if (auth.isAuthenticated.value) void loadRun();
});

function onSeverity(value: IssueSeverityFilter) {
  severity.value = value;
  page.value = 1;
  void loadRun();
}

function goTo(target: number) {
  page.value = Math.min(Math.max(1, target), pages.value);
  void loadRun(true);
}
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="backLink">
      {{ t('admin.syncRuns.back') }}
    </NuxtLink>
    <h1>{{ t('admin.run.title') }}</h1>

    <AdminSignInPrompt v-if="!auth.isAuthenticated.value" />
    <template v-else>
      <AdminProblem v-if="failure && !run" :error="failure" />
      <AdminMessage v-else-if="loading && !run" :focus="false">
        <p>{{ t('admin.run.loading') }}</p>
      </AdminMessage>
      <template v-else-if="run">
        <p>
          {{ t('admin.run.id') }} <code>{{ run.id }}</code>
        </p>
        <section aria-labelledby="summary-heading" class="admin-card">
          <h2 id="summary-heading">
            {{ t('admin.run.summaryHeading') }}
          </h2>
          <AdminRunSummary :run="run" />
        </section>

        <section aria-labelledby="errors-heading">
          <h2 id="errors-heading" ref="errorsHeading" tabindex="-1">
            {{ t('admin.run.errorsHeading', { n: run.errors.total }) }}
          </h2>
          <AdminProblem v-if="failure" :error="failure" />
          <AdminIssuesTable
            :issues="issues"
            :total="run.errors.total"
            :local-filter="false"
            :severity="severity"
            :caption="t('admin.run.errorsCaption')"
            @update:severity="onSeverity"
          />
          <nav v-if="pages > 1" class="admin-pager" :aria-label="t('admin.run.pagination')">
            <button
              type="button"
              class="button button--secondary"
              :disabled="page <= 1 || loading"
              @click="goTo(page - 1)"
            >
              {{ t('pagination.previous') }}
            </button>
            <span>{{ t('admin.run.page', { page, pages }) }}</span>
            <button
              type="button"
              class="button button--secondary"
              :disabled="page >= pages || loading"
              @click="goTo(page + 1)"
            >
              {{ t('pagination.next') }}
            </button>
          </nav>
        </section>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
