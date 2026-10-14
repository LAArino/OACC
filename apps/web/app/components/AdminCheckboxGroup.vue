<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// A multi-select made of native checkboxes in a fieldset (keyboard-operable
// without scripting), with an optional hint and inline error.
const props = withDefaults(
  defineProps<{
    id: string;
    legend: string;
    options: readonly { value: string; label: string }[];
    modelValue: readonly string[];
    hint?: string;
    error?: string | null;
    disabled?: boolean;
    describedBy?: string;
    columns?: boolean;
  }>(),
  { hint: undefined, error: null, disabled: false, describedBy: undefined, columns: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
const hintId = computed(() => `${props.id}-hint`);
const errorId = computed(() => `${props.id}-error`);
const describedBy = computed(
  () =>
    [props.hint ? hintId.value : '', props.error ? errorId.value : '', props.describedBy ?? '']
      .filter(Boolean)
      .join(' ') || undefined,
);

function toggle(value: string, checked: boolean) {
  const set = new Set(props.modelValue);
  if (checked) set.add(value);
  else set.delete(value);
  // Keep the options' order.
  emit(
    'update:modelValue',
    props.options.map((o) => o.value).filter((v) => set.has(v)),
  );
}
</script>

<template>
  <fieldset
    :id="props.id"
    class="admin-fieldset"
    :aria-describedby="describedBy"
    :disabled="props.disabled"
  >
    <legend>{{ props.legend }}</legend>
    <p v-if="props.hint" :id="hintId" class="admin-hint">
      {{ props.hint }}
    </p>
    <AdminFieldError :id="errorId" :message="props.error" />
    <ul class="admin-choices" :class="{ 'admin-choices--columns': props.columns }">
      <li v-for="(option, index) in props.options" :key="option.value">
        <input
          :id="`${props.id}-${index}`"
          type="checkbox"
          :value="option.value"
          :checked="props.modelValue.includes(option.value)"
          @change="toggle(option.value, ($event.target as HTMLInputElement).checked)"
        />
        <label :for="`${props.id}-${index}`">{{ option.label }}</label>
      </li>
    </ul>
  </fieldset>
</template>
