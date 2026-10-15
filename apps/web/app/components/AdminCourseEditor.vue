<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Course wizard (spec §6.4, §8.1): 1 Basics → 2 Texts (English required) →
// 3 Attributes → 4 Review and status. New courses are filled in order; existing
// ones can jump to any step and save from it. Each step is validated in the
// browser before moving on; server validation errors (`json_pointer`) are mapped
// back to their fields. In overrides mode (organization harvested through OEAPI)
// every field shows its source value and an "Override" toggle, and Save sends only
// the toggled fields as `PATCH …/overrides` `set`/`clear`. Instructors and the
// optional IT Handbook texts ("More texts") follow DL 21; the Review step shows
// the course's completeness against the publication rule as last saved.
import type { AdminAttributeValue, AdminCourse, AdminCourseReference } from '~/types/admin';

const props = defineProps<{
  orgId: string;
  reference: AdminCourseReference;
  /** null: create a new course. */
  course: AdminCourse | null;
}>();
const emit = defineEmits<{
  saved: [course: AdminCourse, outcome: 'created' | 'updated' | 'overridden'];
}>();
const { t, te, locale } = useI18n();
const coursesApi = useAdminCoursesApi();

const PREFIX = 'course';
const creating = computed(() => props.course === null);
const overridesMode = computed(() => !creating.value && props.reference.form_mode === 'overrides');

const form = ref<CourseForm>(emptyCourseForm());
/** Form as loaded, to tell changed overrides from untouched ones. */
let initial: CourseForm = emptyCourseForm();
const on = ref<Record<string, boolean>>({});
const stored = ref<Set<string>>(new Set());
const step = ref(0);
const reachable = ref(0);
const activeLang = ref('en');
const issues = ref<FormIssue[]>([]);
const summaryKey = ref(0);
const failure = ref<AdminApiError | null>(null);
const saving = ref(false);
const result = ref<string | null>(null);
const resultKey = ref(0);
const stepHeading = ref<HTMLElement | null>(null);
/** Languages whose "More texts" group is open. */
const moreOpen = ref<Set<string>>(new Set());

function load() {
  const course = props.course;
  form.value = course ? courseFormFromCourse(course, props.reference) : emptyCourseForm();
  initial = JSON.parse(JSON.stringify(form.value)) as typeof initial;
  const keys = course ? Object.keys(course.overrides) : [];
  stored.value = new Set(keys);
  on.value = Object.fromEntries(keys.map((k) => [k, true]));
  reachable.value = creating.value ? Math.max(0, Math.min(reachable.value, step.value)) : 3;
  if (!form.value.texts[activeLang.value]) activeLang.value = 'en';
  moreOpen.value = new Set(
    Object.keys(form.value.texts).filter((lang) =>
      COURSE_MORE_TEXT_FIELDS.some(
        (f) => (form.value.texts[lang]?.[f] ?? '').trim() !== '' || on.value[`texts.${lang}.${f}`],
      ),
    ),
  );
}
load();
watch(
  () => props.course,
  () => {
    load();
    issues.value = [];
  },
);

// ---------------------------------------------------------------------------
// Labels and options

const stepNames = computed(() => COURSE_STEPS.map((s) => t(`admin.wizard.steps.${s}`)));
const kindOptions = computed(() =>
  props.reference.kinds.map((k) => ({
    value: k.code,
    label: te(`kind.${k.code}`) ? t(`kind.${k.code}`) : adminLabel(k.label, locale.value),
  })),
);
const levelOptions = computed(() =>
  props.reference.levels.map((code) => ({
    value: code,
    label: te(`level.${code}`) ? t(`level.${code}`) : code,
  })),
);
const unitOptions = computed(() => [
  { value: '', label: t('admin.courses.noTeachingUnit') },
  ...props.reference.teaching_units
    .filter((u) => u.ext_id)
    .map((u) => ({ value: u.ext_id as string, label: adminLabel(u.name, locale.value) })),
]);
const languageOptions = computed(() =>
  props.reference.languages.map((l) => ({ tag: l.tag, label: adminLabel(l.label, locale.value) })),
);
const definitions = computed(() => sortedDefinitions(props.reference.attribute_definitions));
const textLanguages = computed(() => {
  const langs = Object.keys(form.value.texts);
  return ['en', ...langs.filter((l) => l !== 'en')];
});

function fieldLabel(pointer: string): string {
  const parts = pointer.split('/').filter(Boolean);
  const head = parts[0] ?? '';
  if (head === 'texts') {
    const lang = parts[1] ?? '';
    const language = languageOptions.value.find((l) => l.tag === lang)?.label ?? lang;
    const field = parts[2] ?? 'title';
    return `${t(`admin.courses.fields.${field}`)} (${language})`;
  }
  if (head === 'isced_codes') {
    return t('admin.courses.iscedCode', { n: Number(parts[1] ?? 0) + 1 });
  }
  if (head === 'attributes') {
    const definition = definitions.value.find((d) => d.key === parts[1]);
    return definition
      ? adminLabel(definition.label, locale.value)
      : t('admin.wizard.steps.attributes');
  }
  return te(`admin.courses.fields.${head}`) ? t(`admin.courses.fields.${head}`) : head;
}

// ---------------------------------------------------------------------------
// Issues

const fid = (pointer: string) => adminFieldDomId(PREFIX, pointer);

