<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Search field with title suggestions (WAI-ARIA APG "combobox with listbox
// popup", list autocomplete). Without JavaScript it is a plain search input of
// the surrounding GET form. Suggestions are fetched debounced (≥ 2 characters),
// stale requests are aborted, and nothing is stored.
import type { SuggestItem } from '../types/catalogue';

const props = withDefaults(
  defineProps<{
    /** Input id; the listbox and options derive their ids from it. */
    id?: string;
    name?: string;
    label: string;
    /** Visually hide the label (it stays the accessible name). */
    hideLabel?: boolean;
    initialValue?: string;
    /** Display name of a partner slug for the suggestion's second line. */
    partnerName?: (slug: string) => string;
    debounceMs?: number;
  }>(),
  {
    id: 'q',
    name: 'q',
    hideLabel: false,
    initialValue: '',
    partnerName: undefined,
    debounceMs: 250,
  },
);

const { t, locale } = useI18n();
const localePath = useLocalePath();
const api = useCatalogueApi();

const value = ref(props.initialValue);
watch(
  () => props.initialValue,
  (v) => {
    value.value = v;
  },
);
const items = ref<SuggestItem[]>([]);
const open = ref(false);
const active = ref(-1);
const status = ref('');
// ARIA combobox attributes are added once hydrated: without JS there is no popup.
const enhanced = ref(false);
onMounted(() => {
  enhanced.value = true;
});

const listboxId = computed(() => `${props.id}-listbox`);
const optionId = (index: number) => `${props.id}-option-${index}`;
const activeId = computed(() =>
  open.value && active.value >= 0 ? optionId(active.value) : undefined,
);

let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
onBeforeUnmount(() => {
  clearTimeout(timer);
  controller?.abort();
});

function close() {
  open.value = false;
  active.value = -1;
}

function reset() {
  clearTimeout(timer);
  controller?.abort();
  items.value = [];
  status.value = '';
  close();
}

async function fetchSuggestions(q: string) {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  try {
    const result = await api.suggest(q, current.signal);
    if (current.signal.aborted || value.value.trim() !== q) return;
    items.value = result.slice(0, 8);
    active.value = -1;
    open.value = items.value.length > 0;
    status.value = items.value.length
      ? t('search.suggestions', { n: items.value.length }, items.value.length)
      : '';
  } catch {
    // Suggestions are optional: a failure only hides the popup.
    if (!current.signal.aborted) reset();
  }
}

function onInput() {
  clearTimeout(timer);
  const q = value.value.trim();
  if (q.length < 2) {
    reset();
    return;
  }
  timer = setTimeout(() => fetchSuggestions(q), props.debounceMs);
}

function choose(item: SuggestItem) {
  reset();
  return navigateTo(localePath(`/courses/${encodeURIComponent(item.id)}`));
}

function onKeydown(event: KeyboardEvent) {
  const count = items.value.length;
  switch (event.key) {
    case 'ArrowDown':
      if (!count) return;
      event.preventDefault();
      if (!open.value) {
        open.value = true;
        active.value = 0;
      } else {
        active.value = (active.value + 1) % count;
      }
      break;
    case 'ArrowUp':
      if (!count) return;
      event.preventDefault();
      if (!open.value) {
        open.value = true;
        active.value = count - 1;
      } else {
        active.value = active.value <= 0 ? count - 1 : active.value - 1;
      }
      break;
    case 'Enter': {
      const item = open.value ? items.value[active.value] : undefined;
      if (item) {
        event.preventDefault();
        void choose(item);
      } else {
        close();
      }
      break;
    }
    case 'Escape':
      if (open.value) {
        event.preventDefault();
        close();
      } else if (value.value) {
        event.preventDefault();
        value.value = '';
        reset();
      }
      break;
    case 'Tab':
      close();
      break;
  }
}

const suggestionTitle = (item: SuggestItem) =>
  labelText(item.title, locale.value) ?? t('search.untitled');
const suggestionPartner = (item: SuggestItem) =>
  props.partnerName ? props.partnerName(item.organization_slug) : item.organization_slug;

const comboboxAttrs = computed(() =>
  enhanced.value
    ? {
        role: 'combobox',
        'aria-autocomplete': 'list' as const,
        'aria-expanded': open.value,
        'aria-controls': listboxId.value,
        'aria-activedescendant': activeId.value,
      }
    : {},
);
</script>

<template>
  <div class="search-box">
    <label :for="props.id" :class="{ 'visually-hidden': props.hideLabel }">
      {{ props.label }}
    </label>
    <div class="search-box__field">
      <input
        :id="props.id"
        v-model="value"
        :name="props.name"
        type="search"
        autocomplete="off"
        spellcheck="false"
        maxlength="200"
        v-bind="comboboxAttrs"
        @input="onInput"
        @keydown="onKeydown"
        @blur="close"
      />
      <ul
        v-if="enhanced"
        v-show="open"
        :id="listboxId"
        class="search-box__listbox"
        role="listbox"
        :aria-label="t('search.suggestionsLabel')"
      >
        <li
          v-for="(item, index) in items"
          :id="optionId(index)"
          :key="item.id"
          role="option"
          class="search-box__option"
          :class="{ 'is-active': index === active }"
          :aria-selected="index === active ? 'true' : 'false'"
          @mousedown.prevent
          @click="choose(item)"
        >
          <span
            class="search-box__title"
            :lang="item.lang && item.lang !== locale ? item.lang : undefined"
            >{{ suggestionTitle(item) }}</span
          >
          <span class="search-box__partner">{{ suggestionPartner(item) }}</span>
        </li>
      </ul>
    </div>
    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {{ status }}
    </div>
  </div>
</template>

<style scoped>
.search-box {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1 1 16rem;
  min-width: 0;
}
.search-box label {
  font-weight: 600;
}
.search-box__field {
  position: relative;
}
.search-box__field input {
  width: 100%;
}
.search-box__listbox {
  position: absolute;
  z-index: 10;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  max-height: 22rem;
  overflow-y: auto;
}
.search-box__option {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
}
.search-box__option:hover,
.search-box__option.is-active {
  background: var(--c-chip);
}
.search-box__option.is-active {
  outline: 2px solid var(--c-focus);
  outline-offset: -2px;
}
.search-box__partner {
  font-size: 0.9rem;
  color: var(--c-muted);
}
</style>
