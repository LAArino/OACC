<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Publication status of a course or offering (DDL `lifecycle_status`) as a text
// badge; the colour only repeats the text (WCAG 1.4.1).
import type { AdminLifecycleStatus } from '~/types/admin';

const props = defineProps<{ status: AdminLifecycleStatus }>();
const { t } = useI18n();
const tone = computed(() => {
  switch (props.status) {
    case 'published':
      return 'ok';
    case 'cancelled':
      return 'bad';
    case 'withdrawn':
      return 'warn';
    default:
      return 'neutral';
  }
});
</script>

<template>
  <span class="admin-badge" :class="`admin-badge--${tone}`">
    {{ t(`admin.lifecycle.${props.status}`) }}
  </span>
</template>
