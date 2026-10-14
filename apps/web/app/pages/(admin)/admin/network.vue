<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Network status (alliance administrators; spec §8): one row per organization
// with the health of its data feed, channel and harvesting state, last run,
// course and offering counts, administrators and pending invitations
// (`GET /api/admin/v1/network-status`).
import type { AdminNetworkHealth, AdminNetworkStatus, AdminNetworkStatusItem } from '~/types/admin';
import { organizationDisplayName } from '~/utils/organizationForm';

definePageMeta({ layout: 'admin' });
const { t, locale } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const api = useAdminAllianceApi();
const adminOrg = useAdminOrg();
const { me, failure: meFailure, loading: meLoading, isAlliance } = adminOrg;
useHead({ title: () => t('admin.network.title') });

const status = ref<AdminNetworkStatus | null>(null);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const announcement = ref('');

const HEALTH_ORDER: AdminNetworkHealth[] = ['error', 'warning', 'unconfigured', 'ok'];

async function load() {
  loading.value = true;
  failure.value = null;
  announcement.value = '';
  try {
    status.value = await api.networkStatus();
    announcement.value = t('admin.network.updated', {
      date: formatAdminDateTime(status.value.generated_at, locale.value),
    });
  } catch (error) {
    failure.value = asAdminApiError(error);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (!auth.isAuthenticated.value) return;
  await adminOrg.load();
  if (isAlliance.value) await load();
});

/** Problems first, then by name. */
const rows = computed(() =>
  [...(status.value?.items ?? [])].sort(
    (a, b) =>
      HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health) ||
      organizationDisplayName(a.organization).localeCompare(
        organizationDisplayName(b.organization),
      ),
  ),
);
const totals = computed(() =>
  HEALTH_ORDER.map((h) => ({ health: h, n: rows.value.filter((r) => r.health === h).length })),
);

const orgLink = (r: AdminNetworkStatusItem) =>
  localePath(`/admin/organizations/${r.organization.id}`);
const historyLink = (r: AdminNetworkStatusItem) =>
  localePath({ path: '/admin/sync-runs', query: { org: r.organization.id } });
const runLink = (r: AdminNetworkStatusItem) =>
  r.last_run
    ? localePath({ path: `/admin/sync-runs/${r.last_run.id}`, query: { org: r.organization.id } })
    : null;
const yesNo = (v: boolean) => (v ? t('admin.yes') : t('admin.no'));
</script>

<template>
  <div class="admin-page admin-page--wide">
    <NuxtLink class="admin-back" :to="localePath('/admin')">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.network.title') }}</h1>

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
          <p>{{ t('admin.network.intro') }}</p>
          <p class="admin-actions">
            <button
              type="button"
              class="button button--secondary"
              :disabled="loading"
              @click="load"
            >
              {{ t('admin.network.refresh') }}
            </button>
            <span v-if="status">{{
              t('admin.network.generatedAt', {
                date: formatAdminDateTime(status.generated_at, locale),
              })
            }}</span>
          </p>
          <p class="visually-hidden" role="status" aria-live="polite">
            {{ announcement }}
          </p>
          <AdminMessage v-if="loading && !status" :focus="false">
            <p>{{ t('admin.network.loading') }}</p>
          </AdminMessage>
          <AdminProblem v-else-if="failure" :error="failure" />
          <template v-else-if="status">
            <ul class="admin-health-totals" :aria-label="t('admin.network.totalsLabel')">
              <li v-for="x in totals" :key="x.health">
                <AdminHealthBadge :health="x.health" />
                {{ x.n }}
              </li>
            </ul>
            <p v-if="!rows.length">
              {{ t('admin.network.empty') }}
            </p>
            <div
              v-else
              class="admin-table-wrap"
              role="region"
              aria-labelledby="network-caption"
              tabindex="0"
            >
              <table class="admin-table">
                <caption id="network-caption">
                  {{
                    t('admin.network.caption', { n: rows.length }, rows.length)
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{{ t('admin.network.columns.organization') }}</th>
                    <th scope="col">{{ t('admin.network.columns.health') }}</th>
                    <th scope="col">{{ t('admin.network.columns.channel') }}</th>
                    <th scope="col">{{ t('admin.network.columns.enabled') }}</th>
                    <th scope="col">{{ t('admin.network.columns.hostApproved') }}</th>
                    <th scope="col">{{ t('admin.network.columns.lastRun') }}</th>
                    <th scope="col">{{ t('admin.network.columns.lastSuccess') }}</th>
                    <th scope="col" class="num">{{ t('admin.network.columns.courses') }}</th>
                    <th scope="col" class="num">{{ t('admin.network.columns.offerings') }}</th>
                    <th scope="col" class="num">{{ t('admin.network.columns.admins') }}</th>
                    <th scope="col" class="num">{{ t('admin.network.columns.invitations') }}</th>
                    <th scope="col">{{ t('admin.network.columns.history') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in rows" :key="r.organization.id">
                    <th scope="row">
                      <NuxtLink :to="orgLink(r)">
                        {{ organizationDisplayName(r.organization) }}
                      </NuxtLink>
                    </th>
                    <td><AdminHealthBadge :health="r.health" /></td>
                    <td>
                      {{ t(`admin.channel.${r.authoritative_channel}`) }}
                    </td>
                    <td>{{ yesNo(r.enabled) }}</td>
                    <td>
                      {{
                        r.access_mode === 'direct'
                          ? yesNo(r.host_approved)
                          : t('admin.network.notApplicable')
                      }}
                    </td>
                    <td>
                      <template v-if="r.last_run">
                        <AdminStatusBadge :status="r.last_run.status" />
                        {{ ' ' }}
                        <NuxtLink :to="runLink(r)!">
                          {{
                            r.last_run.finished_at
                              ? formatAdminDateTime(r.last_run.finished_at, locale)
                              : t('admin.network.notFinished')
                          }}
                        </NuxtLink>
                        <br />
                        <span class="admin-hint">{{
                          t('admin.network.counters', {
                            created: r.last_run.n_created,
                            updated: r.last_run.n_updated,
                            unchanged: r.last_run.n_unchanged,
                            rejected: r.last_run.n_rejected,
                            withdrawn: r.last_run.n_withdrawn,
                          })
                        }}</span>
                      </template>
                      <template v-else>{{ t('admin.network.noRun') }}</template>
                    </td>
                    <td>
                      {{
                        r.last_success_at
                          ? formatAdminDateTime(r.last_success_at, locale)
                          : t('admin.none')
                      }}
                    </td>
                    <td class="num">
                      {{
                        t('admin.organizations.coursesCount', {
                          published: r.courses_published,
                          total: r.courses_total,
                        })
                      }}
                    </td>
                    <td class="num">{{ r.offerings_upcoming }}</td>
                    <td class="num">
                      {{ r.admins_count === null ? t('admin.network.unknown') : r.admins_count }}
                    </td>
                    <td class="num">{{ r.pending_invitations }}</td>
                    <td>
                      <NuxtLink
                        :to="historyLink(r)"
                        :aria-label="
                          t('admin.network.historyFor', {
                            name: organizationDisplayName(r.organization),
                          })
                        "
                      >
                        {{ t('admin.network.historyLink') }}
                      </NuxtLink>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
