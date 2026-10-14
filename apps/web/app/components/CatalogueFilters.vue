<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Filter panel of the catalogue. Every control is a real form control owned by
// the catalogue GET form (`form` attribute), so filtering works without
// JavaScript; when enhanced, checkbox and toggle changes apply at once and the
// "Apply" button remains for the ECTS range.
import type { FacetValue, Label, ListFilter, SearchFacets, SearchState } from '../types/catalogue';
import type { MaybeReference } from '../composables/useCatalogueLabels';

const props = defineProps<{
  state: SearchState;
  facets: SearchFacets | null | undefined;
  reference?: MaybeReference;
  /** id of the catalogue `<form>` the controls belong to. */
  formId: string;
}>();
const emit = defineEmits<{ apply: [] }>();
const { t } = useI18n();
const labels = useCatalogueLabels(() => props.reference);

const GROUPS: readonly { key: ListFilter; legend: string }[] = [
  { key: 'partner', legend: 'filters.partner' },
  { key: 'mode', legend: 'filters.mode' },
  { key: 'lang', legend: 'filters.lang' },
  { key: 'isced', legend: 'filters.isced' },
  { key: 'level', legend: 'filters.level' },
];

/** Facet values from the response; without facets, the reference lists (no counts). */
function facetFor(key: ListFilter): FacetValue[] | undefined {
  const fromFacets = props.facets?.[key];
  if (fromFacets?.length || props.facets) return fromFacets;
  const ref = props.reference;
  if (!ref) return undefined;
  const noCount = (value: string, label?: Label) =>
    ({ value, label, count: undefined }) as unknown as FacetValue;
  switch (key) {
    case 'partner':
      return ref.organizations.filter((o) => o.is_partner).map((o) => noCount(o.slug, o.name));
    case 'mode':
      return ref.delivery_modes.map((m) => noCount(m.code, m.label));
    case 'lang':
      return ref.teaching_languages.map((l) => noCount(l));
    case 'isced':
      return ref.isced_broad_fields.map((f) => noCount(f.code, f.label));
    case 'level':
      return ref.levels.map((l) => noCount(l));
  }
}

function labelFor(key: ListFilter, value: string, label: Label | undefined): string {
  switch (key) {
    case 'partner':
      return labels.partnerName(value, label);
    case 'mode':
      return labels.modeLabel(value, label);
    case 'lang':
      return labels.languageLabel(value, label);
    case 'isced':
      return labels.iscedLabel(value, label);
    case 'level':
      return labels.levelLabel(value, label);
  }
}

const groups = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    options: facetOptions(facetFor(g.key), props.state[g.key], (value, label) =>
      labelFor(g.key, value, label),
    ),
  })).filter((g) => g.options.length > 0),
);

const activeCount = computed(() => activeFilterCount(props.state));

// The panel is a disclosure on narrow screens. It is server-rendered open (so it
// works without JavaScript) and collapsed after hydration on small screens.
const open = ref(true);
const enhanced = ref(false);
let narrow: MediaQueryList | undefined;
const onWidthChange = () => {
  // The disclosure toggle is hidden on wide screens: never leave it closed there.
  if (narrow && !narrow.matches) open.value = true;
};
onMounted(() => {
  enhanced.value = true;
  narrow = window.matchMedia?.('(max-width: 55.99rem)');
  if (narrow?.matches) open.value = false;
  narrow?.addEventListener?.('change', onWidthChange);
});
onBeforeUnmount(() => narrow?.removeEventListener?.('change', onWidthChange));
function onToggle(event: Event) {
  open.value = (event.target as HTMLDetailsElement).open;
}

function onChange(event: Event) {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (!enhanced.value) return;
  if (target instanceof HTMLInputElement && target.type !== 'checkbox') return;
  emit('apply');
}

