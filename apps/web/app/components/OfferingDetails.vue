<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// One offering on the course page (spec §7): session, dates, enrolment window,
// application deadline in the offering time zone, modes, languages, campus,
// seats [DL 8] and how to apply: the partner's instructions [DL 18] (plain
// text in the language of the course texts, English fallback) above the
// application link or contact note.
import type { Offering } from '../types/catalogue';
import type { MaybeReference } from '../composables/useCatalogueLabels';

const props = defineProps<{
  offering: Offering;
  partner: string;
  contactEmail?: string | null;
  reference?: MaybeReference;
  headingLevel?: 2 | 3 | 4;
  /** Language the course texts are shown in; instructions follow it. */
  textLang?: string;
}>();
const { t, locale } = useI18n();
const labels = useCatalogueLabels(() => props.reference);

const o = computed(() => props.offering);
const fmt = (d: string | null | undefined) => formatDate(d, locale.value);
const heading = computed(() => `h${props.headingLevel ?? 3}`);
const subheading = computed(() => `h${Math.min(6, (props.headingLevel ?? 3) + 1)}`);
const headingId = computed(() => `offering-${o.value.id}`);
const sessionName = computed(() =>
  o.value.academic_session ? labelText(o.value.academic_session.name, locale.value) : undefined,
);
const dateRange = computed(() =>
  t('dates.range', { start: fmt(o.value.start_date), end: fmt(o.value.end_date) }),
);
const cancelled = computed(() => o.value.status === 'cancelled');
const deadlinePassed = computed(
  () => !cancelled.value && isDeadlinePassed(o.value.application_deadline, o.value.timezone),
);
const deadlineText = computed(() => {
  const date = fmt(o.value.application_deadline);
  return date && deadlinePassed.value ? `${date} (${t('offering.deadlinePassed')})` : date;
});
const enrolment = computed(() => {
  const start = fmt(o.value.enrol_start_date);
  const end = fmt(o.value.application_deadline);
  if (start && end) return t('dates.range', { start, end });
  if (start) return t('offering.enrolFrom', { date: start });
  return undefined;
});
const applyUrl = computed(() =>
  cancelled.value ? undefined : safeHttpUrl(o.value.application_url),
);
const applyHost = computed(() => urlHost(applyUrl.value));
const email = computed(() => safeEmail(props.contactEmail));
const instructions = computed(() =>
  cancelled.value
    ? undefined
    : textIn(o.value.application_instructions, props.textLang ?? locale.value),
);
</script>

<template>
  <article class="offering" :aria-labelledby="headingId">
    <component :is="heading" :id="headingId" class="offering__title">
      {{ sessionName ?? dateRange }}
    </component>
    <p v-if="cancelled" class="offering__badge">
      {{ t('offering.cancelled') }}
    </p>
    <p v-else-if="deadlinePassed" class="offering__badge">
      {{ t('offering.deadlinePassedBadge') }}
    </p>
    <dl class="facts">
      <dt>{{ t('offering.dates') }}</dt>
      <dd>{{ dateRange }}</dd>
      <template v-if="enrolment">
        <dt>{{ t('offering.enrolment') }}</dt>
        <dd>{{ enrolment }}</dd>
      </template>
      <template v-if="o.application_deadline">
        <dt>{{ t('offering.deadline') }}</dt>
        <dd :class="{ 'is-passed': deadlinePassed }">{{ deadlineText }}</dd>
      </template>
      <dt>{{ t('offering.timezone') }}</dt>
      <dd>{{ o.timezone }}</dd>
      <template v-if="o.delivery_modes.length">
        <dt>{{ t('facts.modes') }}</dt>
        <dd>{{ o.delivery_modes.map((m) => labels.modeLabel(m)).join(', ') }}</dd>
      </template>
      <template v-if="o.teaching_languages.length">
        <dt>{{ t('facts.languages') }}</dt>
        <dd>{{ o.teaching_languages.map((l) => labels.languageLabel(l)).join(', ') }}</dd>
      </template>
      <template v-if="o.campus">
        <dt>{{ t('offering.campus') }}</dt>
        <dd>{{ o.campus }}</dd>
      </template>
    </dl>
    <SeatsLine v-if="!cancelled" :offering="o" :time-zone="o.timezone" />
    <section
      v-if="instructions"
      class="offering__instructions"
      :aria-labelledby="`${headingId}-apply`"
    >
      <component :is="subheading" :id="`${headingId}-apply`">
        {{ t('offering.howToApply') }}
      </component>
      <p class="text-block" :lang="instructions.lang !== locale ? instructions.lang : undefined">
        {{ instructions.value }}
      </p>
    </section>
    <p v-if="!cancelled" class="offering__apply">
      <a v-if="applyUrl" class="button" :href="applyUrl" target="_blank" rel="noopener">
        {{ t('offering.applyAt', { partner }) }}
        <span class="offering__host">({{ applyHost }})</span>
        <span class="visually-hidden">{{ t('common.newTab') }}</span>
        <span aria-hidden="true">↗</span>
      </a>
      <template v-else-if="email">
        {{ t('offering.contactToApply', { partner }) }}
        <a :href="`mailto:${email}`">{{ email }}</a>
      </template>
      <template v-else>
        {{ t('offering.contactPartner', { partner }) }}
      </template>
    </p>
  </article>
</template>

<style scoped>
.offering {
  border: 1px solid var(--c-divider);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
}
.offering__title {
  margin: 0 0 0.5rem;
}
.offering__badge {
  display: inline-block;
  margin: 0 0 0.5rem;
  padding: 0.1rem 0.6rem;
  border: 1px solid var(--c-danger);
  border-radius: 999px;
  background: var(--c-danger-bg);
  color: var(--c-danger);
  font-weight: 600;
  font-size: 0.9rem;
}
.is-passed {
  color: var(--c-danger);
  font-weight: 600;
}
.seats {
  font-weight: 600;
  margin: 0.5rem 0;
}
.offering__instructions {
  margin: 0.75rem 0 0;
}
.offering__instructions > :first-child {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}
.offering__instructions p {
  margin: 0;
}
.offering__apply {
  margin: 0.75rem 0 0;
}
/* The button's text wraps on narrow screens instead of widening the page (WCAG 1.4.10). */
.offering__apply .button {
  flex-wrap: wrap;
  max-width: 100%;
}
.offering__host {
  font-weight: 400;
  overflow-wrap: anywhere;
}
</style>
