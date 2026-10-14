<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// File drop zone of the CSV console (spec §8.1). Drag and drop is an extra: the
// zone is a keyboard-operable button (Enter/Space open the file chooser) and a
// visible, labelled native file input is always available as the fallback.
const props = withDefaults(
  defineProps<{
    hint: string;
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
  }>(),
  { accept: '.csv,text/csv', multiple: true, disabled: false },
);
const emit = defineEmits<{ select: [files: File[]] }>();
const { t } = useI18n();
const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const hintId = useId();
const inputId = useId();

function open() {
  if (!props.disabled) input.value?.click();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    open();
  }
}

function onDragOver(event: DragEvent) {
  if (props.disabled) return;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dragging.value = true;
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  if (props.disabled) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) emit('select', files);
}

function onChange() {
  const element = input.value;
  if (!element) return;
  const files = Array.from(element.files ?? []);
  // Cleared so that choosing the same file again (after a fix) fires `change`.
  element.value = '';
  if (files.length) emit('select', files);
}
</script>

<template>
  <div class="admin-dropzone">
    <div
      class="admin-dropzone__target"
      :class="{ 'admin-dropzone__target--active': dragging }"
      role="button"
      :tabindex="props.disabled ? -1 : 0"
      :aria-disabled="props.disabled ? 'true' : undefined"
      :aria-describedby="hintId"
      @click="open"
      @keydown="onKeydown"
      @dragenter.prevent="onDragOver"
      @dragover.prevent="onDragOver"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      {{ t('admin.dropZone.target') }}
    </div>
    <p :id="hintId" class="admin-dropzone__hint">
      {{ props.hint }}
    </p>
    <div class="admin-field">
      <label :for="inputId">{{ t('admin.dropZone.input') }}</label>
      <input
        :id="inputId"
        ref="input"
        type="file"
        :accept="props.accept"
        :multiple="props.multiple"
        :disabled="props.disabled"
        @change="onChange"
      />
    </div>
  </div>
</template>

<style scoped>
.admin-dropzone__target {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 7rem;
  padding: 1rem;
  border: 2px dashed var(--c-border);
  border-radius: var(--radius);
  background: var(--c-bg);
  color: var(--c-text);
  font-weight: 600;
  text-align: center;
  cursor: pointer;
}
.admin-dropzone__target:hover,
.admin-dropzone__target--active {
  border-color: var(--c-primary);
  border-style: solid;
  background: var(--c-chip);
}
.admin-dropzone__target[aria-disabled='true'] {
  cursor: not-allowed;
  color: var(--c-muted);
  background: var(--c-surface);
}
.admin-dropzone__hint {
  color: var(--c-muted);
}
</style>
