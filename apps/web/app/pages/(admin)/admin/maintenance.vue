<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Maintenance (alliance administrators; spec §8.2, §10): the worker's
// maintenance jobs with "Run now" (`POST /api/admin/v1/maintenance/jobs/{name}/run`,
// 202 queued or already queued) and their recorded runs
// (`GET /api/admin/v1/maintenance/runs?limit&job`), each expandable to its
// details; the dormancy and account clean-up runs list the administrators they
// revoke or would revoke, for review while the jobs are in dry run (spec §2.2).
import type { AdminMaintenanceRun } from '~/types/admin';

definePageMeta({ layout: 'admin' });
const { t, te, locale } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const api = useAdminAllianceApi();
const reference = useAdminReference();
const adminOrg = useAdminOrg();
const { me, failure: meFailure, loading: meLoading, isAlliance } = adminOrg;
useHead({ title: () => t('admin.maintenance.title') });

const LIMITS = [50, 200] as const;

// Runs ------------------------------------------------------------------------
const runs = ref<AdminMaintenanceRun[] | null>(null);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const jobFilter = ref('');
const limit = ref<number>(LIMITS[0]);
const expanded = ref<Set<string>>(new Set());
const announcement = ref('');
/** Latest run seen per job (kept across filters), for the dry-run state of the jobs. */
const latest = ref<Record<string, AdminMaintenanceRun>>({});
const organizationNames = ref<Record<string, string>>({});
let request = 0;

async function loadRuns() {
  const current = ++request;
  loading.value = true;
  failure.value = null;
  announcement.value = '';
  try {
    const list = await api.maintenanceRuns({
      limit: limit.value,
      ...(jobFilter.value ? { job: jobFilter.value } : {}),
    });
    if (current !== request) return;
    runs.value = list.items;
    const known = { ...latest.value };
    for (const run of list.items) {
      const seen = known[run.job];
      if (!seen || seen.started_at < run.started_at) known[run.job] = run;
    }
    latest.value = known;
    announcement.value = t(
      'admin.maintenance.runs.updated',
      { n: list.items.length },
      list.items.length,
    );
  } catch (error) {
    if (current === request) failure.value = asAdminApiError(error);
  } finally {
    if (current === request) loading.value = false;
  }
}

async function loadOrganizationNames() {
  try {
    const data = await reference.load();
    organizationNames.value = Object.fromEntries(
      data.organizations.map((o) => [o.id, organizationName(o)]),
    );
  } catch {
    // Names are a convenience: the ids are shown instead.
  }
}

onMounted(async () => {
  if (!auth.isAuthenticated.value) return;
  await adminOrg.load();
  if (!isAlliance.value) return;
  void loadOrganizationNames();
  await loadRuns();
});

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

/** Job names offered by the filter: the known jobs, then any other job seen in the runs. */
const filterJobs = computed(() => {
  const names: string[] = [...MAINTENANCE_JOBS];
  for (const run of runs.value ?? []) if (!names.includes(run.job)) names.push(run.job);
  return names;
});

// Jobs ------------------------------------------------------------------------
const pending = ref<Record<string, boolean>>({});
const jobFailures = ref<Record<string, AdminApiError | null>>({});
const toast = ref('');

const jobTitle = (name: string) => {
  const key = `admin.maintenance.jobs.${maintenanceJobKey(name)}.title`;
  return te(key) ? t(key) : name;
};
const triggerText = (kind: string) => {
  const key = `admin.maintenance.trigger.${kind}`;
  return te(key) ? t(key) : kind;
};
const statusText = (status: string) => {
  const key = `admin.maintenance.status.${status}`;
  return te(key) ? t(key) : status;
};

async function runNow(name: string) {
  pending.value = { ...pending.value, [name]: true };
  jobFailures.value = { ...jobFailures.value, [name]: null };
  toast.value = '';
  try {
    const { data } = await api.runMaintenanceJob(name);
    toast.value = t(
      data.status === 'already_queued'
        ? 'admin.maintenance.alreadyQueued'
        : 'admin.maintenance.queued',
      { job: jobTitle(data.job || name) },
    );
    void loadRuns();
  } catch (error) {
    jobFailures.value = { ...jobFailures.value, [name]: asAdminApiError(error) };
  } finally {
    pending.value = { ...pending.value, [name]: false };
  }
}

