<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
interface CourseText {
  title: string;
  abstract: string | null;
}
interface CoursePage {
  id: string;
  ects: number;
  texts: Record<string, CourseText>;
}

const { t, locale } = useI18n();
const route = useRoute();
const api = useApi();
const id = computed(() => String(route.params.id));

const { data, error } = await useAsyncData(`course-${id.value}`, () =>
  api<CoursePage>(`/api/public/v1/courses/${encodeURIComponent(id.value)}`),
);
const text = computed(() =>
  data.value ? pickLocalized(data.value.texts, locale.value) : undefined,
);
useHead({ title: () => text.value?.value.title ?? t('course.notFound') });
</script>

<template>
  <article v-if="data && text">
    <h1 :lang="text.lang === locale ? undefined : text.lang">
      {{ text.value.title }}
    </h1>
    <p>{{ t('course.ects', { n: data.ects }) }}</p>
    <p v-if="text.value.abstract" :lang="text.lang === locale ? undefined : text.lang">
      {{ text.value.abstract }}
    </p>
  </article>
  <p v-else-if="error" role="alert">
    {{ t('course.notFound') }}
  </p>
</template>
