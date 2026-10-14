<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// A field of a harvested record (spec §6.5, §8.1): shows the value harvested
// from the partner's OEAPI and an "Override" toggle that enables the control.
// Unticking a saved override reverts the field to the source value on save.
// Outside overrides mode it renders the control alone.
const props = withDefaults(
  defineProps<{
    /** Overrides mode (harvested record). */
    enabled: boolean;
    /** id of the wrapped control; the toggle and source line derive theirs from it. */
    fieldId: string;
    label: string;
    /** Display text of the source value. */
    source?: string;
    /** The field has a saved override. */
    stored?: boolean;
  }>(),
  { source: '', stored: false },
);
const on = defineModel<boolean>({ default: false });
const { t } = useI18n();
const sourceId = computed(() => `${props.fieldId}-source`);
const toggleId = computed(() => `${props.fieldId}-override`);
</script>

<template>
  <div v-if="props.enabled" class="admin-override" :class="{ 'admin-override--on': on }">
    <slot :disabled="!on" :described-by="sourceId" />
    <p :id="sourceId" class="admin-override__source">
      {{ t('admin.override.source') }}
      <span class="admin-override__value">{{ props.source }}</span>
    </p>
    <div class="admin-override__toggle">
      <input :id="toggleId" v-model="on" type="checkbox" />
      <label :for="toggleId">
        {{ t('admin.override.toggle') }}
        <span class="visually-hidden">{{ props.label }}</span>
      </label>
      <span v-if="on" class="admin-badge admin-badge--ok">{{ t('admin.override.badge') }}</span>
    </div>
    <p v-if="props.stored && !on" class="admin-hint" role="status">
      {{ t('admin.override.revertHint') }}
    </p>
  </div>
  <slot v-else :disabled="false" :described-by="undefined" />
</template>
