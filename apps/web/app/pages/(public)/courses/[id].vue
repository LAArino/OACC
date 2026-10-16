<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Course page (spec §7): partner header, key facts (with the course kind,
// levels and every alliance attribute [DL 18]), course texts per language,
// offerings with how to apply, schema.org/Course JSON-LD, canonical URL.
// Instructors and the optional texts of the Aurora IT Handbook [DL 21] are
// shown when the API sends them (an older API does not). The course image
// [DL 27] is shown above the texts, with its credit, and used for link previews
// (else the home page's header image, as on the other public pages).
import type { CourseTexts } from '~/types/catalogue';

/** Text sections in page order; the privacy notice is shown last, after the keywords. */
const TEXT_SECTIONS = [
  'abstract',
  'description',
  'learning_outcomes',
  'prerequisites',
  'assessment',
  'methods',
  'mode_of_repetition',
  'literature',
  'remarks',
] as const satisfies readonly (keyof CourseTexts)[];

const { t, locale } = useI18n();
const localePath = useLocalePath();
const route = useRoute();
const router = useRouter();
const config = useRuntimeConfig();
const api = useCatalogueApi();

const id = computed(() => String(route.params.id));
const { data: reference } = await useCatalogueReference();
const labels = useCatalogueLabels(() => reference.value);

const { data: course, error } = await useAsyncData(`course-${id.value}`, () =>
  api.course(id.value),
);
if (error.value || !course.value) {
  const statusCode = error.value ? catalogueErrorStatus(error.value) : 404;
  throw createError({
    statusCode,
    statusMessage: statusCode === 404 ? 'Not Found' : 'Service Unavailable',
    fatal: true,
  });
}

// --- Texts and languages ---------------------------------------------------
const textLanguages = computed(() => {
  const langs = Object.keys(course.value?.texts ?? {});
  const name = (l: string) => languageName(l, locale.value);
  return langs.sort((a, b) =>
    a === 'en' ? -1 : b === 'en' ? 1 : name(a).localeCompare(name(b), locale.value),
  );
});
const defaultTextLang = computed(() =>
  textLanguages.value.includes('en') ? 'en' : (textLanguages.value[0] ?? 'en'),
);
/** Text language shown: `?text_lang=` when available, else English, else the first one. */
const textLang = computed(() => {
  const asked = typeof route.query.text_lang === 'string' ? route.query.text_lang : undefined;
  return asked && textLanguages.value.includes(asked) ? asked : defaultTextLang.value;
});
const shownText = computed(() => course.value?.texts[textLang.value]);
/** A text section of the shown language, or undefined when missing or blank. */
function sectionText(section: keyof CourseTexts): string | undefined {
  const value = shownText.value?.[section];
  return typeof value === 'string' && value.trim() ? value : undefined;
}
/** Title in the page locale (English fallback), used in the header and the head. */
const pageText = computed(() =>
  course.value ? pickLocalized(course.value.texts, locale.value) : undefined,
);
const title = computed(() => pageText.value?.value.title ?? shownText.value?.title ?? '');
const titleLang = computed(() =>
  pageText.value && pageText.value.lang !== locale.value ? pageText.value.lang : undefined,
);

/** Page query showing the texts in `lang` (other parameters kept). */
function textQuery(lang: string): Record<string, string | string[]> {
  const query = { ...route.query } as Record<string, string | string[]>;
  if (lang === defaultTextLang.value) delete query.text_lang;
  else query.text_lang = lang;
  return query;
}
const textHref = (lang: string) =>
  router.resolve({ path: route.path, query: textQuery(lang), hash: '#course-texts' }).href;
function selectText(lang: string) {
  void router.replace({ query: textQuery(lang) });
}

// --- Facts -------------------------------------------------------------------
const partner = computed(() =>
  course.value ? labels.organizationName(course.value.organization) : '',
);
// Partner logo from the branding directory (partner-<slug>.svg|png|webp), decorative.
const { partnerLogo } = useBrandingIndex();
const logo = computed(() =>
  course.value ? partnerLogo(course.value.organization.slug) : undefined,
);
const country = computed(() => labels.countryLabel(course.value?.organization.country_code));
const unique = (values: string[]) => [...new Set(values)];
const languages = computed(() =>
  unique(course.value?.offerings.flatMap((o) => o.teaching_languages) ?? []),
);
const modes = computed(() =>
  unique(course.value?.offerings.flatMap((o) => o.delivery_modes) ?? []),
);
const iscedLabels = computed(() =>
  unique(
    [...(course.value?.isced_codes ?? [])]
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((c) => labelText(c.label, locale.value) ?? labels.iscedLabel(c.broad_code)),
  ),
);
const teachingUnit = computed(() => labelText(course.value?.teaching_unit?.name, locale.value));
const updatedAt = computed(() => formatDateTimeAsDate(course.value?.updated_at, locale.value));
const levelCount = computed(() => (course.value ? courseLevels(course.value).length : 0));
const level = computed(() => {
  const c = course.value;
  if (!c) return undefined;
  const names = courseLevels(c)
    .map((l) => labels.levelLabel(l))
    .join(', ');
  const eqf = c.eqf_level ? t('facts.eqf', { n: c.eqf_level }) : undefined;
  if (names && eqf) return `${names} (${eqf})`;
  return names || eqf || undefined;
});
const kind = computed(() => (course.value?.kind ? labels.kindLabel(course.value.kind) : undefined));
/** Every attribute of the course, in schema order, with resolved labels. */
const attributes = computed(() =>
  orderAttributes(course.value?.attributes, reference.value?.attribute_definitions).map((a) => {
    const def = labels.attributeDefinition(a.key);
    const isBoolean =
      def?.value_type === 'boolean' ||
      (!def && a.values.every((v) => v.value === 'true' || v.value === 'false'));
    return {
      key: a.key,
      label: labelText(a.label, locale.value) ?? labels.attributeLabel(a.key),
      // Booleans read "Yes"/"No" in the UI language; other values use their labels.
      values: a.values.map((v) =>
        isBoolean && (v.value === 'true' || v.value === 'false')
          ? t(v.value === 'true' ? 'course.yes' : 'course.no')
          : (labelText(v.label, locale.value) ?? labels.attributeValueLabel(a.key, v.value)),
      ),
    };
  }),
);
const offerings = computed(() =>
  [...(course.value?.offerings ?? [])].sort((a, b) => a.start_date.localeCompare(b.start_date)),
);
const infoUrl = computed(() => safeHttpUrl(course.value?.info_url));
const contactEmail = computed(() => safeEmail(course.value?.contact_email));
const instructors = computed(() => courseInstructors(course.value));
const image = computed(() => course.value?.image ?? null);
const imageAlt = computed(() => (image.value ? courseImageAlt(image.value, locale.value) : null));
const imageCredit = computed(() => image.value?.credit?.trim() || undefined);

// --- Back to results -----------------------------------------------------------
const listPath = computed(() => localePath('/courses'));
const backPath = ref(listPath.value);
onMounted(() => {
  const origin = window.location.origin;
  const historyBack = (window.history.state as { back?: unknown } | null)?.back;
  backPath.value =
    catalogueBackPath(
      typeof historyBack === 'string' ? historyBack : null,
      listPath.value,
      origin,
    ) ??
    catalogueBackPath(document.referrer, listPath.value, origin) ??
    listPath.value;
});

// --- Head: title, description, canonical, JSON-LD ------------------------------
const requestUrl = useRequestURL();
const i18nBase = (config.public.i18n as { baseUrl?: string } | undefined)?.baseUrl;
const origin = (i18nBase || requestUrl.origin).replace(/\/$/, '');
const canonical = computed(
  () => `${origin}${localePath(`/courses/${encodeURIComponent(id.value)}`)}`,
);
const description = computed(() => {
  const text = pageText.value?.value;
  const source =
    text?.abstract || text?.description || t('course.metaFallback', { partner: partner.value });
  return source.length > 160 ? `${source.slice(0, 157).trimEnd()}…` : source;
});
const { previewMeta: heroPreviewMeta } = useHeroImage();
/** Link-preview meta: the course image when set, else the home header image (if any). */
function previewMeta() {
  if (!image.value) return heroPreviewMeta();
  const alt = imageAlt.value?.text;
  return [
    { property: 'og:image', content: absoluteUrl(image.value.url, origin) },
    { property: 'og:image:width', content: String(image.value.width) },
    { property: 'og:image:height', content: String(image.value.height) },
    ...(alt ? [{ property: 'og:image:alt', content: alt }] : []),
    { name: 'twitter:card', content: 'summary_large_image' },
  ];
}
useHead({
  title,
  meta: () => [{ name: 'description', content: description.value }, ...previewMeta()],
  link: [{ rel: 'canonical', href: canonical, key: 'canonical' }],
  script: [
    {
      key: 'course-jsonld',
      type: 'application/ld+json',
      innerHTML: () =>
        course.value
          ? serializeJsonLd(
              courseJsonLd(course.value, {
                url: canonical.value,
                locale: locale.value,
                courseModes: Object.fromEntries(
                  (reference.value?.delivery_modes ?? []).map((m) => [m.code, m.schema_org]),
                ),
              }),
            )
          : '',
    },
  ],
});
</script>

<template>
  <article v-if="course" class="course" :aria-labelledby="'course-title'">
    <nav class="breadcrumb" :aria-label="t('breadcrumb.label')">
      <ol>
        <li>
          <NuxtLink :to="localePath('/')">{{ t('nav.home') }}</NuxtLink>
        </li>
        <li>
          <NuxtLink :to="listPath">{{ t('nav.courses') }}</NuxtLink>
        </li>
        <li>
          <span aria-current="page" :lang="titleLang">{{ title }}</span>
        </li>
      </ol>
    </nav>

    <p class="course__back">
      <NuxtLink :to="backPath">
        <span aria-hidden="true">← </span>{{ t('course.backToResults') }}
      </NuxtLink>
    </p>

    <header class="course__header">
      <h1 id="course-title" :lang="titleLang">{{ title }}</h1>
      <p class="course__partner">
        <img v-if="logo" class="course__logo" :src="logo" alt="" height="48" decoding="async" />
        <span
          >{{ partner }}<template v-if="country"> · {{ country }}</template></span
        >
      </p>
    </header>

    <section class="course__facts" aria-labelledby="facts-heading">
      <h2 id="facts-heading" class="visually-hidden">{{ t('course.factsHeading') }}</h2>
      <dl class="facts">
        <template v-if="teachingUnit">
          <dt>{{ t('facts.teachingUnit') }}</dt>
          <dd>{{ teachingUnit }}</dd>
        </template>
        <dt>{{ t('facts.ects') }}</dt>
        <dd>{{ course.ects }}</dd>
        <template v-if="kind">
          <dt>{{ t('facts.kind') }}</dt>
          <dd>{{ kind }}</dd>
        </template>
        <template v-if="level">
          <dt>{{ t('facts.levels', Math.max(1, levelCount)) }}</dt>
          <dd>{{ level }}</dd>
        </template>
        <template v-if="course.teaching_hours">
          <dt>{{ t('facts.teachingHours') }}</dt>
          <dd>{{ course.teaching_hours }}</dd>
        </template>
        <template v-if="iscedLabels.length">
          <dt>{{ t('facts.fields') }}</dt>
          <dd>{{ iscedLabels.join('; ') }}</dd>
        </template>
        <template v-if="languages.length">
          <dt>{{ t('facts.languages') }}</dt>
          <dd>{{ languages.map((l) => labels.languageLabel(l)).join(', ') }}</dd>
        </template>
        <template v-if="modes.length">
          <dt>{{ t('facts.modes') }}</dt>
          <dd>{{ modes.map((m) => labels.modeLabel(m)).join(', ') }}</dd>
        </template>
        <dt>{{ t('facts.courseCode') }}</dt>
        <dd>{{ course.ext_id }}</dd>
        <template v-if="instructors.length">
          <dt>{{ t('facts.instructors', instructors.length) }}</dt>
          <dd>
            <ul class="course__instructors">
              <li v-for="(name, index) in instructors" :key="index">{{ name }}</li>
            </ul>
          </dd>
        </template>
        <template v-if="contactEmail">
          <dt>{{ t('facts.contact') }}</dt>
          <dd>
            <a :href="`mailto:${contactEmail}`">{{ contactEmail }}</a>
          </dd>
        </template>
        <template v-if="updatedAt">
          <dt>{{ t('facts.updated') }}</dt>
          <dd>{{ updatedAt }}</dd>
        </template>
      </dl>
      <template v-if="attributes.length">
        <h3 id="attributes-heading" class="course__subheading">
          {{ t('course.attributesHeading') }}
        </h3>
        <dl class="facts">
          <template v-for="attribute in attributes" :key="attribute.key">
            <dt>{{ attribute.label }}</dt>
            <dd>{{ attribute.values.join(', ') }}</dd>
          </template>
        </dl>
      </template>
      <p v-if="infoUrl" class="course__info">
        <a :href="infoUrl" target="_blank" rel="noopener">
          {{ t('course.moreInfo') }}
          <span class="visually-hidden">{{ t('common.newTab') }}</span>
          <span aria-hidden="true">↗</span>
        </a>
      </p>
    </section>

    <figure v-if="image" class="course__image">
      <div class="course__image-box">
        <img
          :src="image.url"
          :alt="imageAlt?.text ?? ''"
          :lang="imageAlt?.lang"
          :width="image.width"
          :height="image.height"
          decoding="async"
        />
      </div>
      <figcaption v-if="imageCredit" class="course__image-credit">
        {{ t('course.imageCredit', { credit: imageCredit }) }}
      </figcaption>
    </figure>

    <section id="course-texts" class="course__texts" aria-labelledby="texts-heading">
      <h2 id="texts-heading">{{ t('course.aboutHeading') }}</h2>
      <LanguageTabs
        v-if="textLanguages.length > 1"
        :languages="textLanguages"
        :active="textLang"
        :label="t('course.textLanguage')"
        panel-id="course-text-panel"
        :href-for="textHref"
        @select="selectText"
      />
      <div
        v-if="shownText"
        id="course-text-panel"
        class="course__panel"
        :lang="textLang"
        :role="textLanguages.length > 1 ? 'tabpanel' : undefined"
        :aria-labelledby="textLanguages.length > 1 ? `text-tab-${textLang}` : undefined"
        :tabindex="textLanguages.length > 1 ? 0 : undefined"
      >
        <p v-if="shownText.is_machine_translated" class="course__mt" :lang="locale">
          {{ t('course.machineTranslated') }}
        </p>
        <p v-if="shownText.title && shownText.title !== title" class="course__alt-title">
          <strong>{{ shownText.title }}</strong>
        </p>
        <template v-for="section in TEXT_SECTIONS" :key="section">
          <section v-if="sectionText(section)" class="course__text-section">
            <h3 :lang="locale">{{ t(`course.sections.${section}`) }}</h3>
            <p class="text-block">{{ sectionText(section) }}</p>
          </section>
        </template>
        <section v-if="shownText.keywords.length" class="course__text-section">
          <h3 :lang="locale">{{ t('course.sections.keywords') }}</h3>
          <ul class="tag-list">
            <li v-for="keyword in shownText.keywords" :key="keyword">{{ keyword }}</li>
          </ul>
        </section>
        <section v-if="sectionText('privacy_notice')" class="course__text-section course__privacy">
          <h3 :lang="locale">{{ t('course.sections.privacy_notice') }}</h3>
          <p class="text-block">{{ sectionText('privacy_notice') }}</p>
        </section>
      </div>
    </section>

    <section class="course__offerings" aria-labelledby="offerings-heading">
      <h2 id="offerings-heading">
        {{ t('course.offeringsHeading', { n: offerings.length }, offerings.length) }}
      </h2>
      <p v-if="!offerings.length">{{ t('course.noOfferings') }}</p>
      <ul v-else class="course__offering-list">
        <li v-for="offering in offerings" :key="offering.id">
          <OfferingDetails
            :offering="offering"
            :partner="partner"
            :contact-email="course.contact_email"
            :reference="reference"
            :heading-level="3"
            :text-lang="textLang"
          />
        </li>
      </ul>
      <p class="course__dates-note">{{ t('course.datesNote') }}</p>
    </section>
  </article>
</template>

<style scoped>
.course__back {
  margin: 0.75rem 0 0;
}
.course__header h1 {
  margin-bottom: 0.25rem;
}
.course__partner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 0 1rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--c-muted);
}
.course__logo {
  flex: none;
  height: 3rem;
  width: auto;
  max-width: 10rem;
  object-fit: contain;
}
.course__facts {
  background: var(--c-surface);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
}
.course__facts .facts {
  margin: 0;
}
@media (max-width: 30rem) {
  .course__facts .facts {
    grid-template-columns: 1fr;
  }
  .course__facts .facts dd {
    margin-bottom: 0.4rem;
  }
}
.course__subheading {
  margin: 1rem 0 0.25rem;
  font-size: 1.05rem;
}
.course__info {
  margin: 0.75rem 0 0;
}
/* The course image: full width, 16:9 up to 32rem high, sized before it loads
   (no layout shift); a taller or wider file is cropped to the box. */
.course__image {
  margin: 1.5rem 0 0;
}
.course__image-box {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 32rem;
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--c-surface);
}
.course__image-box img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.course__image-credit {
  margin: 0.35rem 0 0;
  color: var(--c-muted);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.course__panel:focus-visible {
  outline: 3px solid var(--c-focus);
  outline-offset: 4px;
}
.course__text-section h3 {
  margin: 1.25rem 0 0.25rem;
}
.course__text-section p {
  margin: 0;
}
.course__instructors {
  list-style: none;
  margin: 0;
  padding: 0;
}
.course__privacy {
  margin-top: 1.5rem;
  border-top: 1px solid var(--c-divider);
  color: var(--c-muted);
  font-size: 0.9rem;
}
.course__privacy h3 {
  font-size: 1rem;
}
.course__mt {
  color: var(--c-muted);
  font-style: italic;
}
.course__alt-title {
  font-size: 1.1rem;
}
.course__offering-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}
@media (min-width: 48rem) {
  .course__offering-list {
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  }
}
.course__dates-note {
  color: var(--c-muted);
  font-size: 0.9rem;
}
</style>
