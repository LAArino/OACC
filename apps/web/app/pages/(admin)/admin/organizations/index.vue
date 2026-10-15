<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Organizations module of alliance administrators (spec §2.1 step 1, §8):
// every organization of the alliance (`GET /api/admin/v1/organizations`) with
// its identifiers, hierarchy, course counts and state, filtered in the browser.
import type { AdminOrganizationRecord } from '~/types/admin';
import { ORG_TYPES, organizationDisplayName } from '~/utils/organizationForm';

definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const router = useRouter();
const auth = useAuth();
const api = useAdminAllianceApi();
const flash = useAdminFlash();
const adminOrg = useAdminOrg();
const { me, failure: meFailure, loading: meLoading, isAlliance } = adminOrg;
useHead({ title: () => t('admin.organizations.title') });

const items = ref<AdminOrganizationRecord[] | null>(null);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const notice = ref<string | null>(flash.take());

const q = ref('');
const type = ref('');
const partner = ref<'all' | 'yes' | 'no'>('all');
const state = ref<'active' | 'deleted' | 'all'>('active');

async function load() {
  loading.value = true;
  failure.value = null;
  try {
    items.value = (await api.listOrganizations({ includeDeleted: true })).items;
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

const byId = computed(() => new Map((items.value ?? []).map((o) => [o.id, o])));
const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return (items.value ?? [])
    .filter((o) => {
      if (state.value === 'active' && o.deleted_at) return false;
      if (state.value === 'deleted' && !o.deleted_at) return false;
      if (type.value && o.org_type !== type.value) return false;
      if (partner.value !== 'all' && o.is_partner !== (partner.value === 'yes')) return false;
      if (!needle) return true;
      return [o.slug, ...Object.values(o.name), o.schac_home_organization ?? ''].some((v) =>
        v.toLowerCase().includes(needle),
      );
    })
    .sort((a, b) => organizationDisplayName(a).localeCompare(organizationDisplayName(b)));
});
const announcement = computed(() =>
  items.value
    ? t('admin.organizations.resultCount', { n: filtered.value.length }, filtered.value.length)
    : '',
);

const typeOptions = computed(() => [
  { value: '', label: t('admin.organizations.filters.anyType') },
  ...ORG_TYPES.map((v) => ({ value: v, label: t(`admin.organizations.types.${v}`) })),
]);
const partnerOptions = computed(() =>
  (['all', 'yes', 'no'] as const).map((v) => ({
    value: v,
    label: t(`admin.organizations.filters.partner.${v}`),
  })),
);
const stateOptions = computed(() =>
  (['active', 'deleted', 'all'] as const).map((v) => ({
    value: v,
    label: t(`admin.organizations.filters.state.${v}`),
  })),
);

function clear() {
  q.value = '';
  type.value = '';
  partner.value = 'all';
  state.value = 'active';
}

