<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Explains a failed admin API call: a translated message for the stable error
// code, then the server's problem title/detail and the code itself (spec §6.6).
const props = defineProps<{
  error: AdminApiError;
  heading?: string;
  /** i18n key replacing the generic message of the error code (context-specific wording). */
  messageKey?: string;
}>();
const { t } = useI18n();
const message = computed(() => t(props.messageKey ?? problemMessageKey(props.error)));
const retryMinutes = computed(() =>
  props.error.retryAfterSeconds === undefined
    ? undefined
    : Math.max(1, Math.ceil(props.error.retryAfterSeconds / 60)),
);
const serverText = computed(() =>
  props.error.detail ? `${props.error.title}: ${props.error.detail}` : props.error.title,
);
</script>

<template>
  <AdminMessage kind="alert">
    <p v-if="props.heading">
      <strong>{{ props.heading }}</strong>
    </p>
    <p>{{ message }}</p>
    <p v-if="retryMinutes !== undefined">
      {{ t('problem.retryAfter', { minutes: retryMinutes }) }}
    </p>
    <p v-if="props.error.fromServer">
      {{ serverText }}
    </p>
    <p v-if="props.error.code">
      {{ t('admin.errorCode', { code: props.error.code }) }}
    </p>
  </AdminMessage>
</template>