/** Dry-run state of a job from its latest run: `dryRun`, `enforced` or `unknown`. */
function modeOf(name: string): 'dryRun' | 'enforced' | 'unknown' {
  const value = runDryRun(latest.value[name]);
  if (value === true) return 'dryRun';
  if (value === false) return 'enforced';
  return 'unknown';
}
</script>

<template>
  <div class="admin-page admin-page--wide">
    <NuxtLink class="admin-back" :to="localePath('/admin')">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.maintenance.title') }}</h1>

    <AdminSignInPrompt v-if="!auth.isAuthenticated.value" />
    <template v-else>
      <AdminMessage v-if="meLoading" :focus="false">
        <p>{{ t('admin.loadingAccount') }}</p>
      </AdminMessage>
      <AdminProblem v-else-if="meFailure" :error="meFailure" />
      <template v-else-if="me">
        <AdminMessage v-if="!isAlliance" kind="alert">
          <p>{{ t('admin.allianceOnly') }}</p>
        </AdminMessage>
        <template v-else>
          <p>{{ t('admin.maintenance.intro') }}</p>

          <section aria-labelledby="jobs-heading">
            <h2 id="jobs-heading">{{ t('admin.maintenance.jobsHeading') }}</h2>
            <div class="admin-card admin-dry-run-notice">
              <h3>{{ t('admin.maintenance.dryRun.heading') }}</h3>
              <p>{{ t('admin.maintenance.dryRun.text') }}</p>
              <ul>
                <li v-for="(variable, job) in DRY_RUN_SWITCHES" :key="job">
                  <strong>{{ jobTitle(job) }}:</strong>
                  {{
                    t(`admin.maintenance.dryRun.mode.${modeOf(job)}`, {
                      date: formatAdminDateTime(latest[job]?.started_at, locale),
                    })
                  }}
                  {{ t('admin.maintenance.dryRun.switch', { variable }) }}
                </li>
              </ul>
            </div>
            <div class="admin-toast" role="status" aria-live="polite">
              <p v-if="toast">{{ toast }}</p>
            </div>
            <ul class="admin-jobs">
              <li v-for="name in MAINTENANCE_JOBS" :key="name" class="admin-card">
                <h3 :id="`job-${name}-heading`">{{ jobTitle(name) }}</h3>
                <p>{{ t(`admin.maintenance.jobs.${maintenanceJobKey(name)}.description`) }}</p>
                <p class="admin-hint">
                  {{ t(`admin.maintenance.jobs.${maintenanceJobKey(name)}.schedule`) }}
                </p>
                <p v-if="latest[name]" class="admin-hint">
                  {{
                    t('admin.maintenance.lastRun', {
                      date: formatAdminDateTime(latest[name]!.started_at, locale),
                      status: statusText(latest[name]!.status),
                    })
                  }}
                </p>
                <p class="admin-actions">
                  <button
                    type="button"
                    class="button button--secondary"
                    :disabled="pending[name]"
                    @click="runNow(name)"
                  >
                    {{
                      pending[name]
                        ? t('admin.maintenance.queueing')
                        : t('admin.maintenance.runNow')
                    }}
                    <span class="visually-hidden">{{ jobTitle(name) }}</span>
                  </button>
                </p>
                <AdminProblem
                  v-if="jobFailures[name]"
                  :error="jobFailures[name]!"
                  :heading="t('admin.maintenance.runFailed', { job: jobTitle(name) })"
                />
              </li>
            </ul>
          </section>

          <section aria-labelledby="runs-heading">
            <h2 id="runs-heading">{{ t('admin.maintenance.runs.heading') }}</h2>
            <p>{{ t('admin.maintenance.runs.intro') }}</p>
            <form class="admin-filters admin-runs-filters" @submit.prevent="loadRuns">
              <div class="admin-filters__groups">
                <div class="admin-field">
                  <label for="maintenance-job">{{ t('admin.maintenance.runs.job') }}</label>
                  <select id="maintenance-job" v-model="jobFilter" @change="loadRuns">
                    <option value="">{{ t('admin.maintenance.runs.allJobs') }}</option>
                    <option v-for="name in filterJobs" :key="name" :value="name">
                      {{ jobTitle(name) }}
                    </option>
                  </select>
                </div>
                <div class="admin-field">
                  <label for="maintenance-limit">{{ t('admin.maintenance.runs.limit') }}</label>
                  <select id="maintenance-limit" v-model.number="limit" @change="loadRuns">
                    <option v-for="n in LIMITS" :key="n" :value="n">
                      {{ t('admin.maintenance.runs.latest', { n }) }}
                    </option>
                  </select>
                </div>
              </div>
              <p class="admin-actions">
                <!-- aria-disabled, not disabled: disabling the focused button would drop the keyboard focus (WCAG 2.4.3). -->
                <button
                  type="submit"
                  class="button button--secondary"
                  :aria-disabled="loading ? 'true' : undefined"
                >
                  {{ t('admin.maintenance.runs.refresh') }}
                </button>
              </p>
            </form>
            <p class="visually-hidden" role="status" aria-live="polite">
              {{ announcement }}
            </p>
            <AdminMessage v-if="loading && !runs" :focus="false">
              <p>{{ t('admin.maintenance.runs.loading') }}</p>
            </AdminMessage>
            <AdminProblem v-else-if="failure" :error="failure" />
            <template v-else-if="runs">
              <p v-if="!runs.length">{{ t('admin.maintenance.runs.empty') }}</p>
              <div
                v-else
                class="admin-table-wrap"
                role="region"
                aria-labelledby="maintenance-runs-caption"
                tabindex="0"
              >
                <table class="admin-table admin-runs-table">
                  <caption id="maintenance-runs-caption">
                    {{
                      t('admin.maintenance.runs.caption', { n: runs.length }, runs.length)
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{{ t('admin.maintenance.runs.columns.started') }}</th>
                      <th scope="col">{{ t('admin.maintenance.runs.columns.job') }}</th>
                      <th scope="col">{{ t('admin.maintenance.runs.columns.trigger') }}</th>
                      <th scope="col">{{ t('admin.maintenance.runs.columns.status') }}</th>
                      <th scope="col" class="num">
                        {{ t('admin.maintenance.runs.columns.duration') }}
                      </th>
                      <th scope="col">{{ t('admin.maintenance.runs.columns.counters') }}</th>
                      <th scope="col">{{ t('admin.maintenance.runs.columns.error') }}</th>
                      <th scope="col">{{ t('admin.maintenance.runs.columns.details') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="run in runs" :key="run.id">
                      <tr class="admin-runs-table__run">
                        <th scope="row">{{ formatAdminDateTime(run.started_at, locale) }}</th>
                        <td>{{ jobTitle(run.job) }}</td>
                        <td>{{ triggerText(run.trigger_kind) }}</td>
                        <td>
                          <AdminBadge
                            :tone="maintenanceStatusTone(run.status)"
                            :label="statusText(run.status)"
                          />
                          <template v-if="runDryRun(run) === true">
                            {{ ' ' }}
                            <AdminBadge
                              tone="neutral"
                              :label="t('admin.maintenance.dryRunBadge')"
                            />
                          </template>
                        </td>
                        <td class="num">
                          {{
                            run.duration_ms === null
                              ? t('admin.none')
                              : formatAdminDuration(run.duration_ms, locale)
                          }}
                        </td>
                        <td>
                          <ul v-if="runCounters(run).length" class="admin-chips">
                            <li v-for="[key, value] in runCounters(run)" :key="key">
                              {{ humanizeKey(key) }}: {{ value }}
                            </li>
                          </ul>
                          <template v-else>{{ t('admin.none') }}</template>
                        </td>
                        <td class="admin-runs-table__error">
                          {{ run.error ? textExcerpt(run.error) : t('admin.none') }}
                        </td>
                        <td>
                          <button
                            type="button"
                            class="button button--secondary admin-runs-table__toggle"
                            :aria-expanded="expanded.has(run.id) ? 'true' : 'false'"
                            :aria-controls="`run-${run.id}-details`"
                            @click="toggle(run.id)"
                          >
                            {{
                              expanded.has(run.id)
                                ? t('admin.maintenance.runs.hideDetails')
                                : t('admin.maintenance.runs.showDetails')
                            }}
                            <span class="visually-hidden">{{
                              t('admin.maintenance.runs.detailsOf', {
                                job: jobTitle(run.job),
                                date: formatAdminDateTime(run.started_at, locale),
                              })
                            }}</span>
                          </button>
                        </td>
                      </tr>
                      <tr
                        :id="`run-${run.id}-details`"
                        class="admin-runs-table__details"
                        :hidden="!expanded.has(run.id)"
                      >
                        <td colspan="8">
                          <AdminMaintenanceRunDetails
                            v-if="expanded.has(run.id)"
                            :run="run"
                            :organization-names="organizationNames"
                          />
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </template>
          </section>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
