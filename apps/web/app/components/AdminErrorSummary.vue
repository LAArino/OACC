<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Error summary of a form (GOV.UK pattern): an alert that takes focus, listing
// each problem as a link to its field. Selecting a link lets the parent switch
// to the step that owns the field before focusing it.
const props = defineProps<{
  heading: string;
  issues: readonly { id: string; message: string }[];
}>();
const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <AdminMessage v-if="props.issues.length" kind="alert" class="admin-error-summary">
    <h2 class="admin-error-summary__heading">
      {{ props.heading }}
    </h2>
    <ul>
      <li v-for="(issue, index) in props.issues" :key="`${issue.id}-${index}`">
        <a :href="`#${issue.id}`" @click.prevent="emit('select', issue.id)">{{ issue.message }}</a>
      </li>
    </ul>
  </AdminMessage>
</template>