function messageOf(issue: FormIssue): string {
  const key = formIssueMessageKey(issue);
  if (key && te(key)) return t(key);
  return issue.message ?? t('admin.validation.invalid');
}

function err(pointer: string): string | null {
  const issue = issues.value.find((i) => i.field === pointer);
  return issue ? messageOf(issue) : null;
}

const summary = computed(() =>
  issues.value.map((issue) => ({
    id: fid(issue.field),
    message: `${fieldLabel(issue.field)}: ${messageOf(issue)}`,
  })),
);
const invalidSteps = computed(() => [
  ...new Set(issues.value.map((issue) => courseFieldStep(issue.field))),
]);
const invalidLanguages = computed(() => [
  ...new Set(
    issues.value
      .filter((i) => i.field.startsWith('/texts/'))
      .map((i) => i.field.split('/')[2] ?? ''),
  ),
]);

function showIssues(list: FormIssue[]) {
  issues.value = list;
  summaryKey.value++;
  // Open "More texts" where one of its fields has an issue.
  const more = new Set<string>(COURSE_MORE_TEXT_FIELDS);
  const langs = list
    .map((i) => i.field.split('/'))
    .filter((p) => p[1] === 'texts' && more.has(p[3] ?? ''))
    .map((p) => p[2] ?? '');
  if (langs.length) moreOpen.value = new Set([...moreOpen.value, ...langs]);
}

async function focusField(id: string) {
  const issue = issues.value.find((i) => fid(i.field) === id);
  if (issue) {
    step.value = courseFieldStep(issue.field);
    const lang = issue.field.startsWith('/texts/') ? issue.field.split('/')[2] : undefined;
    if (lang) activeLang.value = lang;
  }
  await nextTick();
  const element = document.getElementById(id);
  const target =
    element && /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)
      ? element
      : element?.querySelector<HTMLElement>('input:not([disabled]), select, textarea');
  (target ?? element)?.focus();
}

/** Fields the form renders, to map server pointers to them. */
function knownFields(): Set<string> {
  const known = new Set([
    '/ext_id',
    '/kind',
    '/levels',
    '/ects',
    '/teaching_hours',
    '/teaching_unit_ext_id',
    '/info_url',
    '/contact_email',
    '/instructors',
    '/isced_codes',
    '/attributes',
    '/status',
  ]);
  form.value.isced.forEach((_, i) => known.add(`/isced_codes/${i}/code`));
  for (const lang of Object.keys(form.value.texts)) {
    for (const field of COURSE_TEXT_FIELDS) known.add(`/texts/${lang}/${field}`);
  }
  for (const d of definitions.value) known.add(`/attributes/${d.key}`);
  return known;
}

function mapServerIssues(error: AdminApiError): { mapped: FormIssue[]; unmapped: boolean } {
  const known = knownFields();
  const mapped: FormIssue[] = [];
  let unmapped = false;
  const list = serverFormIssues(error.problem);
  for (const issue of list) {
    let field = resolveIssueField(issue.field, known);
    if (!field && /^\/texts\/[a-z]{2,3}$/.test(issue.field)) field = `${issue.field}/title`;
    if (
      !field &&
      (issue.code === 'oecp.content.duplicate_ext_id' ||
        issue.code === 'oecp.content.ext_id_immutable')
    ) {
      field = '/ext_id';
    }
    if (field === '/isced_codes') field = '/isced_codes/0/code';
    if (field) mapped.push({ ...issue, field });
    else unmapped = true;
  }
  return { mapped, unmapped: unmapped || list.length === 0 };
}

// ---------------------------------------------------------------------------
// Overrides

const isOn = (key: string) => !!on.value[key];
const onlyToggled = (key: string) => isOn(key);

function sourceText(key: string): string {
  const course = props.course;
  if (!course) return '';
  const value = courseSourceValue(course, key, props.reference);
  return courseValueText(key, value, props.reference, t, locale.value);
}

/** Turning an override off shows the source value again. */
function setOverride(key: string, value: boolean) {
  on.value = { ...on.value, [key]: value };
  if (!value && props.course) {
    applyCourseValue(form.value, key, courseSourceValue(props.course, key, props.reference));
  }
}

const pendingPatch = computed(() =>
  buildOverridesPatch(
    courseOverrideKeys(form.value),
    on.value,
    stored.value,
    (key) => courseFormValue(form.value, key),
    (key) => courseFormValue(initial, key),
  ),
);

function overrideLabel(key: string): string {
  if (key.startsWith('texts.')) {
    const [, lang, field] = key.split('.');
    return fieldLabel(`/texts/${lang}/${field}`);
  }
  if (key === 'isced_codes') return t('admin.courses.fields.isced_codes');
  if (key === 'attributes') return t('admin.wizard.steps.attributes');
  return fieldLabel(`/${key}`);
}

// ---------------------------------------------------------------------------
// ISCED codes, texts, attributes

function broadFieldOf(code: string): string | null {
  const c = code.trim();
  if (c.length < 2 || !/^\d+$/.test(c)) return null;
  const field = props.reference.isced_broad_fields.find((f) => f.code === c.slice(0, 2));
  return field
    ? t('admin.courses.broadField', {
        code: field.code,
        label: adminLabel(field.label, locale.value),
      })
    : t('admin.courses.broadFieldUnknown', { code: c.slice(0, 2) });
}

