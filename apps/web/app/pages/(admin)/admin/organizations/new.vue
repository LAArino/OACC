<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// New organization (alliance administrators; spec §2.1 step 1): replaces the
// `oecp seed-organizations` step of Guide A for single organizations.
import type { AdminOrganizationRecord } from '~/types/admin';
import { organizationBody, organizationTreeOptions } from '~/utils/organizationForm';

definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const router = useRouter();
const auth = useAuth();
const api = useAdminAllianceApi();
const flash = useAdminFlash();
const adminOrg = useAdminOrg();
const { me, failure: meFailure, loading: meLoading, isAlliance } = adminOrg;
useHead({ title: () => t('admin.organizations.newTitle') });

const editor = useAdminOrganizationForm(() => ({ creating: true }));
const { form, errors, summaryIssues } = editor;
const all = ref<AdminOrganizationRecord[]>([]);
const busy = ref(false);
const failure = ref<AdminApiError | null>(null);
const summary = ref<HTMLElement | null>(null);

onMounted(async () => {
  if (!auth.isAuthenticated.value) return;
  await adminOrg.load();
  if (!isAlliance.value) return;
  try {
    all.value = (await api.listOrganizations()).items;
  } catch {
    // The parent list stays empty; the form still works for top-level organizations.
  }
});

const parentOptions = computed(() => organizationTreeOptions(all.value));

async function focusSummary() {
  await nextTick();
  summary.value?.querySelector<HTMLElement>('[role="alert"]')?.focus();
}

async function submit() {
  failure.value = null;
  if (!editor.validate()) return focusSummary();
  busy.value = true;
  try {
    const created = await api.createOrganization(organizationBody(form.value));
    flash.set(t('admin.organizations.created', { name: created.name.en ?? created.slug }));
    await router.push(localePath(`/admin/organizations/${created.id}`));
  } catch (error) {
    const e = asAdminApiError(error);
    if (editor.applyServerError(e)) await focusSummary();
    else failure.value = e;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath('/admin/organizations')">
      {{ t('admin.organizations.backToList') }}
    </NuxtLink>
    <h1>{{ t('admin.organizations.newTitle') }}</h1>

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
          <p>{{ t('admin.organizations.newIntro') }}</p>
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
            creating
            :errors="errors"
            :parent-options="parentOptions"
            :busy="busy"
            :submit-label="t('admin.organizations.create')"
            @submit="submit"
          />
          <AdminProblem v-if="failure" :error="failure" />
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
