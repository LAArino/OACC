<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Courses of the organization (spec §8.1 "Course wizard"):
// `GET /api/admin/v1/organizations/{orgId}/courses` with search, status, kind
// and source filters and pagination, all kept in the URL. A row opens the course.
// The Completeness column [DL 21] appears once the API sends `complete`.
import type { AdminCourseList, AdminCourseListItem, AdminCourseReference } from '~/types/admin';

definePageMeta({ layout: 'admin' });
const { t, te, locale } = useI18n();
const localePath = useLocalePath();
const route = useRoute();
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
useHead({ title: () => t('admin.courses.title') });

const PAGE_SIZE = 25;
const STATUSES = ['draft', 'published', 'withdrawn', 'cancelled'] as const;
const SOURCES = ['oeapi', 'csv', 'form'] as const;

const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).filter(
    (v): v is string => typeof v === 'string' && v !== '',
  );

const applied = computed(() => {
  const page = Number(route.query.page);
  return {
    q: typeof route.query.q === 'string' ? route.query.q : '',
    status: list(route.query.status),
    kind: list(route.query.kind),
    source_channel: list(route.query.source_channel),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
});

// Form state, synchronised from the URL.
const q = ref('');
const status = ref<string[]>([]);
const kind = ref<string[]>([]);
const source = ref<string[]>([]);
watch(
  applied,
  (value) => {
    q.value = value.q;
    status.value = [...value.status];
    kind.value = [...value.kind];
    source.value = [...value.source_channel];
  },
  { immediate: true },
);

const reference = ref<AdminCourseReference | null>(null);
const data = ref<AdminCourseList | null>(null);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
const notice = ref<string | null>(flash.take());
const announcement = ref('');
let request = 0;

async function loadReference() {
  const org = orgId.value;
  reference.value = null;
  if (!org) return;
  try {
    reference.value = await coursesApi.reference(org);
  } catch (error) {
    failure.value = asAdminApiError(error);
  }
}

async function loadCourses() {
  const org = orgId.value;
  const current = ++request;
  failure.value = null;
  if (!org) {
    data.value = null;
    return;
  }
  loading.value = true;
  try {
    const result = await coursesApi.list(org, { ...applied.value, page_size: PAGE_SIZE });
    if (current !== request) return;
    data.value = result;
    announcement.value = t('admin.courses.resultCount', { n: result.total }, result.total);
  } catch (error) {
    if (current === request) failure.value = asAdminApiError(error);
  } finally {
    if (current === request) loading.value = false;
  }
}

/** Set once the first load ran; later organization or query changes reload. */
let ready = false;
onMounted(async () => {
  if (!auth.isAuthenticated.value) return;
  await adminOrg.load();
  await Promise.all([loadReference(), loadCourses()]);
  ready = true;
});
watch(orgId, (value, previous) => {
  if (ready && value !== previous) void loadReference();
});
watch(
  () => route.query,
  () => {
    if (ready) void loadCourses();
  },
);

function queryFor(page: number) {
  const query: Record<string, string | string[]> = { ...orgQuery.value };
  if (q.value.trim()) query.q = q.value.trim();
  if (status.value.length) query.status = status.value;
  if (kind.value.length) query.kind = kind.value;
  if (source.value.length) query.source_channel = source.value;
  if (page > 1) query.page = String(page);
  return query;
}

function apply() {
  void router.replace({ query: queryFor(1) });
}

function clear() {
  q.value = '';
  status.value = [];
  kind.value = [];
  source.value = [];
  apply();
}

function goToPage(page: number) {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(route.query)) {
    if (typeof value === 'string') query[key] = value;
    else if (Array.isArray(value)) query[key] = value.filter((v): v is string => !!v);
  }
  if (page > 1) query.page = String(page);
  else delete query.page;
  void router.replace({ query });
}

