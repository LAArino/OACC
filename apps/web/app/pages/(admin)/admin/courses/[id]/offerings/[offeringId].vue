<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// One offering of a course (spec §8.1): edit (`PUT /offerings/{id}`, or
// `PATCH …/overrides` when harvested), status actions and delete. The offering
// is read from its course (`GET /courses/{id}` embeds the offerings).
import type { AdminLifecycleStatus, AdminOffering } from '~/types/admin';

definePageMeta({ layout: 'admin' });
const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();
const router = useRouter();
const flash = useAdminFlash();
const coursesApi = useAdminCoursesApi();
const page = useAdminCoursePage();
const { auth, me, meFailure, meLoading, canManage, orgQuery, course, reference, loading, failure } =
  page;

const offeringId = computed(() => String(route.params.offeringId ?? ''));
const offering = computed(
  () => course.value?.offerings.find((o) => o.id === offeringId.value) ?? null,
);
const heading = computed(() =>
  offering.value
    ? t('admin.offerings.editTitle', { code: offering.value.ext_offering_id })
    : t('admin.offerings.title'),
);
useHead({ title: () => heading.value });

const notice = ref<string | null>(flash.take());
const noticeKey = ref(0);
const actionFailure = ref<AdminApiError | null>(null);
const busy = ref(false);
const confirm = ref<{
  ask: (o: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
} | null>(null);
const overridesMode = computed(() => reference.value?.form_mode === 'overrides');
const subject = computed(() =>
  t('admin.offerings.subject', { code: offering.value?.ext_offering_id ?? '' }),
);
/** Why the offering cannot be deleted (the API's rule), or null. */
const blocker = computed(() =>
  offering.value ? deleteBlocker(offering.value, overridesMode.value) : null,
);
/** The status override of a harvested offering, with the partner's status. */
const overriddenStatus = computed(() =>
  overridesMode.value && offering.value ? statusOverride(offering.value) : null,
);

onMounted(page.init);

function replaceOffering(updated: AdminOffering) {
  const c = course.value;
  if (!c) return;
  course.value = { ...c, offerings: c.offerings.map((o) => (o.id === updated.id ? updated : o)) };
}

function say(message: string) {
  notice.value = message;
  noticeKey.value++;
}

async function changeStatus(status: AdminLifecycleStatus) {
  const o = offering.value;
  if (!o) return;
  busy.value = true;
  actionFailure.value = null;
  try {
    replaceOffering(await coursesApi.setOfferingStatus(o.id, status));
    say(t('admin.status.changed', { status: t(`admin.lifecycle.${status}`) }));
  } catch (error) {
    actionFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
}

/** Removes the status override (`PATCH …/overrides {clear: ["status"]}`). */
async function revertStatus() {
  const o = offering.value;
  if (!o) return;
  busy.value = true;
  actionFailure.value = null;
  try {
    const updated = await coursesApi.patchOfferingOverrides(o.id, { clear: ['status'] });
    replaceOffering(updated);
    say(t('admin.status.revert.done', { status: t(`admin.lifecycle.${updated.status}`) }));
  } catch (error) {
    actionFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  const o = offering.value;
  if (!o) return;
  const ok = await confirm.value?.ask({
    title: t('admin.offerings.deleteTitle'),
    message: t('admin.offerings.deleteMessage', { code: o.ext_offering_id }),
    confirmLabel: t('admin.offerings.delete'),
    danger: true,
  });
  if (!ok) return;
  busy.value = true;
  actionFailure.value = null;
  try {
    await coursesApi.removeOffering(o.id);
    flash.set(t('admin.offerings.deleted', { code: o.ext_offering_id }));
    await router.push(
      localePath({ path: `/admin/courses/${page.courseId.value}`, query: orgQuery.value }),
    );
  } catch (error) {
    actionFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
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
    <h1>{{ heading }}</h1>

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
            <AdminMessage v-if="!offering" kind="alert">
              <p>{{ t('problem.notFound') }}</p>
            </AdminMessage>
            <template v-else>
              <AdminMessage v-if="notice" :key="noticeKey">
                <p>{{ notice }}</p>
              </AdminMessage>
              <AdminProblem
                v-if="actionFailure"
                :error="actionFailure"
                :heading="t('admin.courses.actionFailed')"
              />
              <section aria-labelledby="offering-status-heading" class="admin-card">
                <h2 id="offering-status-heading">
                  {{ t('admin.offerings.statusHeading') }}
                </h2>
                <AdminStatusActions
                  :status="offering.status"
                  :subject="subject"
                  entity="offering"
                  :busy="busy"
                  @change="changeStatus"
                />
                <AdminStatusRevert
                  v-if="overriddenStatus"
                  :status="offering.status"
                  :source="overriddenStatus.source"
                  :subject="subject"
                  :busy="busy"
                  @revert="revertStatus"
                />
                <p v-if="!blocker" class="admin-actions">
                  <button
                    type="button"
                    class="button button--secondary button--danger-text"
                    :disabled="busy"
                    @click="remove"
                  >
                    {{ t('admin.offerings.delete') }}
                  </button>
                </p>
                <p v-else class="admin-hint admin-delete-blocked">
                  {{ t(`admin.courses.deleteBlocked.${blocker}`) }}
                </p>
              </section>
              <AdminOfferingForm
                :reference="reference"
                :course="course"
                :offering="offering"
                @saved="replaceOffering"
              />
              <AdminConfirm ref="confirm" />
            </template>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
