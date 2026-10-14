<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// A result message of the admin pages. It is a live region (`status` for
// progress and success, `alert` for failures) and takes keyboard focus when it
// appears, so screen-reader and keyboard users land on the outcome.
const props = withDefaults(defineProps<{ kind?: 'status' | 'alert'; focus?: boolean }>(), {
  kind: 'status',
  focus: true,
});
const root = ref<HTMLElement | null>(null);
onMounted(() => {
  if (props.focus) root.value?.focus();
});
</script>

<template>
  <div
    ref="root"
    class="admin-message"
    :role="props.kind"
    :aria-live="props.kind === 'alert' ? 'assertive' : 'polite'"
    tabindex="-1"
  >
    <slot />
  </div>
</template>
