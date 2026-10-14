<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// A text badge (invitation status, network health, organization state). The
// colour only repeats what the text says (WCAG 1.4.1); tones use the AA-tested
// token pairs of admin.css (`.admin-badge--*`).
const props = defineProps<{ tone: 'ok' | 'bad' | 'warn' | 'neutral'; label: string }>();
</script>

<template>
  <span class="admin-badge" :class="`admin-badge--${props.tone}`">{{ props.label }}</span>
</template>
