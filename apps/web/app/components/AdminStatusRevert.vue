<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// The status override of a harvested course or offering (spec §8.3: in
// overrides mode a status action stores a `status` override): shows the
// partner's status and offers to revert to it, confirmed in a dialog before
// `revert` is emitted (the page sends `PATCH …/overrides {clear: ["status"]}`).
import type { AdminLifecycleStatus } from '~/types/admin';

const props = defineProps<{
  /** Effective (overridden) status. */
  status: AdminLifecycleStatus;
  /** The partner's status (`source_values.status`), null when unknown. */
  source: string | null;
  /** What the action applies to, for the dialog text (e.g. "course TEST-101"). */
  subject: string;
  busy?: boolean;
}>();
const emit = defineEmits<{ revert: [] }>();
const { t, te } = useI18n();
const headingId = useId();
const confirm = ref<{
  ask: (o: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
} | null>(null);

const statusLabel = (status: string | null) =>
  status === null
    ? t('admin.status.revert.unknownSource')
    : te(`admin.lifecycle.${status}`)
      ? t(`admin.lifecycle.${status}`)
      : status;

async function revert() {
  const ok = await confirm.value?.ask({
    title: t('admin.status.revert.title'),
    message: t('admin.status.revert.message', {
      subject: props.subject,
      source: statusLabel(props.source),
    }),
    confirmLabel: t('admin.status.revert.confirm'),
  });
  if (ok) emit('revert');
}
</script>

<template>
  <div class="admin-status-revert" role="group" :aria-labelledby="headingId">
    <h3 :id="headingId">{{ t('admin.status.revert.heading') }}</h3>
    <p>
      {{
        t('admin.status.revert.text', {
          status: statusLabel(props.status),
          source: statusLabel(props.source),
        })
      }}
    </p>
    <p class="admin-actions">
      <button type="button" class="button button--secondary" :disabled="props.busy" @click="revert">
        {{ t('admin.status.revert.button') }}
      </button>
    </p>
    <AdminConfirm ref="confirm" />
  </div>
</template>
