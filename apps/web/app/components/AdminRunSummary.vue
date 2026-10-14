<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Summary of one sync run (spec §8.1 "Sync monitor"): status, channel, trigger,
// times, duration and counters; for CSV uploads the stored files when the API
// exposes the upload key.
import type { SyncRun } from '@oecp/schemas';
import type { RouteLocationRaw } from 'vue-router';

const props = defineProps<{
  run: SyncRun & { upload_object_key?: string | null };
  /** Link to the run page, when the summary is shown elsewhere. */
  to?: RouteLocationRaw;
}>();
const { t, locale } = useI18n();

const counters = computed(() => [
  { key: 'created', value: props.run.n_created },
  { key: 'updated', value: props.run.n_updated },
  { key: 'unchanged', value: props.run.n_unchanged },
  { key: 'rejected', value: props.run.n_rejected },
  { key: 'withdrawn', value: props.run.n_withdrawn },
]);
/** Files of a CSV upload: `<orgId>/<uploadId>/{courses,offerings}.csv` in upload storage. */
const uploadKey = computed(() =>
  props.run.channel === 'csv' && props.run.upload_object_key ? props.run.upload_object_key : null,
);
</script>

<template>
  <dl class="facts admin-run-summary">
    <dt>{{ t('admin.run.status') }}</dt>
    <dd><AdminStatusBadge :status="props.run.status" /></dd>
    <dt>{{ t('admin.run.channel') }}</dt>
    <dd>{{ t(`admin.channel.${props.run.channel}`) }}</dd>
    <dt>{{ t('admin.run.trigger') }}</dt>
    <dd>{{ t(`admin.trigger.${props.run.trigger_kind}`) }}</dd>
    <dt>{{ t('admin.run.queuedAt') }}</dt>
    <dd>{{ formatAdminDateTime(props.run.created_at, locale) }}</dd>
    <template v-if="props.run.started_at">
      <dt>{{ t('admin.run.startedAt') }}</dt>
      <dd>{{ formatAdminDateTime(props.run.started_at, locale) }}</dd>
    </template>
    <template v-if="props.run.finished_at">
      <dt>{{ t('admin.run.finishedAt') }}</dt>
      <dd>{{ formatAdminDateTime(props.run.finished_at, locale) }}</dd>
    </template>
    <template v-if="props.run.duration_ms !== null">
      <dt>{{ t('admin.run.duration') }}</dt>
      <dd>{{ formatAdminDuration(props.run.duration_ms, locale) }}</dd>
    </template>
    <template v-for="c in counters" :key="c.key">
      <dt>{{ t(`admin.counters.${c.key}`) }}</dt>
      <dd>{{ c.value }}</dd>
    </template>
    <template v-if="uploadKey">
      <dt>{{ t('admin.run.files') }}</dt>
      <dd>
        <code>{{ uploadKey }}</code>
      </dd>
    </template>
    <template v-if="props.run.error_summary">
      <dt>{{ t('admin.run.summary') }}</dt>
      <dd>{{ props.run.error_summary }}</dd>
    </template>
  </dl>
  <p v-if="props.to">
    <NuxtLink :to="props.to">
      {{ t('admin.run.open') }}
    </NuxtLink>
  </p>
</template>