const pages = computed(() =>
  data.value ? Math.max(1, Math.ceil(data.value.total / data.value.page_size)) : 1,
);
const overridesMode = computed(() => reference.value?.form_mode === 'overrides');
/** An older API sends neither `complete` nor `missing_count`: the column is left out. */
const showCompleteness = computed(
  () =>
    data.value?.items.some(
      (c) => typeof c.complete === 'boolean' || typeof c.missing_count === 'number',
    ) ?? false,
);
/** `complete`, else derived from `missing_count`; undefined when the API sends neither. */
const completeOf = (c: AdminCourseListItem): boolean | undefined =>
  typeof c.complete === 'boolean'
    ? c.complete
    : typeof c.missing_count === 'number'
      ? c.missing_count === 0
      : undefined;
/** "n missing" when the API counts the missing fields, else the plain "Incomplete" badge. */
const incompleteLabel = (c: AdminCourseListItem) =>
  typeof c.missing_count === 'number' && c.missing_count > 0
    ? t('admin.completeness.missingBadge', { n: c.missing_count })
    : t('admin.completeness.incomplete');

const statusOptions = computed(() =>
  STATUSES.map((s) => ({ value: s, label: t(`admin.lifecycle.${s}`) })),
);
const sourceOptions = computed(() =>
  SOURCES.map((s) => ({ value: s, label: t(`admin.channel.${s}`) })),
);
const kindOptions = computed(() =>
  (reference.value?.kinds ?? []).map((k) => ({
    value: k.code,
    label: te(`kind.${k.code}`) ? t(`kind.${k.code}`) : adminLabel(k.label, locale.value),
  })),
);
const kindLabel = (code: string) => (te(`kind.${code}`) ? t(`kind.${code}`) : code);
const levelsText = (levels: string[]) =>
  levels.map((l) => (te(`level.${l}`) ? t(`level.${l}`) : l)).join(', ');

function courseLink(course: AdminCourseListItem) {
  return localePath({ path: `/admin/courses/${course.id}`, query: orgQuery.value });
}

