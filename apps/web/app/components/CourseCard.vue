<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// One search result (spec §7): title, kind badge, partner, key facts, next
// offering, seats and the alliance attribute tags [DL 18].
import type { CourseCard } from '../types/catalogue';
import type { MaybeReference } from '../composables/useCatalogueLabels';

const props = defineProps<{
  course: CourseCard;
  reference?: MaybeReference;
  /** Heading level of the title (cards sit under the results heading). */
  headingLevel?: 2 | 3 | 4;
  /** Emphasise the application deadline (results sorted by deadline). */
  highlightDeadline?: boolean;
}>();

/** Tags shown before "+N" (the course page lists every attribute). */
const TAG_LIMIT = 4;
const { t, locale } = useI18n();
const localePath = useLocalePath();
const labels = useCatalogueLabels(() => props.reference);

const fmt = (d: string | null | undefined) => formatDate(d, locale.value);
const heading = computed(() => `h${props.headingLevel ?? 3}`);
const partner = computed(() => labels.organizationName(props.course.organization));
const country = computed(() => labels.countryLabel(props.course.organization.country_code));
const modes = computed(() => props.course.delivery_modes.map((m) => labels.modeLabel(m)));
const languages = computed(() =>
  props.course.teaching_languages.map((l) => labels.languageLabel(l)),
);
const next = computed(() => props.course.next_offering);
const deadlinePassed = computed(() =>
  next.value
    ? isDeadlinePassed(next.value.application_deadline, next.value.timezone ?? 'UTC')
    : false,
);
/** `lang` for texts resolved in another language than the page (English fallback). */
const otherLang = (lang: string | null | undefined) =>
  lang && lang !== locale.value ? lang : undefined;
const deadlineText = computed(() => {
  const date = fmt(next.value?.application_deadline);
  return date && deadlinePassed.value ? `${date} (${t('offering.deadlinePassed')})` : date;
});
const otherOfferings = computed(() => Math.max(0, props.course.offerings_count - 1));
const kindBadge = computed(() => {
  const kind = props.course.kind;
  return kind && kind !== 'course' ? labels.kindBadge(kind) : undefined;
});
const levels = computed(() => courseLevels(props.course).map((l) => labels.levelLabel(l)));
const tags = computed(() =>
  attributeTags(props.course.attributes, props.reference?.attribute_definitions, locale.value),
);
const shownTags = computed(() => tags.value.slice(0, TAG_LIMIT));
const hiddenTags = computed(() => Math.max(0, tags.value.length - TAG_LIMIT));
</script>

<template>
  <article class="course-card">
    <component :is="heading" class="course-card__title">
      <NuxtLink
        :to="localePath(`/courses/${encodeURIComponent(course.id)}`)"
        :lang="otherLang(course.title_lang)"
      >
        {{ course.title }}
      </NuxtLink>
    </component>
    <p v-if="kindBadge" class="course-card__kind">{{ kindBadge }}</p>
    <p class="course-card__partner">
      {{ partner }}<template v-if="country"> · {{ country }}</template>
    </p>
    <p v-if="course.abstract" class="course-card__abstract" :lang="otherLang(course.abstract_lang)">
      {{ course.abstract }}
    </p>
    <dl class="facts course-card__facts">
      <dt>{{ t('facts.ects') }}</dt>
      <dd>{{ course.ects }}</dd>
      <template v-if="levels.length">
        <dt>{{ t('facts.levels', levels.length) }}</dt>
        <dd>{{ levels.join(', ') }}</dd>
      </template>
      <template v-if="modes.length">
        <dt>{{ t('facts.modes') }}</dt>
        <dd>{{ modes.join(', ') }}</dd>
      </template>
      <template v-if="languages.length">
        <dt>{{ t('facts.languages') }}</dt>
        <dd>{{ languages.join(', ') }}</dd>
      </template>
      <template v-if="next">
        <dt>{{ t('facts.nextOffering') }}</dt>
        <dd>
          {{ t('dates.range', { start: fmt(next.start_date), end: fmt(next.end_date) }) }}
        </dd>
        <template v-if="next.application_deadline">
          <dt :class="{ 'is-highlighted': highlightDeadline }">
            {{ t('facts.applicationDeadline') }}
          </dt>
          <dd :class="{ 'is-passed': deadlinePassed, 'is-highlighted': highlightDeadline }">
            {{ deadlineText }}
          </dd>
        </template>
      </template>
    </dl>
    <p v-if="!next" class="course-card__muted">
      {{ t('courses.noUpcoming') }}
    </p>
    <SeatsLine :offering="next" :time-zone="next?.timezone" />
    <p v-if="otherOfferings > 0" class="course-card__muted">
      {{ t('courses.moreOfferings', { n: otherOfferings }, otherOfferings) }}
    </p>
    <ul v-if="shownTags.length" class="tag-list course-card__tags" :aria-label="t('courses.tags')">
      <li v-for="tag in shownTags" :key="tag">{{ tag }}</li>
      <li v-if="hiddenTags > 0" class="course-card__more">
        <span aria-hidden="true">+{{ hiddenTags }}</span>
        <span class="visually-hidden">{{
          t('courses.moreTags', { n: hiddenTags }, hiddenTags)
        }}</span>
      </li>
    </ul>
  </article>
</template>

<style scoped>
.course-card {
  border: 1px solid var(--c-divider);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  background: var(--c-bg);
}
.course-card__title {
  margin: 0 0 0.25rem;
}
.course-card__partner {
  margin: 0 0 0.5rem;
  color: var(--c-muted);
  font-weight: 600;
}
.course-card__abstract {
  margin: 0.25rem 0 0.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.course-card__muted {
  color: var(--c-muted);
  margin: 0.25rem 0 0;
}
.is-passed {
  color: var(--c-danger);
}
.course-card__kind {
  display: inline-block;
  margin: 0 0 0.4rem;
  padding: 0.05rem 0.6rem;
  border: 1px solid var(--c-chip-text);
  border-radius: var(--radius);
  background: var(--c-chip);
  color: var(--c-chip-text);
  font-size: 0.9rem;
  font-weight: 700;
}
.course-card__tags {
  margin-top: 0.6rem;
}
.course-card__more {
  font-weight: 700;
}
dt.is-highlighted,
dd.is-highlighted {
  font-weight: 700;
}
dd.is-highlighted {
  justify-self: start;
  padding: 0 0.4rem;
  border-left: 3px solid var(--c-notice-border);
  background: var(--c-notice-bg);
}
.seats {
  margin: 0.25rem 0 0;
  font-weight: 600;
}
</style>
