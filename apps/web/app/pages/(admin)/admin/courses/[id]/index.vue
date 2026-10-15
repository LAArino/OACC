<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// One course (spec §8.1 "Course wizard"): the wizard to edit it (`PUT`, or
// `PATCH …/overrides` for harvested records), status actions (`POST …/status`),
// delete, its offerings and its change history.
import type { AdminCourse, AdminLifecycleStatus } from '~/types/admin';

definePageMeta({ layout: 'admin' });
const { t, te, locale } = useI18n();
const localePath = useLocalePath();
const router = useRouter();
const coursesApi = useAdminCoursesApi();
const flash = useAdminFlash();
const page = useAdminCoursePage();
const {
  auth,
  me,
  meFailure,
  meLoading,
  canManage,
  orgQuery,
  courseId,
  course,
  reference,
  loading,
  failure,
} = page;

const notice = ref<string | null>(flash.take());
const noticeKey = ref(0);
const actionFailure = ref<AdminApiError | null>(null);
const busy = ref(false);
const historyVersion = ref(0);
const confirm = ref<{
  ask: (o: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
} | null>(null);

const title = computed(() => page.title.value || t('admin.courses.courseTitle'));
useHead({ title: () => title.value });

onMounted(page.init);
watch(courseId, (value, previous) => {
  if (value !== previous && me.value) void page.load();
});

const overridesMode = computed(() => reference.value?.form_mode === 'overrides');
const subject = computed(() => t('admin.courses.subject', { code: course.value?.ext_id ?? '' }));
/** Why the course cannot be deleted (the API's rule), or null. */
const blocker = computed(() =>
  course.value ? deleteBlocker(course.value, overridesMode.value) : null,
);
/** The status override of a harvested course, with the partner's status. */
const overriddenStatus = computed(() =>
  overridesMode.value && course.value ? statusOverride(course.value) : null,
);

function say(message: string) {
  notice.value = message;
  noticeKey.value++;
}

function onSaved(saved: AdminCourse) {
  course.value = saved;
  historyVersion.value++;
}

async function changeStatus(status: AdminLifecycleStatus) {
  const c = course.value;
  if (!c) return;
  busy.value = true;
  actionFailure.value = null;
  try {
    course.value = await coursesApi.setStatus(c.id, status);
    historyVersion.value++;
    say(t('admin.status.changed', { status: t(`admin.lifecycle.${status}`) }));
  } catch (error) {
    actionFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
}

/** Removes the status override (`PATCH …/overrides {clear: ["status"]}`). */
async function revertStatus() {
  const c = course.value;
  if (!c) return;
  busy.value = true;
  actionFailure.value = null;
  try {
    course.value = await coursesApi.patchOverrides(c.id, { clear: ['status'] });
    historyVersion.value++;
    say(t('admin.status.revert.done', { status: t(`admin.lifecycle.${course.value.status}`) }));
  } catch (error) {
    actionFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  const c = course.value;
  if (!c) return;
  const ok = await confirm.value?.ask({
    title: t('admin.courses.deleteTitle'),
    message: t('admin.courses.deleteMessage', { code: c.ext_id }),
    confirmLabel: t('admin.courses.delete'),
    danger: true,
  });
  if (!ok) return;
  busy.value = true;
  actionFailure.value = null;
  try {
    await coursesApi.remove(c.id);
    flash.set(t('admin.courses.deleted', { code: c.ext_id }));
    await router.push(localePath({ path: '/admin/courses', query: orgQuery.value }));
  } catch (error) {
    actionFailure.value = asAdminApiError(error);
  } finally {
    busy.value = false;
  }
}

const offeringLink = (id: string) =>
  localePath({
    path: `/admin/courses/${courseId.value}/offerings/${id}`,
    query: orgQuery.value,
  });
const sessionName = (s: { ext_id: string; name: string | Record<string, string> } | null) =>
  s ? adminLabel(s.name, locale.value) || s.ext_id : t('admin.none');
const modesText = (codes: string[]) =>
  codes
    .map(
      (code) =>
        adminLabel(
          reference.value?.delivery_modes.find((m) => m.code === code)?.label,
          locale.value,
        ) || code,
    )
    .join(', ');
const seatsText = (o: AdminCourse['offerings'][number]) =>
  [
    o.max_students !== null ? t('admin.offerings.seatsMax', { n: o.max_students }) : '',
    o.alliance_seats !== null ? t('admin.offerings.seatsAlliance', { n: o.alliance_seats }) : '',
    o.seats_available !== null ? t('admin.offerings.seatsAvailable', { n: o.seats_available }) : '',
  ]
    .filter(Boolean)
    .join(', ') || t('admin.none');
const kindLabel = (code: string) => (te(`kind.${code}`) ? t(`kind.${code}`) : code);
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath({ path: '/admin/courses', query: orgQuery })">
      {{ t('admin.courses.backToList') }}
    </NuxtLink>
    <h1>{{ title }}</h1>

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
          <AdminMessage v-if="loading && !course" :focus="false">
            <p>{{ t('admin.courses.loadingCourse') }}</p>
          </AdminMessage>
          <AdminProblem v-else-if="failure" :error="failure" />
          <template v-else-if="course && reference">
            <AdminMessage v-if="notice" :key="noticeKey">
              <p>{{ notice }}</p>
            </AdminMessage>
            <AdminProblem
              v-if="actionFailure"
              :error="actionFailure"
              :heading="t('admin.courses.actionFailed')"
            />

            <section aria-labelledby="course-summary-heading" class="admin-card">
              <h2 id="course-summary-heading">
                {{ t('admin.courses.summaryHeading') }}
              </h2>
              <dl class="facts">
                <dt>{{ t('admin.courses.fields.ext_id') }}</dt>
                <dd>
                  <code>{{ course.ext_id }}</code>
                </dd>
                <dt>{{ t('admin.courses.fields.kind') }}</dt>
                <dd>{{ kindLabel(course.kind) }}</dd>
                <dt>{{ t('admin.courses.source') }}</dt>
                <dd>{{ t(`admin.channel.${course.source_channel}`) }}</dd>
                <dt>{{ t('admin.courses.updated') }}</dt>
                <dd>{{ formatAdminDateTime(course.updated_at, locale) }}</dd>
                <template v-if="course.last_seen_at">
                  <dt>{{ t('admin.courses.lastSeen') }}</dt>
                  <dd>{{ formatAdminDateTime(course.last_seen_at, locale) }}</dd>
                </template>
              </dl>
              <AdminStatusActions
                :status="course.status"
                :subject="subject"
                entity="course"
                :busy="busy"
                @change="changeStatus"
              />
              <AdminStatusRevert
                v-if="overriddenStatus"
                :status="course.status"
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
                  {{ t('admin.courses.delete') }}
                </button>
              </p>
              <p v-else class="admin-hint admin-delete-blocked">
                {{ t(`admin.courses.deleteBlocked.${blocker}`) }}
              </p>
            </section>

            <section aria-labelledby="course-edit-heading">
              <h2 id="course-edit-heading" class="visually-hidden">
                {{ t('admin.courses.editHeading') }}
              </h2>
              <AdminCourseEditor
                :org-id="course.organization_id"
                :reference="reference"
                :course="course"
                @saved="onSaved"
              />
            </section>

            <section aria-labelledby="offerings-heading" class="admin-card">
              <h2 id="offerings-heading">
                {{ t('admin.offerings.heading') }}
              </h2>
              <p v-if="!overridesMode" class="admin-actions">
                <NuxtLink
                  class="button"
                  :to="
                    localePath({
                      path: `/admin/courses/${course.id}/offerings/new`,
                      query: orgQuery,
                    })
                  "
                >
                  {{ t('admin.offerings.add') }}
                </NuxtLink>
              </p>
              <p v-if="!course.offerings.length">
                {{ t('admin.offerings.empty') }}
              </p>
              <div
                v-else
                class="admin-table-wrap"
                role="region"
                aria-labelledby="offerings-caption"
                tabindex="0"
              >
                <table class="admin-table">
                  <caption id="offerings-caption">
                    {{
                      t(
                        'admin.offerings.caption',
                        { n: course.offerings.length },
                        course.offerings.length,
                      )
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{{ t('admin.offerings.fields.ext_offering_id') }}</th>
                      <th scope="col">{{ t('admin.offerings.session') }}</th>
                      <th scope="col">{{ t('admin.offerings.dates') }}</th>
                      <th scope="col">{{ t('admin.offerings.fields.application_deadline') }}</th>
                      <th scope="col">{{ t('admin.offerings.fields.delivery_modes') }}</th>
                      <th scope="col">{{ t('admin.offerings.fields.teaching_languages') }}</th>
                      <th scope="col">{{ t('admin.offerings.seats') }}</th>
                      <th scope="col">{{ t('admin.offerings.fields.status') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="o in course.offerings" :key="o.id">
                      <th scope="row">
                        <NuxtLink :to="offeringLink(o.id)">
                          {{ o.ext_offering_id }}
                          <span class="visually-hidden">{{ t('admin.offerings.edit') }}</span>
                        </NuxtLink>
                      </th>
                      <td>{{ sessionName(o.academic_session) }}</td>
                      <td>{{ t('dates.range', { start: o.start_date, end: o.end_date }) }}</td>
                      <td>{{ o.application_deadline ?? t('admin.none') }}</td>
                      <td>{{ modesText(o.delivery_modes) }}</td>
                      <td>{{ o.teaching_languages.join(', ') }}</td>
                      <td>{{ seatsText(o) }}</td>
                      <td>
                        <AdminLifecycleBadge :status="o.status" />
                        <span
                          v-if="Object.keys(o.overrides).length"
                          class="admin-badge admin-badge--ok"
                        >
                          {{ t('admin.override.badge') }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <AdminCourseHistory :course-id="course.id" :version="historyVersion" />
            <AdminConfirm ref="confirm" />
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