function onRowClick(course: AdminCourseListItem, event: MouseEvent) {
  if ((event.target as HTMLElement | null)?.closest('a, button')) return;
  void router.push(courseLink(course));
}
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath({ path: '/admin', query: orgQuery })">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.courses.title') }}</h1>

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
            <AdminMessage v-if="notice">
              <p>{{ notice }}</p>
            </AdminMessage>

            <template v-if="reference">
              <div v-if="overridesMode" class="notice">
                <p>{{ t('admin.courses.overridesModeList') }}</p>
              </div>
              <p v-else class="admin-actions">
                <NuxtLink
                  class="button"
                  :to="localePath({ path: '/admin/courses/new', query: orgQuery })"
                >
                  {{ t('admin.courses.new') }}
                </NuxtLink>
              </p>
            </template>

            <form
              class="admin-filters"
              role="search"
              :aria-label="t('admin.courses.filtersLabel')"
              @submit.prevent="apply"
            >
              <div class="admin-field">
                <label for="courses-q">{{ t('admin.courses.search') }}</label>
                <p id="courses-q-hint" class="admin-hint">
                  {{ t('admin.courses.searchHint') }}
                </p>
                <input
                  id="courses-q"
                  v-model="q"
                  type="search"
                  aria-describedby="courses-q-hint"
                  maxlength="200"
                />
              </div>
              <div class="admin-filters__groups">
                <AdminCheckboxGroup
                  id="courses-status"
                  v-model="status"
                  :legend="t('admin.courses.fields.status')"
                  :options="statusOptions"
                />
                <AdminCheckboxGroup
                  v-if="kindOptions.length"
                  id="courses-kind"
                  v-model="kind"
                  :legend="t('admin.courses.fields.kind')"
                  :options="kindOptions"
                />
                <AdminCheckboxGroup
                  id="courses-source"
                  v-model="source"
                  :legend="t('admin.courses.source')"
                  :options="sourceOptions"
                />
              </div>
              <p class="admin-actions">
                <button type="submit" class="button">
                  {{ t('admin.courses.applyFilters') }}
                </button>
                <button type="button" class="button button--secondary" @click="clear">
                  {{ t('admin.courses.clearFilters') }}
                </button>
              </p>
            </form>

            <p class="visually-hidden" role="status" aria-live="polite">
              {{ announcement }}
            </p>
            <AdminMessage v-if="loading && !data" :focus="false">
              <p>{{ t('admin.courses.loading') }}</p>
            </AdminMessage>
            <AdminProblem v-else-if="failure" :error="failure" />
            <template v-else-if="data">
              <p v-if="!data.items.length">
                {{ t('admin.courses.empty') }}
              </p>
              <template v-else>
                <div
                  class="admin-table-wrap"
                  role="region"
                  aria-labelledby="courses-caption"
                  tabindex="0"
                >
                  <table class="admin-table">
                    <caption id="courses-caption">
                      {{
                        t('admin.courses.caption', {
                          from: (data.page - 1) * data.page_size + 1,
                          to: (data.page - 1) * data.page_size + data.items.length,
                          total: data.total,
                        })
                      }}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{{ t('admin.courses.fields.ext_id') }}</th>
                        <th scope="col">{{ t('admin.courses.fields.title') }}</th>
                        <th scope="col">{{ t('admin.courses.fields.kind') }}</th>
                        <th scope="col">{{ t('admin.courses.fields.status') }}</th>
                        <th scope="col">{{ t('admin.courses.source') }}</th>
                        <th scope="col" class="num">{{ t('admin.courses.ectsShort') }}</th>
                        <th scope="col">{{ t('admin.courses.fields.levels') }}</th>
                        <th scope="col" class="num">{{ t('admin.courses.offeringsCount') }}</th>
                        <th scope="col">{{ t('admin.courses.updated') }}</th>
                        <th scope="col">{{ t('admin.courses.overridesColumn') }}</th>
                        <th v-if="showCompleteness" scope="col">
                          {{ t('admin.completeness.column') }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="course in data.items"
                        :key="course.id"
                        class="admin-table__link-row"
                        @click="onRowClick(course, $event)"
                      >
                        <th scope="row">
                          <NuxtLink :to="courseLink(course)">
                            {{ course.ext_id }}
                          </NuxtLink>
                        </th>
                        <td>{{ course.title ?? t('admin.courses.untitled') }}</td>
                        <td>{{ kindLabel(course.kind) }}</td>
                        <td><AdminLifecycleBadge :status="course.status" /></td>
                        <td>{{ t(`admin.channel.${course.source_channel}`) }}</td>
                        <td class="num">{{ course.ects }}</td>
                        <td>{{ levelsText(course.levels) }}</td>
                        <td class="num">{{ course.offerings_count }}</td>
                        <td>{{ formatAdminDateTime(course.updated_at, locale) }}</td>
                        <td>
                          <span v-if="course.has_overrides" class="admin-badge admin-badge--ok">
                            {{ t('admin.override.badge') }}
                          </span>
                          <span v-else class="visually-hidden">{{ t('admin.no') }}</span>
                        </td>
                        <td v-if="showCompleteness">
                          <template v-if="completeOf(course) === true">
                            <span aria-hidden="true">✓</span>
                            <span class="visually-hidden">{{
                              t('admin.completeness.complete')
                            }}</span>
                          </template>
                          <AdminBadge
                            v-else-if="completeOf(course) === false"
                            tone="warn"
                            :label="incompleteLabel(course)"
                          />
                          <span v-else class="visually-hidden">{{
                            t('admin.completeness.unknown')
                          }}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <nav
                  v-if="pages > 1"
                  class="admin-pager"
                  :aria-label="t('admin.courses.pagination')"
                >
                  <button
                    type="button"
                    class="button button--secondary"
                    :disabled="data.page <= 1"
                    @click="goToPage(data.page - 1)"
                  >
                    {{ t('pagination.previous') }}
                  </button>
                  <span>{{ t('admin.courses.pageOf', { page: data.page, pages }) }}</span>
                  <button
                    type="button"
                    class="button button--secondary"
                    :disabled="data.page >= pages"
                    @click="goToPage(data.page + 1)"
                  >
                    {{ t('pagination.next') }}
                  </button>
                </nav>
              </template>
            </template>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
