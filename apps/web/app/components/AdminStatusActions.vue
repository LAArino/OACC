<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Status actions of a course or offering (`POST …/status`): Publish, Withdraw,
// Cancel and Back to draft, each confirmed in a dialog before `change` is emitted.
import type { AdminLifecycleStatus } from '~/types/admin';

const props = defineProps<{
  status: AdminLifecycleStatus;
  /** What the actions apply to, for the dialog text (e.g. "course TEST-101"). */
  subject: string;
  entity: 'course' | 'offering';
  busy?: boolean;
}>();
const emit = defineEmits<{ change: [status: AdminLifecycleStatus] }>();
const { t } = useI18n();
const confirm = ref<{
  ask: (o: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
} | null>(null);

const ACTIONS: readonly {
  target: AdminLifecycleStatus;
  key: string;
  from: readonly AdminLifecycleStatus[];
  danger?: boolean;
}[] = [
  { target: 'published', key: 'publish', from: ['draft', 'withdrawn', 'cancelled'] },
  { target: 'withdrawn', key: 'withdraw', from: ['published'], danger: true },
  { target: 'cancelled', key: 'cancel', from: ['draft', 'published'], danger: true },
  { target: 'draft', key: 'toDraft', from: ['published', 'withdrawn', 'cancelled'] },
];
const available = computed(() => ACTIONS.filter((a) => a.from.includes(props.status)));

async function run(action: (typeof ACTIONS)[number]) {
  const ok = await confirm.value?.ask({
    title: t(`admin.status.${action.key}.title`),
    message: t(`admin.status.${action.key}.${props.entity}`, { subject: props.subject }),
    confirmLabel: t(`admin.status.${action.key}.button`),
    danger: action.danger ?? false,
  });
  if (ok) emit('change', action.target);
}
</script>

<template>
  <div class="admin-status-actions">
    <p class="admin-actions">
      <span>
        {{ t('admin.status.current') }}
        <AdminLifecycleBadge :status="props.status" />
      </span>
      <button
        v-for="a in available"
        :key="a.key"
        type="button"
        class="button"
        :class="a.danger ? 'button--secondary' : ''"
        :disabled="props.busy"
        @click="run(a)"
      >
        {{ t(`admin.status.${a.key}.button`) }}
      </button>
    </p>
    <AdminConfirm ref="confirm" />
  </div>
</template>
