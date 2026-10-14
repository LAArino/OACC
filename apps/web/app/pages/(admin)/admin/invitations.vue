<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Invitations module (spec §2.1, §8): alliance administrators manage the
// invitations of any organization (chosen with the organization picker, kept in
// `?org=`), partner administrators those of their own organization.
definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
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
useHead({ title: () => t('admin.invitations.title') });

onMounted(() => {
  if (auth.isAuthenticated.value) void adminOrg.load();
});
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath({ path: '/admin', query: orgQuery })">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.invitations.title') }}</h1>

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
          <AdminInvitationsPanel v-else :org-id="orgId" :is-alliance="isAlliance" />
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
