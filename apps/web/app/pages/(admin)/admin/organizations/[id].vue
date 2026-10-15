<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// One organization (alliance administrators; spec §2.1, §8): details form,
// delete and restore, its administrators and invitations, and links to its
// integration settings, sync history and courses.
import type { AdminOrganizationRecord } from '~/types/admin';
import {
  descendantIds,
  organizationBody,
  organizationDisplayName,
  organizationFormOf,
  organizationTreeOptions,
} from '~/utils/organizationForm';

definePageMeta({ layout: 'admin' });
const { t, locale } = useI18n();
const localePath = useLocalePath();
const route = useRoute();
const auth = useAuth();
const api = useAdminAllianceApi();
const flash = useAdminFlash();
const adminOrg = useAdminOrg();
const { me, failure: meFailure, loading: meLoading, isAlliance } = adminOrg;

const orgId = computed(() => String(route.params.id ?? ''));
const org = ref<AdminOrganizationRecord | null>(null);
const all = ref<AdminOrganizationRecord[]>([]);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const saveFailure = ref<AdminApiError | null>(null);
const actionFailure = ref<AdminApiError | null>(null);
const notice = ref<string | null>(flash.take());
const busy = ref(false);
const summary = ref<HTMLElement | null>(null);
const confirm = ref<{
  ask: (o: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
} | null>(null);

const name = computed(() => (org.value ? organizationDisplayName(org.value) : ''));
useHead({ title: () => name.value || t('admin.organizations.title') });

const editor = useAdminOrganizationForm(() => ({ creating: false, selfId: orgId.value }));
const { form, errors, summaryIssues } = editor;

async function load() {
  loading.value = true;
  failure.value = null;
  try {
    const [record, list] = await Promise.all([
      api.getOrganization(orgId.value),
      api.listOrganizations().catch(() => ({ items: [] as AdminOrganizationRecord[] })),
    ]);
    org.value = record;
    all.value = list.items;
    editor.reset(organizationFormOf(record));
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

const parentOptions = computed(() =>
  organizationTreeOptions(all.value, descendantIds(orgId.value, all.value)),
);
const deleted = computed(() => Boolean(org.value?.deleted_at));
const orgQuery = computed(() => ({ org: orgId.value }));

async function focusSummary() {
  await nextTick();
  summary.value?.querySelector<HTMLElement>('[role="alert"]')?.focus();
}

async function save() {
  saveFailure.value = null;
  notice.value = null;
  if (!editor.validate()) return focusSummary();
  busy.value = true;
  try {
    const saved = await api.updateOrganization(orgId.value, organizationBody(form.value));
    org.value = saved;
    editor.reset(organizationFormOf(saved));
    notice.value = t('admin.organizations.saved');
  } catch (error) {
    const e = asAdminApiError(error);
    if (editor.applyServerError(e)) await focusSummary();
    else saveFailure.value = e;
  } finally {
    busy.value = false;
  }
}

async function remove() {
  const current = org.value;
  if (!current) return;
  const ok = await confirm.value?.ask({
    title: t('admin.organizations.deleteTitle'),
    message: t('admin.organizations.deleteMessage', { name: name.value }),
    confirmLabel: t('admin.organizations.delete'),
    danger: true,
  });
  if (!ok) return;
  await act(async () => {
    await api.deleteOrganization(current.id);
    await load();
    notice.value = t('admin.organizations.deletedNotice', { name: name.value });
  });
}

async function restore() {
  const current = org.value;
  if (!current) return;
  const ok = await confirm.value?.ask({
    title: t('admin.organizations.restoreTitle'),
    message: t('admin.organizations.restoreMessage', { name: name.value }),
    confirmLabel: t('admin.organizations.restore'),
  });
  if (!ok) return;
  await act(async () => {
    const restored = await api.restoreOrganization(current.id);
    org.value = restored;
    editor.reset(organizationFormOf(restored));
    notice.value = t('admin.organizations.restored', { name: name.value });
  });
}

async function act(run: () => Promise<void>) {
  busy.value = true;
  actionFailure.value = null;
  notice.value = null;
  try {
    await run();
  } catch (error) {
    actionFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
}

const sections = computed(() =>
  deleted.value
    ? ['details', 'state']
    : ['details', 'admins', 'invitations', 'integration', 'courses', 'state'],
);
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath('/admin/organizations')">
      {{ t('admin.organizations.backToList') }}
    </NuxtLink>
    <h1>{{ name || t('admin.organizations.title') }}</h1>

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
          <AdminMessage v-if="loading && !org" :focus="false">
            <p>{{ t('admin.organizations.loadingOne') }}</p>
          </AdminMessage>
          <AdminProblem v-else-if="failure && !org" :error="failure" />
          <template v-else-if="org">
            <p>
              <code>{{ org.slug }}</code>
              {{ ' ' }}
              <AdminBadge
                :tone="deleted ? 'bad' : 'ok'"
                :label="
                  deleted ? t('admin.organizations.deleted') : t('admin.organizations.active')
                "
              />
            </p>
            <nav class="admin-toc" :aria-label="t('admin.organizations.sectionsLabel')">
              <ul>
                <li v-for="s in sections" :key="s">
                  <a :href="`#section-${s}`">{{ t(`admin.organizations.tabs.${s}`) }}</a>
                </li>
              </ul>
            </nav>
            <AdminMessage v-if="notice">
              <p>{{ notice }}</p>
            </AdminMessage>
            <AdminProblem v-if="actionFailure" :error="actionFailure" />

            <section aria-labelledby="section-details">
              <h2 id="section-details" tabindex="-1">
                {{ t('admin.organizations.tabs.details') }}
              </h2>
              <dl class="facts">
                <dt>{{ t('admin.organizations.columns.courses') }}</dt>
                <dd>
                  {{
                    t('admin.organizations.coursesCount', {
                      published: org.counts.courses_published,
                      total: org.counts.courses_total,
                    })
                  }}
                </dd>
                <dt>{{ t('admin.organizations.columns.subUnits') }}</dt>
                <dd>{{ org.counts.sub_units }}</dd>
                <dt>{{ t('admin.organizations.updatedAt') }}</dt>
                <dd>{{ formatAdminDateTime(org.updated_at, locale) }}</dd>
              </dl>
              <div ref="summary">
                <AdminErrorSummary
                  :heading="
                    t('admin.form.errorSummary', { n: summaryIssues.length }, summaryIssues.length)
                  "
                  :issues="summaryIssues"
                  @select="focusFormField"
                />
              </div>
              <AdminOrganizationForm
                v-model="form"
                :creating="false"
                :errors="errors"
                :parent-options="parentOptions"
                :busy="busy"
                :submit-label="t('admin.organizations.save')"
                @submit="save"
              />
              <AdminProblem v-if="saveFailure" :error="saveFailure" />
            </section>

            <template v-if="!deleted">
              <section aria-labelledby="section-admins">
                <h2 id="section-admins" tabindex="-1">
                  {{ t('admin.organizations.tabs.admins') }}
                </h2>
                <AdminAccountsPanel :org-id="org.id" :self-sub="me.sub" />
              </section>

              <section aria-labelledby="section-invitations">
                <h2 id="section-invitations" tabindex="-1">
                  {{ t('admin.organizations.tabs.invitations') }}
                </h2>
                <AdminInvitationsPanel
                  :org-id="org.id"
                  :is-alliance="true"
                  :level="3"
                  :idp-alias="org.keycloak_idp_alias"
                />
                <p>
                  <NuxtLink :to="localePath({ path: '/admin/invitations', query: orgQuery })">
                    {{ t('admin.organizations.openInvitations') }}
                  </NuxtLink>
                </p>
              </section>

              <section aria-labelledby="section-integration">
                <h2 id="section-integration" tabindex="-1">
                  {{ t('admin.organizations.tabs.integration') }}
                </h2>
                <p>{{ t('admin.organizations.integrationIntro') }}</p>
                <ul>
                  <li>
                    <NuxtLink :to="localePath({ path: '/admin/integration', query: orgQuery })">
                      {{ t('admin.modules.integration.title') }}
                    </NuxtLink>
                  </li>
                  <li>
                    <NuxtLink :to="localePath({ path: '/admin/sync-runs', query: orgQuery })">
                      {{ t('admin.modules.syncRuns.title') }}
                    </NuxtLink>
                  </li>
                </ul>
              </section>

              <section aria-labelledby="section-courses">
                <h2 id="section-courses" tabindex="-1">
                  {{ t('admin.organizations.tabs.courses') }}
                </h2>
                <p>
                  <NuxtLink :to="localePath({ path: '/admin/courses', query: orgQuery })">
                    {{
                      t('admin.organizations.openCourses', {
                        published: org.counts.courses_published,
                        total: org.counts.courses_total,
                      })
                    }}
                  </NuxtLink>
                </p>
              </section>
            </template>

            <section aria-labelledby="section-state" class="admin-card">
              <h2 id="section-state" tabindex="-1">
                {{ t('admin.organizations.tabs.state') }}
              </h2>
              <template v-if="deleted">
                <p>
                  {{
                    t('admin.organizations.deletedOn', {
                      date: formatAdminDateTime(org.deleted_at, locale),
                    })
                  }}
                </p>
                <p class="admin-actions">
                  <button type="button" class="button" :disabled="busy" @click="restore">
                    {{ t('admin.organizations.restore') }}
                  </button>
                </p>
              </template>
              <template v-else>
                <p>{{ t('admin.organizations.deleteIntro') }}</p>
                <p class="admin-actions">
                  <button
                    type="button"
                    class="button button--secondary button--danger-text"
                    :disabled="busy"
                    @click="remove"
                  >
                    {{ t('admin.organizations.delete') }}
                  </button>
                </p>
              </template>
            </section>
          </template>
        </template>
      </template>
    </template>
    <AdminConfirm ref="confirm" />
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
