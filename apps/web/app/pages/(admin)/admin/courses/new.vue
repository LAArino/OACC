<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// New course (spec §6.4 Channel C, §8.1): the course wizard posting
// `POST /api/admin/v1/organizations/{orgId}/courses`. Organizations harvested
// through OEAPI cannot create courses here (the form only writes overrides).
import type { AdminCourse, AdminCourseReference } from '~/types/admin';

definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const router = useRouter();
const auth = useAuth();
const coursesApi = useAdminCoursesApi();
const adminOrg = useAdminOrg();
const flash = useAdminFlash();
const {
  me,
  failure: meFailure,
  loading: meLoading,
  isAlliance,
  canManage,
  orgId,
  orgQuery,
} = adminOrg;
useHead({ title: () => t('admin.courses.newTitle') });

const reference = ref<AdminCourseReference | null>(null);
const failure = ref<AdminApiError | null>(null);
const loading = ref(false);

async function loadReference() {
  const org = orgId.value;
  reference.value = null;
  failure.value = null;
  if (!org) return;
  loading.value = true;
  try {
    reference.value = await coursesApi.reference(org);
  } catch (error) {
    failure.value = asAdminApiError(error);
  } finally {
    loading.value = false;
  }
}

let ready = false;
onMounted(async () => {
  if (!auth.isAuthenticated.value) return;
  await adminOrg.load();
  await loadReference();
  ready = true;
});
watch(orgId, (value, previous) => {
  if (ready && value !== previous) void loadReference();
});

async function onSaved(course: AdminCourse) {
  flash.set(t('admin.courses.created', { code: course.ext_id }));
  await router.push(localePath({ path: `/admin/courses/${course.id}`, query: orgQuery.value }));
}
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath({ path: '/admin/courses', query: orgQuery })">
      {{ t('admin.courses.backToList') }}
    </NuxtLink>
    <h1>{{ t('admin.courses.newTitle') }}</h1>

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
              <p>{{ t('admin.courses.loadingReference') }}</p>
            </AdminMessage>
            <AdminProblem v-else-if="failure" :error="failure" />
            <template v-else-if="reference">
              <div v-if="reference.form_mode === 'overrides'" class="notice">
                <p>{{ t('admin.courses.overridesModeNew') }}</p>
              </div>
              <AdminCourseEditor
                v-else
                :org-id="orgId"
                :reference="reference"
                :course="null"
                @saved="onSaved"
              />
            </template>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