const optionId = (key: string, value: string) =>
  `filter-${key}-${value.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
</script>

<template>
  <section class="filters" aria-labelledby="filters-heading">
    <h2 id="filters-heading" class="filters__heading">
      {{ t('filters.heading') }}
      <span v-if="activeCount" class="filters__count">
        {{ t('filters.activeCount', { n: activeCount }, activeCount) }}
      </span>
    </h2>
    <details class="filters__disclosure" :open="open" @toggle="onToggle">
      <summary class="filters__summary">
        {{ open ? t('filters.hide') : t('filters.show') }}
      </summary>
      <div class="filters__body" @change="onChange">
        <fieldset v-for="group in groups" :key="group.key" class="filters__group">
          <legend>{{ t(group.legend) }}</legend>
          <ul>
            <li v-for="option in group.options" :key="option.value">
              <input
                :id="optionId(group.key, option.value)"
                type="checkbox"
                :name="group.key"
                :value="option.value"
                :checked="option.checked"
                :form="props.formId"
              />
              <label :for="optionId(group.key, option.value)">
                {{ option.label }}
                <template v-if="option.count !== null">
                  <span class="filters__n" aria-hidden="true">({{ option.count }})</span>
                  <span
                    class="visually-hidden"
                    v-text="`, ${t('filters.courseCount', { n: option.count }, option.count)}`"
                  />
                </template>
              </label>
            </li>
          </ul>
        </fieldset>

        <fieldset class="filters__group">
          <legend>{{ t('filters.ects') }}</legend>
          <div class="filters__range">
            <div>
              <label for="filter-ects-min">{{ t('filters.ectsMin') }}</label>
              <input
                id="filter-ects-min"
                type="number"
                name="ects_min"
                inputmode="decimal"
                min="0.5"
                :max="ECTS_MAX"
                step="0.5"
                :value="props.state.ectsMin ?? ''"
                :form="props.formId"
              />
            </div>
            <div>
              <label for="filter-ects-max">{{ t('filters.ectsMax') }}</label>
              <input
                id="filter-ects-max"
                type="number"
                name="ects_max"
                inputmode="decimal"
                min="0.5"
                :max="ECTS_MAX"
                step="0.5"
                :value="props.state.ectsMax ?? ''"
                :form="props.formId"
              />
            </div>
          </div>
        </fieldset>

        <div class="filters__toggle">
          <input
            id="filter-include-past"
            type="checkbox"
            name="upcoming"
            value="false"
            :checked="props.state.includePast"
            :form="props.formId"
            aria-describedby="filter-include-past-hint"
          />
          <label for="filter-include-past">{{ t('filters.includePast') }}</label>
          <p id="filter-include-past-hint" class="filters__hint">
            {{ t('filters.includePastHint') }}
          </p>
        </div>

        <button type="submit" class="button" :form="props.formId">
          {{ t('filters.apply') }}
        </button>
      </div>
    </details>
  </section>
</template>

<style scoped>
.filters__heading {
  font-size: 1.2rem;
  margin: 0 0 0.5rem;
}
.filters__count {
  font-size: 0.95rem;
  font-weight: 400;
  color: var(--c-muted);
}
.filters__summary {
  cursor: pointer;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  font-weight: 600;
  min-height: 2.75rem;
}
.filters__body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.75rem;
}
.filters__group {
  border: 0;
  border-top: 1px solid var(--c-divider);
  margin: 0;
  padding: 0.75rem 0 0;
  min-width: 0;
}
.filters__group legend {
  font-weight: 700;
  padding: 0;
  float: left;
  width: 100%;
  margin-bottom: 0.4rem;
}
.filters__group ul {
  clear: both;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.filters__group li,
.filters__toggle {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.filters__group li label,
.filters__toggle label {
  flex: 1 1 0;
  min-width: 0;
  padding: 0.1rem 0;
  cursor: pointer;
}
.filters__group li input,
.filters__toggle input {
  margin-top: 0.2rem;
}
.filters__n {
  color: var(--c-muted);
}
.filters__range {
  clear: both;
  display: flex;
  gap: 0.75rem;
}
.filters__range > div {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1 1 0;
  min-width: 0;
}
.filters__range input {
  width: 100%;
}
.filters__hint {
  flex-basis: 100%;
  margin: 0 0 0 1.75rem;
  font-size: 0.9rem;
  color: var(--c-muted);
}
@media (min-width: 56rem) {
  .filters__summary {
    display: none;
  }
  .filters__body {
    padding-top: 0;
  }
}
</style>
