<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
interface CourseHit {
  id: string;
  title: Record<string, string>;
  ects: number;
}
interface SearchResponse {
  items: CourseHit[];
}

const { t, locale } = useI18n();
const localePath = useLocalePath();
const route = useRoute();
const api = useApi();
useHead({ title: () => t('courses.title') });

// Search state lives in the URL (spec §7).
const { data, error } = await useAsyncData(
  'course-search',
  () => api<SearchResponse>('/api/public/v1/courses', { query: route.query }),
  { watch: [() => route.query] },
);
</script>

<template>
  <h1>{{ t('courses.title') }}</h1>
  <p v-if="error" role="alert">
    {{ t('courses.error') }}
  </p>
  <p v-else-if="!data?.items.length">
    {{ t('courses.empty') }}
  </p>
  <ul v-else>
    <li v-for="course in data.items" :key="course.id">
      <NuxtLink
        :to="localePath(`/courses/${course.id}`)"
        :lang="pickLocalized(course.title, locale)?.lang"
      >
        {{ pickLocalized(course.title, locale)?.value }}
      </NuxtLink>
      <span>{{ t('course.ects', { n: course.ects }) }}</span>
    </li>
  </ul>
</template>
