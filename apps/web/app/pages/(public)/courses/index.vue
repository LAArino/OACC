<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Catalogue search (spec §7). The whole search lives in the URL: the page is a
// GET form that works without JavaScript, results are server-rendered, and
// pagination and filter chips are plain links. With JavaScript, filter changes
// apply in place and the new result count is announced.
import type { SortOrder } from '~/types/catalogue';

const FORM_ID = 'catalogue-form';

const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();
const router = useRouter();
const api = useCatalogueApi();

const listPath = computed(() => localePath('/courses'));

const { data: reference } = await useCatalogueReference();
const labels = useCatalogueLabels(() => reference.value);

// Attribute filters the alliance schema does not offer are dropped before they
// reach the API (the URL is user input).
const state = computed(() =>
  restrictAttributes(parseSearchState(route.query), reference.value?.attribute_definitions),
);
const apiKey = computed(() => queryString(toApiQuery(state.value)));

const { data, error, status } = await useAsyncData(
  'catalogue-search',
  () => api.search(state.value),
  { watch: [apiKey] },
);

// First render without results: answer with an error page (503 while the
// catalogue API is unavailable). Later failures keep the page and show a notice.
if (error.value && !data.value) {
  const statusCode = catalogueErrorStatus(error.value);
  throw createError({
    statusCode,
    statusMessage: statusCode === 404 ? 'Not Found' : 'Service Unavailable',
    fatal: true,
  });
}

const total = computed(() => data.value?.total ?? 0);
const pageSize = computed(() => data.value?.page_size ?? 20);
const firstShown = computed(() => (state.value.page - 1) * pageSize.value + 1);
const lastShown = computed(() =>
  Math.min(total.value, firstShown.value + (data.value?.items.length ?? 0) - 1),
);
const loading = computed(() => status.value === 'pending');

const SORTS: readonly SortOrder[] = ['relevance', 'title', 'start_date', 'deadline'];

const title = computed(() => {
  const base = state.value.q ? t('courses.titleFor', { q: state.value.q }) : t('courses.title');
  return state.value.page > 1
    ? t('courses.titlePage', { title: base, page: state.value.page })
    : base;
});
const { previewMeta } = useHeroImage('courses');
useHead({
  title,
  meta: () => [{ name: 'description', content: t('courses.metaDescription') }, ...previewMeta()],
});

// --- Progressive enhancement ----------------------------------------------
const enhanced = ref(false);
onMounted(() => {
  enhanced.value = true;
});

const resultsHeading = ref<HTMLElement | null>(null);
const announcement = ref('');
/** Set by links that replace the focused element (chips, pages): focus the results after load. */
let focusResults = false;

function onNavigateLink() {
  focusResults = true;
}

watch(status, (now) => {
  if (!import.meta.client || !enhanced.value) return;
  if (now === 'success') {
    announcement.value = t('courses.resultCount', { n: total.value }, total.value);
  } else if (now === 'error') {
    announcement.value = t('courses.errorRefresh');
  } else {
    return;
  }
  if (focusResults) {
    focusResults = false;
    void nextTick(() => {
      resultsHeading.value?.focus();
      resultsHeading.value?.scrollIntoView({ block: 'start' });
    });
  }
});

function apply() {
  const form = document.getElementById(FORM_ID);
  if (!(form instanceof HTMLFormElement)) return;
  const next = stateFromFormData(new FormData(form));
  announcement.value = '';
  return router.push({ path: listPath.value, query: toRouteQuery(next) });
}

const retry = () => refreshNuxtData('catalogue-search');
</script>