function addIsced() {
  form.value.isced.push({ code: '' });
  const index = form.value.isced.length - 1;
  void nextTick(() => document.getElementById(fid(`/isced_codes/${index}/code`))?.focus());
}

function removeIsced(index: number) {
  form.value.isced.splice(index, 1);
  if (!form.value.isced.length) form.value.isced.push({ code: '' });
  if (form.value.isced_primary >= form.value.isced.length || form.value.isced_primary === index) {
    form.value.isced_primary = 0;
  } else if (form.value.isced_primary > index) {
    form.value.isced_primary--;
  }
  void nextTick(() => document.getElementById(fid('/isced_codes/0/code'))?.focus());
}

function addLanguage(tag: string) {
  if (!form.value.texts[tag]) form.value.texts[tag] = emptyCourseText();
}

function removeLanguage(tag: string) {
  if (tag === 'en') return;
  const texts = { ...form.value.texts };
  delete texts[tag];
  form.value.texts = texts;
}

const mainTextFields = COURSE_MAIN_TEXT_FIELDS;
const moreTextFields = COURSE_MORE_TEXT_FIELDS;
const TEXT_HINTS: Partial<Record<CourseTextField, string>> = {
  keywords: 'admin.courses.hints.keywords',
  mode_of_repetition: 'admin.courses.hints.mode_of_repetition',
  privacy_notice: 'admin.courses.hints.privacy_notice',
};
const textHint = (field: CourseTextField) => {
  const key = TEXT_HINTS[field];
  return key ? t(key) : undefined;
};

function onMoreToggle(lang: string, event: Event) {
  const open = (event.target as HTMLDetailsElement).open;
  if (open === moreOpen.value.has(lang)) return;
  const next = new Set(moreOpen.value);
  if (open) next.add(lang);
  else next.delete(lang);
  moreOpen.value = next;
}

function setText(lang: string, field: CourseTextField, value: string) {
  const text = (form.value.texts[lang] ??= emptyCourseText());
  text[field] = value;
}

const attributeText = (key: string) => {
  const value = form.value.attributes[key];
  return typeof value === 'string' ? value : '';
};
const attributeList = (key: string) => {
  const value = form.value.attributes[key];
  return Array.isArray(value) ? value : [];
};
function setAttribute(key: string, value: AdminAttributeValue | undefined) {
  form.value.attributes = { ...form.value.attributes, [key]: value };
}
/** Boolean attributes are tri-state: not set (omitted), yes (`true`) or no (`false`). */
type BooleanChoice = 'unset' | 'yes' | 'no';
const BOOLEAN_CHOICES: readonly BooleanChoice[] = ['unset', 'yes', 'no'];
const booleanChoice = (key: string): BooleanChoice => {
  const value = form.value.attributes[key];
  return value === true ? 'yes' : value === false ? 'no' : 'unset';
};
function setBoolean(key: string, choice: BooleanChoice) {
  setAttribute(key, choice === 'yes' ? true : choice === 'no' ? false : undefined);
}
const booleanLabel = (choice: BooleanChoice) =>
  choice === 'yes'
    ? t('admin.courses.attributeYes')
    : choice === 'no'
      ? t('admin.courses.attributeNo')
      : t('admin.courses.attributeNotSet');

// ---------------------------------------------------------------------------
// Navigation and saving

async function goTo(index: number, focus = true) {
  step.value = index;
  reachable.value = Math.max(reachable.value, index);
  if (focus) {
    await nextTick();
    stepHeading.value?.focus();
  }
}

function validate(stepIndex?: number): FormIssue[] {
  return validateCourseForm(form.value, {
    reference: props.reference,
    creating: creating.value,
    ...(stepIndex === undefined ? {} : { step: stepIndex }),
    ...(overridesMode.value ? { only: onlyToggled } : {}),
  });
}

async function next() {
  const found = validate(step.value);
  if (found.length) {
    showIssues(found);
    return;
  }
  issues.value = [];
  await goTo(Math.min(step.value + 1, COURSE_STEPS.length - 1));
}

async function back() {
  issues.value = issues.value.filter((i) => courseFieldStep(i.field) !== step.value);
  await goTo(Math.max(0, step.value - 1));
}

async function selectStep(index: number) {
  await goTo(index);
}

function onSubmit() {
  if (creating.value && step.value < COURSE_STEPS.length - 1) void next();
  else void save();
}

async function save() {
  result.value = null;
  failure.value = null;
  const found = validate();
  if (found.length) {
    showIssues(found);
    return;
  }
  issues.value = [];
  const course = props.course;
  if (overridesMode.value && course) {
    const patch = pendingPatch.value;
    if (!Object.keys(patch.set).length && !patch.clear.length) {
      announce(t('admin.courses.nothingToSave'));
      return;
    }
  }
  saving.value = true;
  try {
    if (!course) {
      const created = await coursesApi.create(props.orgId, courseInputFromForm(form.value));
      emit('saved', created, 'created');
    } else if (overridesMode.value) {
      const updated = await coursesApi.patchOverrides(course.id, pendingPatch.value);
      announce(t('admin.courses.overridesSaved'));
      emit('saved', updated, 'overridden');
    } else {
      const updated = await coursesApi.update(course.id, courseInputFromForm(form.value));
      announce(t('admin.courses.saved'));
      emit('saved', updated, 'updated');
    }
  } catch (error) {
    const e = asAdminApiError(error);
    const { mapped, unmapped } = mapServerIssues(e);
    if (mapped.length) showIssues(mapped);
    if (unmapped) failure.value = e;
  } finally {
    saving.value = false;
  }
}

