<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Row/column findings of a CSV upload or sync run (spec §6.6, §8.1): browser
// validation report, the server's 422 `errors[]` and stored run errors share it.
// Filtering by severity is local by default; with `local-filter=false` the parent
// filters on the server (paginated run errors) through `v-model:severity`.
import type { AdminIssue, IssueSeverityFilter } from '~/utils/csvConsole';

const props = withDefaults(
  defineProps<{
    issues: readonly AdminIssue[];
    caption: string;
    severity?: IssueSeverityFilter;
    localFilter?: boolean;
    /** Matching issues on the server when only a page is shown. */
    total?: number;
    /** File name of the downloadable CSV report; no download button when absent. */
    downloadName?: string;
  }>(),
  { severity: 'all', localFilter: true, total: undefined, downloadName: undefined },
);
const emit = defineEmits<{ 'update:severity': [value: IssueSeverityFilter] }>();
const { t } = useI18n();
const filterId = useId();
const captionId = useId();
const selected = ref<IssueSeverityFilter>(props.severity);
watch(
  () => props.severity,
  (value) => {
    selected.value = value;
  },
);

const shown = computed(() =>
  props.localFilter && selected.value !== 'all'
    ? props.issues.filter((i) => i.severity === selected.value)
    : props.issues,
);
const total = computed(
  () => props.total ?? (props.localFilter ? props.issues.length : shown.value.length),
);

function onFilter(event: Event) {
  const value = (event.target as HTMLSelectElement).value as IssueSeverityFilter;
  selected.value = value;
  emit('update:severity', value);
}

function download() {
  if (!props.downloadName) return;
  saveBlob(
    new Blob([adminIssuesReport(props.issues)], { type: 'text/csv;charset=utf-8' }),
    props.downloadName,
  );
}
</script>

<template>
  <div class="admin-issues">
    <div class="admin-issues__tools">
      <div>
        <label :for="filterId">{{ t('admin.issues.filter') }}</label>
        <select :id="filterId" :value="selected" @change="onFilter">
          <option value="all">
            {{ t('admin.issues.all') }}
          </option>
          <option value="error">
            {{ t('admin.issues.errors') }}
          </option>
          <option value="warning">
            {{ t('admin.issues.warnings') }}
          </option>
        </select>
      </div>
      <button
        v-if="props.downloadName && props.issues.length"
        type="button"
        class="button button--secondary"
        @click="download"
      >
        {{ t('admin.issues.download') }}
      </button>
    </div>
    <p class="admin-issues__count" role="status">
      {{ t('admin.issues.showing', { shown: shown.length, total }) }}
    </p>
    <p v-if="!shown.length">
      {{ t('admin.issues.none') }}
    </p>
    <div v-else class="admin-table-wrap" role="region" :aria-labelledby="captionId" tabindex="0">
      <table class="admin-table">
        <caption :id="captionId">
          {{
            props.caption
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              {{ t('admin.issues.severity') }}
            </th>
            <th scope="col">
              {{ t('admin.issues.file') }}
            </th>
            <th scope="col">
              {{ t('admin.issues.row') }}
            </th>
            <th scope="col">
              {{ t('admin.issues.column') }}
            </th>
            <th scope="col">
              {{ t('admin.issues.code') }}
            </th>
            <th scope="col">
              {{ t('admin.issues.message') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(issue, index) in shown" :key="index">
            <td>
              <span class="admin-severity" :class="`admin-severity--${issue.severity}`">
                {{ t(`admin.issues.severityLabel.${issue.severity}`) }}
              </span>
            </td>
            <td>{{ issue.file ? `${issue.file}.csv` : '' }}</td>
            <td>{{ issue.row ?? '' }}</td>
            <td>
              <code v-if="issue.column">{{ issue.column }}</code>
            </td>
            <td>
              <code>{{ issue.code }}</code>
            </td>
            <td>{{ issue.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.admin-issues__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}
.admin-issues__tools label {
  display: block;
  font-weight: 600;
}
.admin-issues__count {
  color: var(--c-muted);
}
.admin-severity {
  font-weight: 600;
  padding: 0 0.4rem;
  border-radius: var(--radius);
}
.admin-severity--error {
  background: var(--c-danger-bg);
  color: var(--c-danger);
}
.admin-severity--warning {
  background: var(--c-notice-bg);
  color: var(--c-text);
}
</style>
