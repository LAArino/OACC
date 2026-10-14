<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Per-language editing of texts (course texts, application instructions): WAI-ARIA
// tabs (buttons, arrow keys, Home/End) over the languages in use, a native select
// to add a language and a button to remove a non-required one. The panel content
// is the default slot, given the active language.
const props = defineProps<{
  id: string;
  label: string;
  languages: readonly string[];
  /** Languages that can be added: tag and display name. */
  available: readonly { tag: string; label: string }[];
  /** Languages that cannot be removed (English). */
  required: readonly string[];
  /** Languages whose fields have errors. */
  invalid?: readonly string[];
  /** Adding and removing languages is disabled (e.g. a record without edit rights). */
  fixed?: boolean;
}>();
const active = defineModel<string>({ required: true });
const emit = defineEmits<{ add: [tag: string]; remove: [tag: string] }>();
const { t } = useI18n();
const tabs = ref<HTMLButtonElement[]>([]);
const addSelect = ref('');
const addId = computed(() => `${props.id}-add`);
const panelId = computed(() => `${props.id}-panel`);
const tabId = (lang: string) => `${props.id}-tab-${lang}`;

const nameOf = (tag: string) => props.available.find((l) => l.tag === tag)?.label ?? tag;
const addable = computed(() => props.available.filter((l) => !props.languages.includes(l.tag)));

function select(lang: string, focus = false) {
  active.value = lang;
  if (focus) {
    const index = props.languages.indexOf(lang);
    void nextTick(() => tabs.value[index]?.focus());
  }
}

function onKeydown(event: KeyboardEvent, index: number) {
  const count = props.languages.length;
  let next: number | undefined;
  if (event.key === 'ArrowRight') next = (index + 1) % count;
  else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = count - 1;
  if (next === undefined) return;
  event.preventDefault();
  const lang = props.languages[next];
  if (lang) select(lang, true);
}

function add() {
  const tag = addSelect.value;
  if (!tag) return;
  emit('add', tag);
  addSelect.value = '';
  void nextTick(() => select(tag, true));
}

function remove(tag: string) {
  emit('remove', tag);
  const first = props.languages.find((l) => l !== tag);
  if (first) select(first, true);
}
</script>

<template>
  <div class="admin-langs">
    <div class="admin-langs__bar">
      <div role="tablist" class="admin-langs__tabs" :aria-label="props.label">
        <button
          v-for="(lang, index) in props.languages"
          :id="tabId(lang)"
          :key="lang"
          ref="tabs"
          type="button"
          role="tab"
          class="admin-langs__tab"
          :aria-selected="lang === active ? 'true' : 'false'"
          :aria-controls="panelId"
          :tabindex="lang === active ? 0 : -1"
          @click="select(lang)"
          @keydown="onKeydown($event, index)"
        >
          {{ nameOf(lang) }}
          <span v-if="props.required.includes(lang)" class="admin-langs__required">
            {{ t('admin.form.requiredMark') }}
          </span>
          <span v-if="props.invalid?.includes(lang)" class="admin-langs__flag">
            {{ t('admin.wizard.hasErrors') }}
          </span>
        </button>
      </div>
      <div v-if="!props.fixed && addable.length" class="admin-langs__add">
        <label :for="addId">{{ t('admin.languages.add') }}</label>
        <select :id="addId" v-model="addSelect">
          <option value="">
            {{ t('admin.languages.choose') }}
          </option>
          <option v-for="l in addable" :key="l.tag" :value="l.tag">
            {{ l.label }}
          </option>
        </select>
        <button type="button" class="button button--secondary" :disabled="!addSelect" @click="add">
          {{ t('admin.languages.addButton') }}
        </button>
      </div>
    </div>
    <div :id="panelId" role="tabpanel" class="admin-langs__panel" :aria-labelledby="tabId(active)">
      <slot :lang="active" />
      <p v-if="!props.fixed && !props.required.includes(active)" class="admin-actions">
        <button type="button" class="button button--secondary" @click="remove(active)">
          {{ t('admin.languages.remove', { language: nameOf(active) }) }}
        </button>
      </p>
    </div>
  </div>
</template>
