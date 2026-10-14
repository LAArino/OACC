<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Language switcher of the course texts. Each tab is a link to the same page
// with `?text_lang=xx`, so it works without JavaScript; once hydrated it follows
// the WAI-ARIA tabs pattern (automatic activation, arrow keys, Home/End).
const props = defineProps<{
  languages: readonly string[];
  active: string;
  /** Accessible name of the tab list. */
  label: string;
  /** id of the tab panel the tabs control. */
  panelId: string;
  /** Route query for a language (the page keeps its other parameters). */
  hrefFor: (lang: string) => string;
}>();
const emit = defineEmits<{ select: [lang: string] }>();
const { locale } = useI18n();

const enhanced = ref(false);
onMounted(() => {
  enhanced.value = true;
});

const tabId = (lang: string) => `text-tab-${lang}`;
const tabs = ref<HTMLElement[]>([]);

function select(lang: string, focus = false) {
  emit('select', lang);
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

function tabAttrs(lang: string) {
  const selected = lang === props.active;
  return enhanced.value
    ? {
        role: 'tab',
        'aria-selected': selected,
        'aria-controls': props.panelId,
        tabindex: selected ? 0 : -1,
      }
    : { 'aria-current': selected ? ('true' as const) : undefined };
}
</script>

<template>
  <div
    class="language-tabs"
    :role="enhanced ? 'tablist' : undefined"
    :aria-label="enhanced ? props.label : undefined"
    :class="{ 'is-enhanced': enhanced }"
  >
    <span v-if="!enhanced" class="language-tabs__label">{{ props.label }}:</span>
    <a
      v-for="(lang, index) in props.languages"
      :id="tabId(lang)"
      :key="lang"
      ref="tabs"
      class="language-tabs__tab"
      :class="{ 'is-active': lang === props.active }"
      :href="props.hrefFor(lang)"
      :hreflang="lang"
      v-bind="tabAttrs(lang)"
      @click.prevent="select(lang)"
      @keydown="onKeydown($event, index)"
    >
      {{ languageName(lang, locale) }}
    </a>
  </div>
</template>

<style scoped>
.language-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.25rem;
  border-bottom: 2px solid var(--c-divider);
  margin: 0.5rem 0 1rem;
}
.language-tabs__label {
  align-self: center;
  margin-right: 0.5rem;
  color: var(--c-muted);
}
.language-tabs__tab {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0.4rem 1rem;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: var(--radius) var(--radius) 0 0;
  text-decoration: none;
  margin-bottom: -2px;
}
.language-tabs__tab:hover {
  background: var(--c-chip);
}
.language-tabs__tab.is-active {
  border-color: var(--c-divider);
  border-bottom: 3px solid var(--c-primary);
  background: var(--c-bg);
  color: var(--c-text);
  font-weight: 700;
}
</style>
