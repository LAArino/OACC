<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Home (spec §7): intro, search with suggestions, quick links by field and by
// partner, number of courses. The page always answers 200 (it is the web
// container's health probe): when the catalogue API is unavailable it still
// renders the search form and says so.
const { t } = useI18n();
const localePath = useLocalePath();
const config = useRuntimeConfig();
const api = useCatalogueApi();
const alliance = computed(() => config.public.allianceName || t('home.allianceFallback'));

const [{ data: reference }, { data: overview, error: overviewError }] = await Promise.all([
  useCatalogueReference(),
  useAsyncData('home-overview', () =>
    api.search(emptySearchState(), { page_size: 1, timeout: 3000 }),
  ),
]);
const labels = useCatalogueLabels(() => reference.value);

/** Courses per facet value; undefined when the counts are unknown (API down). */
const facetCount = (facet: 'partner' | 'isced', value: string) =>
  overview.value
    ? (overview.value.facets[facet].find((f) => f.value === value)?.count ?? 0)
    : undefined;

const partners = computed(() =>
  (reference.value?.organizations ?? [])
    .filter((o) => o.is_partner)
    .map((o) => ({
      slug: o.slug,
      name: labels.partnerName(o.slug, o.name),
      country: labels.countryLabel(o.country_code),
      count: facetCount('partner', o.slug),
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);
// Fields without courses are left out (when counts are known); every partner is
// listed, being a member of the alliance.
const fields = computed(() =>
  (reference.value?.isced_broad_fields ?? [])
    .map((f) => ({
      code: f.code,
      label: labels.iscedLabel(f.code, f.label),
      count: facetCount('isced', f.code),
    }))
    .filter((f) => f.count !== 0),
);
const listPath = computed(() => localePath('/courses'));
const unavailable = computed(() => !!overviewError.value);

useHead({
  title: () => t('home.title'),
  meta: [
    { name: 'description', content: () => t('home.metaDescription', { alliance: alliance.value }) },
  ],
});
</script>

<template>
  <div class="home">
    <section class="home__hero" aria-labelledby="home-title">
      <h1 id="home-title">{{ t('home.title') }}</h1>
      <p class="home__intro">{{ t('home.intro', { alliance }) }}</p>
      <form class="home__search" role="search" method="get" :action="listPath">
        <CourseSearchBox
          id="home-q"
          name="q"
          :label="t('search.label')"
          :partner-name="(slug: string) => labels.partnerName(slug)"
        />
        <button type="submit" class="button">{{ t('search.submit') }}</button>
      </form>
      <p v-if="overview" class="home__count">
        <NuxtLink :to="listPath">
          {{ t('home.courseCount', { n: overview.total }, overview.total) }}
        </NuxtLink>
      </p>
    </section>

    <div v-if="unavailable" class="notice" role="status">
      <p>{{ t('errors.unavailableShort') }}</p>
    </div>

    <section v-if="fields.length" class="home__links" aria-labelledby="fields-heading">
      <h2 id="fields-heading">{{ t('home.byField') }}</h2>
      <ul class="link-grid">
        <li v-for="field in fields" :key="field.code">
          <NuxtLink :to="{ path: listPath, query: { isced: field.code } }">
            {{ field.label }}
            <span v-if="field.count !== undefined" class="link-grid__n">
              {{ t('home.linkCount', { n: field.count }, field.count) }}
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section v-if="partners.length" class="home__links" aria-labelledby="partners-heading">
      <h2 id="partners-heading">{{ t('home.byPartner') }}</h2>
      <ul class="link-grid">
        <li v-for="partner in partners" :key="partner.slug">
          <NuxtLink :to="{ path: listPath, query: { partner: partner.slug } }">
            {{ partner.name }}
            <span v-if="partner.country || partner.count !== undefined" class="link-grid__n">
              {{
                [
                  partner.country,
                  partner.count !== undefined
                    ? t('home.linkCount', { n: partner.count }, partner.count)
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')
              }}
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.home__hero {
  padding: 1rem 0 1.5rem;
}
.home__intro {
  font-size: 1.15rem;
  max-width: 44rem;
}
.home__search {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
  max-width: 44rem;
}
.home__count {
  margin: 1rem 0 0;
  font-weight: 600;
}
.link-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
}
.link-grid a {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 2.75rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--c-divider);
  border-radius: var(--radius);
  text-decoration: none;
  font-weight: 600;
}
.link-grid a:hover {
  border-color: var(--c-primary);
  background: var(--c-chip);
}
.link-grid__n {
  font-weight: 400;
  font-size: 0.9rem;
  color: var(--c-muted);
}
</style>
