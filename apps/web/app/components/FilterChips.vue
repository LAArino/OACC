<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Active filters of the catalogue as removable chips. Each chip is a link to the
// same search without that value, so removal works without JavaScript and every
// state stays a shareable URL.
// The links go to the list path, which the router would mark `aria-current="page"`
// whatever the query: they override it (WCAG 1.3.1, 4.1.2).
import type { ListFilter, SearchState } from '../types/catalogue';
import type { MaybeReference } from '../composables/useCatalogueLabels';

const props = defineProps<{
  state: SearchState;
  reference?: MaybeReference;
  /** Path of the catalogue list in the current locale (e.g. `/en/courses`). */
  listPath: string;
}>();
const emit = defineEmits<{ navigate: [] }>();
const { t } = useI18n();
const labels = useCatalogueLabels(() => props.reference);

interface Chip {
  key: string;
  text: string;
  to: { path: string; query: Record<string, string | string[]> };
}

const GROUP_KEYS: Readonly<Record<ListFilter, string>> = {
  partner: 'filters.partner',
  mode: 'filters.mode',
  lang: 'filters.lang',
  isced: 'filters.isced',
  level: 'filters.level',
  kind: 'filters.kind',
};

function valueLabel(key: ListFilter, value: string): string {
  switch (key) {
    case 'partner':
      return labels.partnerName(value);
    case 'mode':
      return labels.modeLabel(value);
    case 'lang':
      return labels.languageLabel(value);
    case 'isced':
      return labels.iscedLabel(value);
    case 'level':
      return labels.levelLabel(value);
    case 'kind':
      return labels.kindLabel(value);
  }
}

/** Attribute filter keys in schema order (`sort_order`), unknown keys last. */
function attributeKeys(attrs: Record<string, string[]>): string[] {
  const defs = props.reference?.attribute_definitions ?? [];
  const rank = (key: string) =>
    defs.find((d) => d.key === key)?.sort_order ?? Number.POSITIVE_INFINITY;
  return Object.keys(attrs).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** "Name: value" for enum values; booleans (`true`) read as the attribute name alone. */
function attributeChipText(key: string, value: string): string {
  const def = labels.attributeDefinition(key);
  const name = labels.attributeLabel(key);
  if (value === 'true' && (!def || def.value_type === 'boolean')) return name;
  return `${name}: ${labels.attributeValueLabel(key, value)}`;
}

const link = (state: SearchState) => ({ path: props.listPath, query: toRouteQuery(state) });

const chips = computed<Chip[]>(() => {
  const s = props.state;
  const list: Chip[] = [];
  if (s.q) {
    list.push({
      key: 'q',
      text: t('chips.query', { q: s.q }),
      to: link({ ...s, q: '', page: 1 }),
    });
  }
  for (const key of LIST_FILTERS) {
    for (const value of s[key]) {
      list.push({
        key: `${key}:${value}`,
        text: `${t(GROUP_KEYS[key])}: ${valueLabel(key, value)}`,
        to: link(withoutValue(s, key, value)),
      });
    }
  }
  for (const key of attributeKeys(s.attrs)) {
    for (const value of s.attrs[key] ?? []) {
      list.push({
        key: `attr:${key}:${value}`,
        text: attributeChipText(key, value),
        to: link(withoutAttribute(s, key, value)),
      });
    }
  }
  if (s.ectsMin !== null) {
    list.push({
      key: 'ects_min',
      text: t('chips.ectsMin', { n: s.ectsMin }),
      to: link({ ...s, ectsMin: null, page: 1 }),
    });
  }
  if (s.ectsMax !== null) {
    list.push({
      key: 'ects_max',
      text: t('chips.ectsMax', { n: s.ectsMax }),
      to: link({ ...s, ectsMax: null, page: 1 }),
    });
  }
  if (s.includePast) {
    list.push({
      key: 'upcoming',
      text: t('filters.includePast'),
      to: link({ ...s, includePast: false, page: 1 }),
    });
  }
  return list;
});

const clearAll = computed(() => link(withoutFilters({ ...props.state, q: '' })));
</script>

<template>
  <div v-if="chips.length" class="filter-chips">
    <h2 id="active-filters-heading" class="visually-hidden">
      {{ t('chips.heading') }}
    </h2>
    <ul class="filter-chips__list" aria-labelledby="active-filters-heading">
      <li v-for="chip in chips" :key="chip.key">
        <NuxtLink
          class="chip"
          :to="chip.to"
          :aria-label="t('chips.remove', { filter: chip.text })"
          :aria-current="undefined"
          @click="emit('navigate')"
        >
          <span>{{ chip.text }}</span>
          <span class="chip__x" aria-hidden="true">×</span>
        </NuxtLink>
      </li>
      <li v-if="chips.length > 1">
        <NuxtLink
          class="filter-chips__clear"
          :to="clearAll"
          :aria-current="undefined"
          @click="emit('navigate')"
        >
          {{ t('chips.clearAll') }}
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.filter-chips__list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  list-style: none;
  margin: 0.5rem 0 1rem;
  padding: 0;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.25rem;
  padding: 0.25rem 0.5rem 0.25rem 0.8rem;
  border: 1px solid var(--c-chip-text);
  border-radius: 999px;
  background: var(--c-chip);
  color: var(--c-chip-text);
  text-decoration: none;
}
.chip:hover {
  background: #d3e2f2;
  color: var(--c-chip-text);
}
.chip__x {
  font-size: 1.2rem;
  line-height: 1;
}
.filter-chips__clear {
  display: inline-block;
  padding: 0.4rem 0.25rem;
}
</style>