function announce(message: string) {
  result.value = message;
  resultKey.value++;
}

const failureMessageKey = computed(() =>
  failure.value?.codes.includes('oecp.sync.channel_disabled')
    ? 'admin.courses.channelDisabled'
    : undefined,
);

// Review
const reviewInput = computed(() => courseInputFromForm(form.value));
const reviewTitles = computed(() =>
  Object.entries(reviewInput.value.texts).map(([lang, text]) => ({
    lang,
    language: languageOptions.value.find((l) => l.tag === lang)?.label ?? lang,
    title: text.title,
  })),
);
const statusOptions = ['draft', 'published'] as const;

/** Completeness of the saved course (null for a new course or an older API). */
const completeness = computed(() => {
  const value = props.course?.completeness;
  if (!value || typeof value !== 'object') return null;
  const missing = Array.isArray(value.missing)
    ? value.missing.filter((k): k is string => typeof k === 'string' && k !== '')
    : [];
  const complete = typeof value.complete === 'boolean' ? value.complete : !missing.length;
  return { complete, missing };
});
const missingLabel = (key: string) =>
  completenessFieldLabel(
    key,
    t,
    te,
    (tag) => languageOptions.value.find((l) => l.tag === tag)?.label ?? tag,
  );
</script>

<template>
  <div class="admin-wizard">
    <div v-if="overridesMode" class="notice admin-override-banner">
      <p>
        <strong>{{ t('admin.courses.harvestedHeading') }}</strong>
      </p>
      <p>{{ t('admin.courses.harvestedBanner') }}</p>
    </div>

    <AdminWizardSteps
      :label="t('admin.wizard.label')"
      :steps="stepNames"
      :current="step"
      :reachable="reachable"
      :invalid="invalidSteps"
      @select="selectStep"
    />

    <AdminErrorSummary
      :key="summaryKey"
      :heading="t('admin.form.errorSummary', { n: issues.length }, issues.length)"
      :issues="summary"
      @select="focusField"
    />
    <AdminProblem
      v-if="failure"
      :error="failure"
      :heading="t('admin.courses.saveFailed')"
      :message-key="failureMessageKey"
    />
    <AdminMessage v-if="result" :key="resultKey" class="admin-save-result">
      <p>{{ result }}</p>
    </AdminMessage>

    <form
      class="admin-form"
      novalidate
      :aria-busy="saving ? 'true' : undefined"
      @submit.prevent="onSubmit"
    >
      <!-- Step 1: Basics -->
      <section v-if="step === 0" aria-labelledby="course-step-heading">
        <h2 id="course-step-heading" ref="stepHeading" tabindex="-1">
          {{ t('admin.wizard.stepHeading', { n: 1, total: 4, name: stepNames[0] }) }}
        </h2>

        <AdminInputField
          v-if="creating"
          :id="fid('/ext_id')"
          v-model="form.ext_id"
          :label="t('admin.courses.fields.ext_id')"
          :hint="t('admin.courses.hints.ext_id')"
          :error="err('/ext_id')"
          required
          :maxlength="200"
        />
        <dl v-else class="facts">
          <dt>{{ t('admin.courses.fields.ext_id') }}</dt>
          <dd>
            <code :id="fid('/ext_id')" tabindex="-1">{{ form.ext_id }}</code>
            <AdminFieldError :id="`${fid('/ext_id')}-error`" :message="err('/ext_id')" />
          </dd>
        </dl>

        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('kind')"
          :enabled="overridesMode"
          :field-id="fid('/kind')"
          :label="t('admin.courses.fields.kind')"
          :source="sourceText('kind')"
          :stored="stored.has('kind')"
          @update:model-value="setOverride('kind', $event)"
        >
          <AdminInputField
            :id="fid('/kind')"
            v-model="form.kind"
            as="select"
            :options="kindOptions"
            :label="t('admin.courses.fields.kind')"
            :error="err('/kind')"
            :disabled="disabled"
            :described-by="describedBy"
            required
          />
        </AdminOverrideField>

        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('levels')"
          :enabled="overridesMode"
          :field-id="fid('/levels')"
          :label="t('admin.courses.fields.levels')"
          :source="sourceText('levels')"
          :stored="stored.has('levels')"
          @update:model-value="setOverride('levels', $event)"
        >
          <AdminCheckboxGroup
            :id="fid('/levels')"
            v-model="form.levels"
            :legend="t('admin.courses.fields.levels')"
            :hint="t('admin.courses.hints.levels')"
            :options="levelOptions"
            :error="err('/levels')"
            :disabled="disabled"
            :described-by="describedBy"
          />
        </AdminOverrideField>

        <div class="admin-form__row">
          <AdminOverrideField
            v-slot="{ disabled, describedBy }"
            :model-value="isOn('ects')"
            :enabled="overridesMode"
            :field-id="fid('/ects')"
            :label="t('admin.courses.fields.ects')"
            :source="sourceText('ects')"
            :stored="stored.has('ects')"
            @update:model-value="setOverride('ects', $event)"
          >
            <AdminInputField
              :id="fid('/ects')"
              v-model="form.ects"
              :label="t('admin.courses.fields.ects')"
              :hint="t('admin.courses.hints.ects')"
              :error="err('/ects')"
              :disabled="disabled"
              :described-by="describedBy"
              inputmode="decimal"
              required
            />
          </AdminOverrideField>
          <AdminOverrideField
            v-slot="{ disabled, describedBy }"
            :model-value="isOn('teaching_hours')"
            :enabled="overridesMode"
            :field-id="fid('/teaching_hours')"
            :label="t('admin.courses.fields.teaching_hours')"
            :source="sourceText('teaching_hours')"
            :stored="stored.has('teaching_hours')"
            @update:model-value="setOverride('teaching_hours', $event)"
          >
            <AdminInputField
              :id="fid('/teaching_hours')"
              v-model="form.teaching_hours"
              :label="t('admin.courses.fields.teaching_hours')"
              :error="err('/teaching_hours')"
              :disabled="disabled"
              :described-by="describedBy"
              inputmode="decimal"
            />
          </AdminOverrideField>
        </div>

        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('isced_codes')"
          :enabled="overridesMode"
          :field-id="fid('/isced_codes')"
          :label="t('admin.courses.fields.isced_codes')"
          :source="sourceText('isced_codes')"
          :stored="stored.has('isced_codes')"
          @update:model-value="setOverride('isced_codes', $event)"
        >
          <fieldset
            :id="fid('/isced_codes')"
            class="admin-fieldset"
            :disabled="disabled"
            :aria-describedby="
              [`${fid('/isced_codes')}-hint`, describedBy].filter(Boolean).join(' ')
            "
          >
            <legend>
              {{ t('admin.courses.fields.isced_codes') }}
              <span class="admin-required">{{ t('admin.form.required') }}</span>
            </legend>
            <p :id="`${fid('/isced_codes')}-hint`" class="admin-hint">
              {{ t('admin.courses.hints.isced_codes') }}
            </p>
            <ul class="admin-isced">
              <li v-for="(row, index) in form.isced" :key="index" class="admin-isced__row">
                <AdminInputField
                  :id="fid(`/isced_codes/${index}/code`)"
                  v-model="row.code"
                  :label="t('admin.courses.iscedCode', { n: index + 1 })"
                  :hint="broadFieldOf(row.code) ?? undefined"
                  :error="err(`/isced_codes/${index}/code`)"
                  inputmode="numeric"
                  :maxlength="6"
                />
                <div class="admin-isced__primary">
                  <input
                    :id="`${fid(`/isced_codes/${index}`)}-primary`"
                    v-model="form.isced_primary"
                    type="radio"
                    name="course-isced-primary"
                    :value="index"
                  />
                  <label :for="`${fid(`/isced_codes/${index}`)}-primary`">
                    {{ t('admin.courses.iscedPrimary') }}
                    <span class="visually-hidden">{{
                      t('admin.courses.iscedCode', { n: index + 1 })
                    }}</span>
                  </label>
                </div>
                <button
                  v-if="form.isced.length > 1"
                  type="button"
                  class="button button--secondary"
                  @click="removeIsced(index)"
                >
                  {{ t('admin.courses.iscedRemove', { n: index + 1 }) }}
                </button>
              </li>
            </ul>
            <p class="admin-actions">
              <button type="button" class="button button--secondary" @click="addIsced">
                {{ t('admin.courses.iscedAdd') }}
              </button>
            </p>
            <details class="admin-details">
              <summary>{{ t('admin.courses.broadFieldsList') }}</summary>
              <ul>
                <li v-for="f in props.reference.isced_broad_fields" :key="f.code">
                  <code>{{ f.code }}</code> {{ adminLabel(f.label, locale) }}
                </li>
              </ul>
            </details>
          </fieldset>
        </AdminOverrideField>

        <AdminInputField
          :id="fid('/teaching_unit_ext_id')"
          v-model="form.teaching_unit_ext_id"
          as="select"
          :options="unitOptions"
          :label="t('admin.courses.fields.teaching_unit_ext_id')"
          :hint="overridesMode ? t('admin.courses.hints.notOverridable') : undefined"
          :error="err('/teaching_unit_ext_id')"
          :disabled="overridesMode"
        />

        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('info_url')"
          :enabled="overridesMode"
          :field-id="fid('/info_url')"
          :label="t('admin.courses.fields.info_url')"
          :source="sourceText('info_url')"
          :stored="stored.has('info_url')"
          @update:model-value="setOverride('info_url', $event)"
        >
          <AdminInputField
            :id="fid('/info_url')"
            v-model="form.info_url"
            type="url"
            inputmode="url"
            :label="t('admin.courses.fields.info_url')"
            :hint="t('admin.courses.hints.https')"
            :error="err('/info_url')"
            :disabled="disabled"
            :described-by="describedBy"
            :maxlength="2048"
          />
        </AdminOverrideField>

        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('instructors')"
          :enabled="overridesMode"
          :field-id="fid('/instructors')"
          :label="t('admin.courses.fields.instructors')"
          :source="sourceText('instructors')"
          :stored="stored.has('instructors')"
          @update:model-value="setOverride('instructors', $event)"
        >
          <AdminInputField
            :id="fid('/instructors')"
            v-model="form.instructors"
            as="textarea"
            :rows="3"
            :label="t('admin.courses.fields.instructors')"
            :hint="
              t('admin.courses.hints.instructors', {
                max: INSTRUCTORS_MAX,
                length: INSTRUCTOR_NAME_MAX,
              })
            "
            :error="err('/instructors')"
            :disabled="disabled"
            :described-by="describedBy"
          />
        </AdminOverrideField>

        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('contact_email')"
          :enabled="overridesMode"
          :field-id="fid('/contact_email')"
          :label="t('admin.courses.fields.contact_email')"
          :source="sourceText('contact_email')"
          :stored="stored.has('contact_email')"
          @update:model-value="setOverride('contact_email', $event)"
        >
          <AdminInputField
            :id="fid('/contact_email')"
            v-model="form.contact_email"
            type="email"
            inputmode="email"
            autocomplete="email"
            :label="t('admin.courses.fields.contact_email')"
            :error="err('/contact_email')"
            :disabled="disabled"
            :described-by="describedBy"
            :maxlength="320"
          />
        </AdminOverrideField>
      </section>

      <!-- Step 2: Texts -->
      <section v-else-if="step === 1" aria-labelledby="course-step-heading">
        <h2 id="course-step-heading" ref="stepHeading" tabindex="-1">
          {{ t('admin.wizard.stepHeading', { n: 2, total: 4, name: stepNames[1] }) }}
        </h2>
        <p class="admin-hint">
          {{ t('admin.courses.hints.texts') }}
        </p>
        <AdminLanguageTabs
          id="course-texts"
          v-model="activeLang"
          :label="t('admin.courses.textLanguages')"
          :languages="textLanguages"
          :available="languageOptions"
          :required="['en']"
          :invalid="invalidLanguages"
          :fixed="overridesMode"
          @add="addLanguage"
          @remove="removeLanguage"
        >
          <template #default="{ lang }">
            <template v-for="field in mainTextFields" :key="`${lang}-${field}`">
              <AdminOverrideField
                v-slot="{ disabled, describedBy }"
                :model-value="isOn(`texts.${lang}.${field}`)"
                :enabled="overridesMode"
                :field-id="fid(`/texts/${lang}/${field}`)"
                :label="fieldLabel(`/texts/${lang}/${field}`)"
                :source="sourceText(`texts.${lang}.${field}`)"
                :stored="stored.has(`texts.${lang}.${field}`)"
                @update:model-value="setOverride(`texts.${lang}.${field}`, $event)"
              >
                <AdminInputField
                  :id="fid(`/texts/${lang}/${field}`)"
                  :model-value="form.texts[lang]?.[field] ?? ''"
                  :as="field === 'title' ? 'input' : 'textarea'"
                  :rows="field === 'keywords' ? 2 : 5"
                  :label="fieldLabel(`/texts/${lang}/${field}`)"
                  :hint="textHint(field)"
                  :error="err(`/texts/${lang}/${field}`)"
                  :required="field === 'title' && lang === 'en'"
                  :maxlength="field === 'title' ? 500 : undefined"
                  :disabled="disabled"
                  :described-by="describedBy"
                  :lang="lang"
                  @update:model-value="setText(lang, field, $event)"
                />
              </AdminOverrideField>
            </template>
            <details
              class="admin-details admin-more-texts"
              :open="moreOpen.has(lang)"
              @toggle="onMoreToggle(lang, $event)"
            >
              <summary>{{ t('admin.courses.moreTexts') }}</summary>
              <p class="admin-hint">{{ t('admin.courses.hints.moreTexts') }}</p>
              <template v-for="field in moreTextFields" :key="`${lang}-${field}`">
                <AdminOverrideField
                  v-slot="{ disabled, describedBy }"
                  :model-value="isOn(`texts.${lang}.${field}`)"
                  :enabled="overridesMode"
                  :field-id="fid(`/texts/${lang}/${field}`)"
                  :label="fieldLabel(`/texts/${lang}/${field}`)"
                  :source="sourceText(`texts.${lang}.${field}`)"
                  :stored="stored.has(`texts.${lang}.${field}`)"
                  @update:model-value="setOverride(`texts.${lang}.${field}`, $event)"
                >
                  <AdminInputField
                    :id="fid(`/texts/${lang}/${field}`)"
                    :model-value="form.texts[lang]?.[field] ?? ''"
                    as="textarea"
                    :rows="field === 'mode_of_repetition' ? 2 : 4"
                    :label="fieldLabel(`/texts/${lang}/${field}`)"
                    :hint="textHint(field)"
                    :error="err(`/texts/${lang}/${field}`)"
                    :disabled="disabled"
                    :described-by="describedBy"
                    :lang="lang"
                    @update:model-value="setText(lang, field, $event)"
                  />
                </AdminOverrideField>
              </template>
            </details>
          </template>
        </AdminLanguageTabs>
      </section>

      <!-- Step 3: Attributes -->
      <section v-else-if="step === 2" aria-labelledby="course-step-heading">
        <h2 id="course-step-heading" ref="stepHeading" tabindex="-1">
          {{ t('admin.wizard.stepHeading', { n: 3, total: 4, name: stepNames[2] }) }}
        </h2>
        <p v-if="!definitions.length">
          {{ t('admin.courses.noAttributes') }}
        </p>
        <AdminOverrideField
          v-else
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('attributes')"
          :enabled="overridesMode"
          :field-id="fid('/attributes')"
          :label="t('admin.wizard.steps.attributes')"
          :source="sourceText('attributes')"
          :stored="stored.has('attributes')"
          @update:model-value="setOverride('attributes', $event)"
        >
          <fieldset
            :id="fid('/attributes')"
            class="admin-fieldset admin-fieldset--plain"
            :disabled="disabled"
            :aria-describedby="describedBy"
          >
            <legend class="visually-hidden">
              {{ t('admin.wizard.steps.attributes') }}
            </legend>
            <template v-for="d in definitions" :key="d.key">
              <fieldset
                v-if="d.value_type === 'boolean'"
                :id="fid(`/attributes/${d.key}`)"
                class="admin-fieldset admin-fieldset--boolean"
                :aria-describedby="
                  [
                    d.description ? `${fid(`/attributes/${d.key}`)}-hint` : '',
                    err(`/attributes/${d.key}`) ? `${fid(`/attributes/${d.key}`)}-error` : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                "
              >
                <legend>{{ adminLabel(d.label, locale) }}</legend>
                <p
                  v-if="d.description"
                  :id="`${fid(`/attributes/${d.key}`)}-hint`"
                  class="admin-hint"
                >
                  {{ adminLabel(d.description, locale) }}
                </p>
                <AdminFieldError
                  :id="`${fid(`/attributes/${d.key}`)}-error`"
                  :message="err(`/attributes/${d.key}`)"
                />
                <ul class="admin-choices admin-choices--inline">
                  <li v-for="choice in BOOLEAN_CHOICES" :key="choice">
                    <input
                      :id="`${fid(`/attributes/${d.key}`)}-${choice}`"
                      type="radio"
                      :name="`course-attribute-${d.key}`"
                      :value="choice"
                      :checked="booleanChoice(d.key) === choice"
                      @change="setBoolean(d.key, choice)"
                    />
                    <label :for="`${fid(`/attributes/${d.key}`)}-${choice}`">{{
                      booleanLabel(choice)
                    }}</label>
                  </li>
                </ul>
              </fieldset>
              <AdminInputField
                v-else-if="d.value_type === 'enum'"
                :id="fid(`/attributes/${d.key}`)"
                :model-value="attributeText(d.key)"
                as="select"
                :options="[
                  { value: '', label: t('admin.courses.attributeNotSet') },
                  ...(d.options ?? []).map((o) => ({
                    value: o.value,
                    label: adminLabel(o.label, locale),
                  })),
                ]"
                :label="adminLabel(d.label, locale)"
                :hint="d.description ? adminLabel(d.description, locale) : undefined"
                :error="err(`/attributes/${d.key}`)"
                @update:model-value="setAttribute(d.key, $event || undefined)"
              />
              <AdminCheckboxGroup
                v-else-if="d.value_type === 'multi_enum'"
                :id="fid(`/attributes/${d.key}`)"
                :model-value="attributeList(d.key)"
                :legend="adminLabel(d.label, locale)"
                :hint="d.description ? adminLabel(d.description, locale) : undefined"
                :options="
                  (d.options ?? []).map((o) => ({
                    value: o.value,
                    label: adminLabel(o.label, locale),
                  }))
                "
                :error="err(`/attributes/${d.key}`)"
                columns
                @update:model-value="setAttribute(d.key, $event.length ? $event : undefined)"
              />
              <AdminInputField
                v-else
                :id="fid(`/attributes/${d.key}`)"
                :model-value="attributeText(d.key)"
                :label="adminLabel(d.label, locale)"
                :hint="d.description ? adminLabel(d.description, locale) : undefined"
                :error="err(`/attributes/${d.key}`)"
                :maxlength="500"
                @update:model-value="setAttribute(d.key, $event === '' ? undefined : $event)"
              />
            </template>
          </fieldset>
        </AdminOverrideField>
      </section>

      <!-- Step 4: Review and status -->
      <section v-else aria-labelledby="course-step-heading">
        <h2 id="course-step-heading" ref="stepHeading" tabindex="-1">
          {{ t('admin.wizard.stepHeading', { n: 4, total: 4, name: stepNames[3] }) }}
        </h2>
        <section
          v-if="completeness"
          class="admin-card admin-completeness"
          aria-labelledby="course-completeness-heading"
        >
          <h3 id="course-completeness-heading">{{ t('admin.completeness.heading') }}</h3>
          <p v-if="completeness.complete">
            <AdminBadge tone="ok" :label="t('admin.completeness.complete')" />
            {{ t('admin.completeness.completeText') }}
          </p>
          <template v-else>
            <p>
              <AdminBadge
                tone="warn"
                :label="
                  t(
                    'admin.completeness.missingCount',
                    { n: completeness.missing.length },
                    completeness.missing.length,
                  )
                "
              />
              {{ t('admin.completeness.incompleteText') }}
            </p>
            <ul v-if="completeness.missing.length" class="admin-completeness__missing">
              <li v-for="key in completeness.missing" :key="key">{{ missingLabel(key) }}</li>
            </ul>
          </template>
          <p class="admin-hint">{{ t('admin.completeness.hint') }}</p>
        </section>
        <template v-if="overridesMode">
          <h3>{{ t('admin.courses.pendingHeading') }}</h3>
          <p v-if="!Object.keys(pendingPatch.set).length && !pendingPatch.clear.length">
            {{ t('admin.courses.nothingToSave') }}
          </p>
          <ul v-else class="admin-pending">
            <li v-for="(value, key) in pendingPatch.set" :key="`set-${key}`">
              {{
                t('admin.courses.pendingSet', {
                  field: overrideLabel(String(key)),
                  value: courseValueText(String(key), value, props.reference, t, locale),
                })
              }}
            </li>
            <li v-for="key in pendingPatch.clear" :key="`clear-${key}`">
              {{ t('admin.courses.pendingClear', { field: overrideLabel(key) }) }}
            </li>
          </ul>
        </template>
        <template v-else>
          <dl class="facts admin-review">
            <dt>{{ t('admin.courses.fields.ext_id') }}</dt>
            <dd>{{ reviewInput.ext_id }}</dd>
            <dt>{{ t('admin.courses.fields.kind') }}</dt>
            <dd>{{ courseValueText('kind', reviewInput.kind, props.reference, t, locale) }}</dd>
            <dt>{{ t('admin.courses.fields.levels') }}</dt>
            <dd>{{ courseValueText('levels', reviewInput.levels, props.reference, t, locale) }}</dd>
            <dt>{{ t('admin.courses.fields.ects') }}</dt>
            <dd>{{ form.ects }}</dd>
            <dt>{{ t('admin.courses.fields.teaching_hours') }}</dt>
            <dd>
              {{
                courseValueText(
                  'teaching_hours',
                  reviewInput.teaching_hours,
                  props.reference,
                  t,
                  locale,
                )
              }}
            </dd>
            <dt>{{ t('admin.courses.fields.isced_codes') }}</dt>
            <dd>
              {{
                courseValueText('isced_codes', reviewInput.isced_codes, props.reference, t, locale)
              }}
            </dd>
            <dt>{{ t('admin.courses.fields.teaching_unit_ext_id') }}</dt>
            <dd>
              {{
                courseValueText(
                  'teaching_unit_ext_id',
                  reviewInput.teaching_unit_ext_id,
                  props.reference,
                  t,
                  locale,
                )
              }}
            </dd>
            <dt>{{ t('admin.courses.fields.info_url') }}</dt>
            <dd>
              {{ courseValueText('info_url', reviewInput.info_url, props.reference, t, locale) }}
            </dd>
            <dt>{{ t('admin.courses.fields.instructors') }}</dt>
            <dd>
              {{
                courseValueText('instructors', reviewInput.instructors, props.reference, t, locale)
              }}
            </dd>
            <dt>{{ t('admin.courses.fields.contact_email') }}</dt>
            <dd>
              {{
                courseValueText(
                  'contact_email',
                  reviewInput.contact_email,
                  props.reference,
                  t,
                  locale,
                )
              }}
            </dd>
            <template v-for="row in reviewTitles" :key="row.lang">
              <dt>{{ t('admin.courses.reviewTitle', { language: row.language }) }}</dt>
              <dd :lang="row.lang">
                {{ row.title || t('admin.override.empty') }}
              </dd>
            </template>
            <dt>{{ t('admin.wizard.steps.attributes') }}</dt>
            <dd>{{ attributesText(reviewInput.attributes, props.reference, t, locale) }}</dd>
          </dl>
          <fieldset
            :id="fid('/status')"
            class="admin-fieldset"
            :aria-describedby="
              [`${fid('/status')}-hint`, err('/status') ? `${fid('/status')}-error` : '']
                .filter(Boolean)
                .join(' ')
            "
          >
            <legend>
              {{ t('admin.courses.fields.status') }}
              <span v-if="creating" class="admin-required">{{ t('admin.form.required') }}</span>
            </legend>
            <p :id="`${fid('/status')}-hint`" class="admin-hint">
              {{
                props.course && !form.status
                  ? t('admin.courses.hints.statusOther', {
                      status: t(`admin.lifecycle.${props.course.status}`),
                    })
                  : t('admin.courses.hints.status')
              }}
            </p>
            <AdminFieldError :id="`${fid('/status')}-error`" :message="err('/status')" />
            <ul class="admin-choices">
              <li v-for="s in statusOptions" :key="s">
                <input
                  :id="`${fid('/status')}-${s}`"
                  v-model="form.status"
                  type="radio"
                  name="course-status"
                  :value="s"
                />
                <label :for="`${fid('/status')}-${s}`">{{
                  t(`admin.courses.statusChoice.${s}`)
                }}</label>
              </li>
            </ul>
          </fieldset>
        </template>
      </section>

      <div class="admin-actions admin-wizard__nav">
        <button v-if="step > 0" type="button" class="button button--secondary" @click="back">
          {{ t('admin.wizard.back') }}
        </button>
        <button
          v-if="step < 3"
          type="button"
          class="button"
          :class="{ 'button--secondary': !creating }"
          @click="next"
        >
          {{ t('admin.wizard.next') }}
        </button>
        <button
          v-if="!creating || step === 3"
          type="button"
          class="button"
          :disabled="saving"
          @click="save"
        >
          {{
            saving
              ? t('admin.courses.saving')
              : creating
                ? t('admin.courses.create')
                : overridesMode
                  ? t('admin.courses.saveOverrides')
                  : t('admin.courses.save')
          }}
        </button>
      </div>
    </form>
  </div>
</template>
