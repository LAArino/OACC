<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// New offering of a course (spec §6.4, §8.1): `POST /api/admin/v1/courses/{id}/offerings`.
import type { AdminOffering } from '~/types/admin';

definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const router = useRouter();
const flash = useAdminFlash();
const page = useAdminCoursePage();
const { auth, me, meFailure, meLoading, canManage, orgQuery, course, reference, loading, failure } =
  page;
useHead({ title: () => t('admin.offerings.newTitle') });

onMounted(page.init);

async function onSaved(offering: AdminOffering) {
  flash.set(t('admin.offerings.created', { code: offering.ext_offering_id }));
  await router.push(
    localePath({
      path: `/admin/courses/${page.courseId.value}/offerings/${offering.id}`,
      query: orgQuery.value,
    }),
  );
}
</script>

<template>
  <div class="admin-page">
    <NuxtLink
      class="admin-back"
      :to="localePath({ path: `/admin/courses/${page.courseId.value}`, query: orgQuery })"
    >
      {{ t('admin.offerings.backToCourse') }}
    </NuxtLink>
    <h1>{{ t('admin.offerings.newTitle') }}</h1>

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
          <AdminMessage v-if="loading" :focus="false">
            <p>{{ t('admin.courses.loadingCourse') }}</p>
          </AdminMessage>
          <AdminProblem v-else-if="failure" :error="failure" />
          <template v-else-if="course && reference">
            <p>{{ t('admin.offerings.ofCourse', { course: page.title.value }) }}</p>
            <div v-if="reference.form_mode === 'overrides'" class="notice">
              <p>{{ t('admin.offerings.overridesModeNew') }}</p>
            </div>
            <AdminOfferingForm
              v-else
              :reference="reference"
              :course="course"
              :offering="null"
              @saved="onSaved"
            />
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
