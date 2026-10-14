<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Confirmation dialog for irreversible or publishing actions: a native modal
// `<dialog>` (focus kept inside, Escape cancels) opened with `ask()`, which
// resolves to the choice. Focus returns to the element that opened it.
interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

const { t } = useI18n();
const dialog = ref<HTMLDialogElement | null>(null);
const options = ref<ConfirmOptions | null>(null);
const titleId = useId();
const messageId = useId();
const cancelButton = ref<HTMLButtonElement | null>(null);
let resolver: ((value: boolean) => void) | undefined;
let opener: HTMLElement | null = null;

async function ask(value: ConfirmOptions): Promise<boolean> {
  resolver?.(false);
  options.value = value;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  const element = dialog.value;
  if (element) {
    if (typeof element.showModal === 'function') {
      try {
        element.showModal();
      } catch {
        element.setAttribute('open', '');
      }
    } else {
      element.setAttribute('open', '');
    }
  }
  // The safe choice gets focus.
  cancelButton.value?.focus();
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
}

function finish(result: boolean) {
  const element = dialog.value;
  if (element?.open) {
    if (typeof element.close === 'function') element.close();
    else element.removeAttribute('open');
  }
  const resolve = resolver;
  resolver = undefined;
  options.value = null;
  opener?.focus();
  opener = null;
  resolve?.(result);
}

defineExpose({ ask });
</script>

<template>
  <dialog
    ref="dialog"
    class="admin-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="messageId"
    @cancel.prevent="finish(false)"
  >
    <template v-if="options">
      <h2 :id="titleId">
        {{ options.title }}
      </h2>
      <p :id="messageId">
        {{ options.message }}
      </p>
      <div class="admin-actions">
        <button
          type="button"
          class="button"
          :class="{ 'button--danger': options.danger }"
          data-confirm="yes"
          @click="finish(true)"
        >
          {{ options.confirmLabel }}
        </button>
        <button
          ref="cancelButton"
          type="button"
          class="button button--secondary"
          data-confirm="no"
          @click="finish(false)"
        >
          {{ t('admin.confirm.cancel') }}
        </button>
      </div>
    </template>
  </dialog>
</template>
