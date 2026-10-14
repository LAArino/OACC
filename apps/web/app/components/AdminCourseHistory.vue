<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Change history of a course (`GET /api/admin/v1/courses/{id}/history`): audit
// entries (who changed what in the admin) and ingestion history, newest first.
// `version` reloads it after a save.
import type { AdminHistoryItem } from '~/types/admin';

const props = defineProps<{ courseId: string; version?: number }>();
const { t, locale } = useI18n();
const coursesApi = useAdminCoursesApi();
const items = ref<AdminHistoryItem[] | null>(null);
const loading = ref(false);
const failure = ref<AdminApiError | null>(null);
let request = 0;

async function load() {
  const current = ++request;
  loading.value = true;
  failure.value = null;
  try {
    const history = await coursesApi.history(props.courseId, 50);
    if (current === request) items.value = history.items;
  } catch (error) {
    if (current === request) failure.value = asAdminApiError(error);
  } finally {
    if (current === request) loading.value = false;
  }
}

onMounted(load);
watch([() => props.courseId, () => props.version], load);
</script>

<template>
  <section aria-labelledby="course-history-heading" class="admin-card">
    <h2 id="course-history-heading">
      {{ t('admin.history.heading') }}
    </h2>
    <p v-if="loading && !items" role="status">
      {{ t('admin.history.loading') }}
    </p>
    <AdminProblem v-else-if="failure" :error="failure" />
    <template v-else-if="items">
      <p v-if="!items.length">
        {{ t('admin.history.empty') }}
      </p>
      <div
        v-else
        class="admin-table-wrap"
        role="region"
        aria-labelledby="course-history-caption"
        tabindex="0"
      >
        <table class="admin-table">
          <caption id="course-history-caption">
            {{
              t('admin.history.caption', { n: items.length }, items.length)
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('admin.history.at') }}</th>
              <th scope="col">{{ t('admin.history.actor') }}</th>
              <th scope="col">{{ t('admin.history.kind') }}</th>
              <th scope="col">{{ t('admin.history.action') }}</th>
              <th scope="col">{{ t('admin.history.summary') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in items" :key="index">
              <td>{{ formatAdminDateTime(item.at, locale) }}</td>
              <td>{{ item.actor }}</td>
              <td>{{ t(`admin.history.kinds.${item.kind}`) }}</td>
              <td>
                <code>{{ item.action }}</code>
              </td>
              <td>{{ item.summary }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