<template>
  <div class="catalogue">
    <BrandingBanner variant="courses" />
    <h1>{{ t('courses.title') }}</h1>

    <form
      :id="FORM_ID"
      class="catalogue__search"
      role="search"
      method="get"
      :action="listPath"
      @submit.prevent="apply"
    >
      <CourseSearchBox
        id="q"
        :label="t('search.label')"
        :initial-value="state.q"
        :partner-name="(slug: string) => labels.partnerName(slug)"
      />
      <button type="submit" class="button">
        {{ t('search.submit') }}
      </button>
    </form>

    <div class="catalogue__layout">
      <CatalogueFilters
        class="catalogue__filters"
        :state="state"
        :facets="data?.facets"
        :reference="reference"
        :form-id="FORM_ID"
        @apply="apply"
      />

      <section
        class="catalogue__results"
        aria-labelledby="results-heading"
        :aria-busy="loading ? 'true' : 'false'"
      >
        <div class="catalogue__bar">
          <h2 id="results-heading" ref="resultsHeading" tabindex="-1">
            {{ t('courses.resultCount', { n: total }, total) }}
            <span v-if="total > 0 && data?.items.length" class="catalogue__range">
              {{ t('courses.showing', { from: firstShown, to: lastShown, total }) }}
            </span>
          </h2>
          <div class="catalogue__sort">
            <label for="sort">{{ t('sort.label') }}</label>
            <select id="sort" name="sort" :form="FORM_ID" @change="enhanced && apply()">
              <option
                v-for="sort in SORTS"
                :key="sort"
                :value="sort"
                :selected="(state.sort ?? 'relevance') === sort"
              >
                {{ t(`sort.${sort}`) }}
              </option>
            </select>
            <button v-if="!enhanced" type="submit" class="button button--secondary" :form="FORM_ID">
              {{ t('sort.apply') }}
            </button>
          </div>
        </div>

        <FilterChips
          :state="state"
          :reference="reference"
          :list-path="listPath"
          @navigate="onNavigateLink"
        />

        <div v-if="error" class="notice" role="alert">
          <p>{{ t('courses.errorRefresh') }}</p>
          <button type="button" class="button button--secondary" @click="retry">
            {{ t('common.retry') }}
          </button>
        </div>

        <p v-if="loading" class="catalogue__loading">
          {{ t('common.loading') }}
        </p>

        <div v-if="data && !data.items.length" class="catalogue__empty">
          <p>
            <strong>{{ t('courses.empty') }}</strong>
          </p>
          <ul>
            <li v-if="activeFilterCount(state) > 0">
              <NuxtLink
                :to="{ path: listPath, query: toRouteQuery(withoutFilters(state)) }"
                @click="onNavigateLink"
              >
                {{ t('courses.emptyClearFilters') }}
              </NuxtLink>
            </li>
            <li v-if="!state.includePast">
              <NuxtLink
                :to="{
                  path: listPath,
                  query: toRouteQuery({ ...state, includePast: true, page: 1 }),
                }"
                @click="onNavigateLink"
              >
                {{ t('courses.emptyIncludePast') }}
              </NuxtLink>
            </li>
            <li v-if="state.q">
              {{ t('courses.emptySpelling') }}
            </li>
          </ul>
        </div>

        <ul v-else-if="data" class="catalogue__list" :class="{ 'is-loading': loading }">
          <li v-for="course in data.items" :key="course.id">
            <CourseCard
              :course="course"
              :reference="reference"
              :heading-level="3"
              :highlight-deadline="state.sort === 'deadline'"
            />
          </li>
        </ul>

        <CataloguePagination
          v-if="data"
          :state="state"
          :total="total"
          :page-size="pageSize"
          :list-path="listPath"
          @navigate="onNavigateLink"
        />
      </section>
    </div>

    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </div>
  </div>
</template>

<style scoped>
.catalogue__search {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  max-width: 44rem;
}
.catalogue__layout {
  display: grid;
  gap: 1.5rem;
}
@media (min-width: 56rem) {
  .catalogue__layout {
    grid-template-columns: 17rem minmax(0, 1fr);
    align-items: start;
  }
}
.catalogue__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
}
.catalogue__bar h2 {
  margin: 0;
}
.catalogue__range {
  display: block;
  font-size: 0.95rem;
  font-weight: 400;
  color: var(--c-muted);
}
.catalogue__sort {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.catalogue__sort label {
  font-weight: 600;
}
.catalogue__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.catalogue__list.is-loading {
  opacity: 0.6;
}
.catalogue__loading {
  color: var(--c-muted);
}
.catalogue__empty {
  border: 1px dashed var(--c-border);
  border-radius: var(--radius);
  padding: 1rem 1.25rem;
}
</style>
