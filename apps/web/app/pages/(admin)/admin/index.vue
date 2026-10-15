<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Dashboard (spec §8): the signed-in administrator as the API sees it
// (`GET /api/admin/v1/me`), then the modules of their role for the selected
// organization (token `org_id`, or `?org=` chosen by an alliance administrator).
definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const adminOrg = useAdminOrg();
const { me, failure, loading, isAlliance, canManage, orgId, orgQuery } = adminOrg;
useHead({ title: () => t('admin.title') });

onMounted(() => {
  if (auth.isAuthenticated.value) void adminOrg.load();
});

const modules = computed(() => {
  if (!canManage.value || !orgId.value) return [];
  const query = orgQuery.value;
  return [
    { key: 'courses', to: localePath({ path: '/admin/courses', query }) },
    { key: 'csv', to: localePath({ path: '/admin/csv', query }) },
    { key: 'syncRuns', to: localePath({ path: '/admin/sync-runs', query }) },
    { key: 'integration', to: localePath({ path: '/admin/integration', query }) },
    { key: 'invitations', to: localePath({ path: '/admin/invitations', query }) },
  ];
});

const allianceModules = computed(() => [
  { key: 'network', to: localePath('/admin/network') },
  { key: 'organizations', to: localePath('/admin/organizations') },
  { key: 'maintenance', to: localePath('/admin/maintenance') },
]);
</script>

<template>
  <div class="admin-page">
    <h1>{{ t('admin.title') }}</h1>

    <AdminSignInPrompt v-if="!auth.isAuthenticated.value" />

    <template v-else>
      <AdminMessage v-if="loading" :focus="false">
        <p>{{ t('admin.loadingAccount') }}</p>
      </AdminMessage>
      <AdminProblem v-else-if="failure" :error="failure" />
      <template v-else-if="me">
        <section aria-labelledby="account-heading" class="admin-card">
          <h2 id="account-heading">
            {{ t('admin.accountHeading') }}
          </h2>
          <dl class="facts">
            <dt>{{ t('admin.email') }}</dt>
            <dd>{{ me.email ?? t('admin.none') }}</dd>
            <dt>{{ t('admin.roles') }}</dt>
            <dd>
              {{
                me.roles.length ? me.roles.map((r) => t(`roles.${r}`)).join(', ') : t('admin.none')
              }}
            </dd>
            <dt>{{ t('admin.organization') }}</dt>
            <dd>{{ me.org_id ?? t('admin.none') }}</dd>
            <dt>{{ t('admin.idp') }}</dt>
            <dd>{{ me.idp }}</dd>
          </dl>
          <p v-if="!me.roles.length">
            {{ t('admin.noRole') }}
          </p>
        </section>

        <nav v-if="canManage" aria-labelledby="modules-heading">
          <h2 id="modules-heading">
            {{ t('admin.modules.heading') }}
          </h2>
          <AdminOrgPicker :org-id="orgId" :editable="isAlliance" />
          <p v-if="!orgId">
            {{ t('admin.modules.chooseOrganization') }}
          </p>
          <ul v-else class="admin-modules">
            <li v-for="m in modules" :key="m.key">
              <NuxtLink :to="m.to">
                {{ t(`admin.modules.${m.key}.title`) }}
              </NuxtLink>
              <p>{{ t(`admin.modules.${m.key}.description`) }}</p>
            </li>
          </ul>
          <template v-if="isAlliance">
            <h3>{{ t('admin.modules.allianceHeading') }}</h3>
            <ul class="admin-modules">
              <li v-for="m in allianceModules" :key="m.key">
                <NuxtLink :to="m.to">
                  {{ t(`admin.modules.${m.key}.title`) }}
                </NuxtLink>
                <p>{{ t(`admin.modules.${m.key}.description`) }}</p>
              </li>
            </ul>
          </template>
        </nav>
      </template>
      <p class="admin-actions">
        <button type="button" class="button button--secondary" @click="auth.logout()">
          {{ t('admin.signOut') }}
        </button>
      </p>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