const orgLink = (o: AdminOrganizationRecord) => localePath(`/admin/organizations/${o.id}`);
function parentName(o: AdminOrganizationRecord) {
  const parent = o.parent_id ? byId.value.get(o.parent_id) : undefined;
  return parent ? organizationDisplayName(parent) : o.parent_id ? o.parent_id : t('admin.none');
}
function onRowClick(o: AdminOrganizationRecord, event: MouseEvent) {
  if ((event.target as HTMLElement | null)?.closest('a, button')) return;
  void router.push(orgLink(o));
}
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath('/admin')">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.organizations.title') }}</h1>

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
          <AdminMessage v-if="notice">
            <p>{{ notice }}</p>
          </AdminMessage>
          <p class="admin-actions">
            <NuxtLink class="button" :to="localePath('/admin/organizations/new')">
              {{ t('admin.organizations.new') }}
            </NuxtLink>
            <NuxtLink :to="localePath('/admin/network')">
              {{ t('admin.modules.network.title') }}
            </NuxtLink>
          </p>

          <form
            class="admin-filters"
            role="search"
            :aria-label="t('admin.organizations.filters.label')"
            @submit.prevent
          >
            <div class="admin-form__row">
              <div class="admin-field">
                <label for="orgs-q">{{ t('admin.organizations.filters.search') }}</label>
                <input id="orgs-q" v-model="q" type="search" maxlength="200" />
              </div>
              <AdminInputField
                id="orgs-type"
                v-model="type"
                as="select"
                :options="typeOptions"
                :label="t('admin.organizations.fields.type')"
              />
              <AdminInputField
                id="orgs-partner"
                v-model="partner"
                as="select"
                :options="partnerOptions"
                :label="t('admin.organizations.filters.partnerLabel')"
              />
              <AdminInputField
                id="orgs-state"
                v-model="state"
                as="select"
                :options="stateOptions"
                :label="t('admin.organizations.filters.stateLabel')"
              />
            </div>
            <p class="admin-actions">
              <button type="button" class="button button--secondary" @click="clear">
                {{ t('admin.organizations.filters.clear') }}
              </button>
              <!-- aria-disabled, not disabled: disabling the focused button would drop the keyboard focus (WCAG 2.4.3). -->
              <button
                type="button"
                class="button button--secondary"
                :aria-disabled="loading ? 'true' : undefined"
                @click="loading || load()"
              >
                {{ t('admin.organizations.refresh') }}
              </button>
            </p>
          </form>

          <p class="visually-hidden" role="status" aria-live="polite">
            {{ announcement }}
          </p>
          <AdminMessage v-if="loading && !items" :focus="false">
            <p>{{ t('admin.organizations.loading') }}</p>
          </AdminMessage>
          <AdminProblem v-else-if="failure" :error="failure" />
          <template v-else-if="items">
            <p v-if="!filtered.length">
              {{ t('admin.organizations.empty') }}
            </p>
            <div
              v-else
              class="admin-table-wrap"
              role="region"
              aria-labelledby="orgs-caption"
              tabindex="0"
            >
              <table class="admin-table">
                <caption id="orgs-caption">
                  {{
                    t('admin.organizations.caption', { n: filtered.length, total: items.length })
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{{ t('admin.organizations.fields.slug') }}</th>
                    <th scope="col">{{ t('admin.organizations.columns.name') }}</th>
                    <th scope="col">{{ t('admin.organizations.fields.type') }}</th>
                    <th scope="col">{{ t('admin.organizations.columns.partner') }}</th>
                    <th scope="col">{{ t('admin.organizations.fields.parent') }}</th>
                    <th scope="col" class="num">{{ t('admin.organizations.columns.courses') }}</th>
                    <th scope="col" class="num">{{ t('admin.organizations.columns.subUnits') }}</th>
                    <th scope="col">{{ t('admin.organizations.fields.idpAlias') }}</th>
                    <th scope="col">{{ t('admin.organizations.columns.state') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="o in filtered"
                    :key="o.id"
                    class="admin-table__link-row"
                    @click="onRowClick(o, $event)"
                  >
                    <th scope="row">
                      <NuxtLink :to="orgLink(o)">{{ o.slug }}</NuxtLink>
                    </th>
                    <td>{{ organizationDisplayName(o) }}</td>
                    <td>{{ t(`admin.organizations.types.${o.org_type}`) }}</td>
                    <td>{{ o.is_partner ? t('admin.yes') : t('admin.no') }}</td>
                    <td>{{ parentName(o) }}</td>
                    <td class="num">
                      {{
                        t('admin.organizations.coursesCount', {
                          published: o.counts.courses_published,
                          total: o.counts.courses_total,
                        })
                      }}
                    </td>
                    <td class="num">{{ o.counts.sub_units }}</td>
                    <td>
                      <code v-if="o.keycloak_idp_alias">{{ o.keycloak_idp_alias }}</code>
                      <template v-else>{{ t('admin.organizations.localAccounts') }}</template>
                    </td>
                    <td>
                      <AdminBadge
                        :tone="o.deleted_at ? 'bad' : 'ok'"
                        :label="
                          o.deleted_at
                            ? t('admin.organizations.deleted')
                            : t('admin.organizations.active')
                        "
                      />
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
