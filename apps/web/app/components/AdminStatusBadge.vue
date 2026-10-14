<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Status of a sync run (DDL `sync_run_status`) as a text badge; the colour only
// repeats what the text says (WCAG 1.4.1), using AA-tested token pairs.
import type { SyncRunStatus } from '@oecp/schemas';

const props = defineProps<{ status: SyncRunStatus }>();
const { t } = useI18n();
const tone = computed(() => {
  switch (props.status) {
    case 'succeeded':
      return 'ok';
    case 'failed':
      return 'bad';
    case 'partial':
    case 'cancelled':
      return 'warn';
    default:
      return 'neutral';
  }
});
</script>

<template>
  <span class="admin-badge" :class="`admin-badge--${tone}`">
    {{ t(`admin.runStatus.${props.status}`) }}
  </span>
</template>

<style scoped>
.admin-badge {
  display: inline-block;
  padding: 0.05rem 0.6rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
}
.admin-badge--ok {
  background: var(--c-chip);
  color: var(--c-chip-text);
}
.admin-badge--bad {
  background: var(--c-danger-bg);
  color: var(--c-danger);
}
.admin-badge--warn {
  background: var(--c-notice-bg);
  color: var(--c-text);
}
.admin-badge--neutral {
  background: var(--c-surface);
  color: var(--c-text);
}
</style>
