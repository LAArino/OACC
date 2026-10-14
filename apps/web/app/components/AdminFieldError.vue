<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Inline error of one form field. The control references `id` with
// `aria-describedby` and sets `aria-invalid`; the "Error:" prefix makes the
// message distinguishable without colour (WCAG 1.4.1, 3.3.1).
const props = defineProps<{ id: string; message?: string | null }>();
const { t } = useI18n();
</script>

<template>
  <p v-if="props.message" :id="props.id" class="admin-field-error">
    <span class="visually-hidden">{{ t('admin.form.errorPrefix') }}</span>
    {{ props.message }}
  </p>
</template>
