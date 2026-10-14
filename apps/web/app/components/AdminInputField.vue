<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// One labelled form control (text-like input, textarea or select) with its hint
// and inline error, wired with `aria-describedby` and `aria-invalid`.
const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    as?: 'input' | 'textarea' | 'select';
    type?: string;
    required?: boolean;
    hint?: string;
    error?: string | null;
    disabled?: boolean;
    /** Extra ids for `aria-describedby` (e.g. the source value of an override). */
    describedBy?: string;
    options?: readonly { value: string; label: string }[];
    inputmode?: 'text' | 'decimal' | 'numeric' | 'email' | 'url';
    autocomplete?: string;
    maxlength?: number;
    rows?: number;
    lang?: string;
  }>(),
  {
    as: 'input',
    type: 'text',
    required: false,
    hint: undefined,
    error: null,
    disabled: false,
    describedBy: undefined,
    options: () => [],
    inputmode: undefined,
    autocomplete: 'off',
    maxlength: undefined,
    rows: 4,
    lang: undefined,
  },
);
const model = defineModel<string>({ required: true });
const { t } = useI18n();
const hintId = computed(() => `${props.id}-hint`);
const errorId = computed(() => `${props.id}-error`);
const describedBy = computed(
  () =>
    [props.hint ? hintId.value : '', props.error ? errorId.value : '', props.describedBy ?? '']
      .filter(Boolean)
      .join(' ') || undefined,
);
const common = computed(() => ({
  id: props.id,
  disabled: props.disabled,
  'aria-describedby': describedBy.value,
  'aria-invalid': props.error ? ('true' as const) : undefined,
  'aria-required': props.required ? ('true' as const) : undefined,
  lang: props.lang,
}));
</script>

<template>
  <div class="admin-field" :class="{ 'admin-field--invalid': props.error }">
    <label :for="props.id">
      {{ props.label }}
      <span v-if="props.required" class="admin-required">{{ t('admin.form.required') }}</span>
    </label>
    <p v-if="props.hint" :id="hintId" class="admin-hint">
      {{ props.hint }}
    </p>
    <AdminFieldError :id="errorId" :message="props.error" />
    <select v-if="props.as === 'select'" v-model="model" v-bind="common">
      <option v-for="o in props.options" :key="o.value" :value="o.value">
        {{ o.label }}
      </option>
    </select>
    <textarea
      v-else-if="props.as === 'textarea'"
      v-model="model"
      v-bind="common"
      :rows="props.rows"
      :maxlength="props.maxlength"
    />
    <input
      v-else
      v-model="model"
      v-bind="common"
      :type="props.type"
      :inputmode="props.inputmode"
      :autocomplete="props.autocomplete"
      :maxlength="props.maxlength"
    />
  </div>
</template>
