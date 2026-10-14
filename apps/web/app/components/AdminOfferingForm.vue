<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Offering form of the course wizard (spec §6.4, §8.1): `OfferingInput` fields
// with the academic session (reference list or a typed code), dates, IANA time
// zone (organization default first), teaching languages and delivery modes as
// checkbox groups, seats, application URL and per-language application
// instructions. Overrides mode works as in the course wizard (`PATCH …/overrides`).
import type { AdminCourse, AdminCourseReference, AdminOffering } from '~/types/admin';

const props = defineProps<{
  reference: AdminCourseReference;
  course: AdminCourse;
  /** null: add an offering to the course. */
  offering: AdminOffering | null;
}>();
const emit = defineEmits<{
  saved: [offering: AdminOffering, outcome: 'created' | 'updated' | 'overridden'];
}>();
const { t, te, locale } = useI18n();
const coursesApi = useAdminCoursesApi();

const PREFIX = 'offering';
const creating = computed(() => props.offering === null);
const overridesMode = computed(() => !creating.value && props.reference.form_mode === 'overrides');

/** The organization's default time zone (canonical default as a fallback). */
const defaultTimezone = computed(() => props.reference.default_timezone || 'Europe/Brussels');

const form = ref<OfferingForm>(emptyOfferingForm(defaultTimezone.value));
let initial: OfferingForm = emptyOfferingForm(defaultTimezone.value);
const on = ref<Record<string, boolean>>({});
const stored = ref<Set<string>>(new Set());
const activeLang = ref('en');
const issues = ref<FormIssue[]>([]);
const summaryKey = ref(0);
const failure = ref<AdminApiError | null>(null);
const saving = ref(false);
const result = ref<string | null>(null);
const resultKey = ref(0);

function load() {
  const offering = props.offering;
  form.value = offering
    ? offeringFormFromOffering(offering, props.reference)
    : emptyOfferingForm(defaultTimezone.value);
  initial = JSON.parse(JSON.stringify(form.value)) as typeof initial;
  const keys = offering ? Object.keys(offering.overrides) : [];
  stored.value = new Set(keys);
  on.value = Object.fromEntries(keys.map((k) => [k, true]));
  if (!form.value.application_instructions[activeLang.value]) activeLang.value = 'en';
}
load();
watch(
  () => props.offering,
  () => {
    load();
    issues.value = [];
  },
);

// ---------------------------------------------------------------------------
// Options and labels

const sessionOptions = computed(() => [
  { value: '', label: t('admin.offerings.noSession') },
  ...props.reference.academic_sessions.map((s) => ({
    value: s.ext_id,
    label: `${adminLabel(s.name, locale.value)} (${s.ext_id})`,
  })),
  { value: OTHER_SESSION, label: t('admin.offerings.otherSession') },
]);
const timezones = computed(() =>
  timeZoneOptions([defaultTimezone.value, form.value.timezone]).map((z) => ({
    value: z,
    label: z === defaultTimezone.value ? t('admin.offerings.defaultTimezone', { zone: z }) : z,
  })),
);
const languageOptions = computed(() =>
  props.reference.languages.map((l) => ({ tag: l.tag, label: adminLabel(l.label, locale.value) })),
);
const teachingLanguageOptions = computed(() =>
  languageOptions.value.map((l) => ({ value: l.tag, label: l.label })),
);
const modeOptions = computed(() =>
  props.reference.delivery_modes.map((m) => ({
    value: m.code,
    label: adminLabel(m.label, locale.value),
  })),
);
const instructionLanguages = computed(() => {
  const langs = Object.keys(form.value.application_instructions);
  return ['en', ...langs.filter((l) => l !== 'en')];
});

function fieldLabel(pointer: string): string {
  const parts = pointer.split('/').filter(Boolean);
  const head = parts[0] ?? '';
  if (head === 'application_instructions' && parts[1]) {
    const language = languageOptions.value.find((l) => l.tag === parts[1])?.label ?? parts[1];
    return `${t('admin.offerings.fields.application_instructions')} (${language})`;
  }
  return te(`admin.offerings.fields.${head}`) ? t(`admin.offerings.fields.${head}`) : head;
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

function showIssues(list: FormIssue[]) {
  issues.value = list;
  summaryKey.value++;
}

async function focusField(id: string) {
  const issue = issues.value.find((i) => fid(i.field) === id);
  const lang = issue?.field.startsWith('/application_instructions/')
    ? issue.field.split('/')[2]
    : undefined;
  if (lang) activeLang.value = lang;
  await nextTick();
  const element = document.getElementById(id);
  const target =
    element && /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)
      ? element
      : element?.querySelector<HTMLElement>('input:not([disabled]), select, textarea');
  (target ?? element)?.focus();
}

function knownFields(): Set<string> {
  const known = new Set([
    '/ext_offering_id',
    '/status',
    '/academic_session_ext_id',
    ...OFFERING_FORM_OVERRIDE_FIELDS.map((k) => `/${k}`),
  ]);
  for (const lang of Object.keys(form.value.application_instructions)) {
    known.add(`/application_instructions/${lang}`);
  }
  return known;
}

function mapServerIssues(error: AdminApiError): { mapped: FormIssue[]; unmapped: boolean } {
  const known = knownFields();
  const mapped: FormIssue[] = [];
  let unmapped = false;
  const list = serverFormIssues(error.problem);
  for (const issue of list) {
    let field = resolveIssueField(issue.field, known);
    if (
      !field &&
      (issue.code === 'oecp.content.duplicate_ext_id' ||
        issue.code === 'oecp.content.ext_id_immutable')
    ) {
      field = '/ext_offering_id';
    }
    if (field === '/seats_updated_at') field = '/seats_available';
    if (field) mapped.push({ ...issue, field });
    else unmapped = true;
  }
  return { mapped, unmapped: unmapped || list.length === 0 };
}

// ---------------------------------------------------------------------------
// Overrides

const isOn = (key: string) => !!on.value[key];

function sourceText(key: string): string {
  const offering = props.offering;
  if (!offering) return '';
  return offeringValueText(
    key,
    offeringSourceValue(offering, key),
    props.reference,
    t,
    locale.value,
  );
}

function setOverride(key: string, value: boolean) {
  on.value = { ...on.value, [key]: value };
  if (!value && props.offering) {
    applyOfferingValue(form.value, key, offeringSourceValue(props.offering, key), props.reference);
  }
}

const pendingPatch = computed(() =>
  buildOverridesPatch(
    OFFERING_FORM_OVERRIDE_FIELDS,
    on.value,
    stored.value,
    (key) => offeringFormValue(form.value, key),
    (key) => offeringFormValue(initial, key),
  ),
);

// ---------------------------------------------------------------------------
// Instructions per language

function addLanguage(tag: string) {
  if (form.value.application_instructions[tag] === undefined) {
    form.value.application_instructions = { ...form.value.application_instructions, [tag]: '' };
  }
}

function removeLanguage(tag: string) {
  if (tag === 'en') return;
  const next = { ...form.value.application_instructions };
  delete next[tag];
  form.value.application_instructions = next;
}

function setInstructions(lang: string, value: string) {
  form.value.application_instructions = { ...form.value.application_instructions, [lang]: value };
}

// ---------------------------------------------------------------------------
// Saving

function announce(message: string) {
  result.value = message;
  resultKey.value++;
}

async function save() {
  result.value = null;
  failure.value = null;
  const found = validateOfferingForm(form.value, {
    creating: creating.value,
    ...(overridesMode.value ? { only: isOn } : {}),
  });
  if (found.length) {
    showIssues(found);
    return;
  }
  issues.value = [];
  const offering = props.offering;
  if (overridesMode.value) {
    const patch = pendingPatch.value;
    if (!Object.keys(patch.set).length && !patch.clear.length) {
      announce(t('admin.courses.nothingToSave'));
      return;
    }
  }
  saving.value = true;
  try {
    if (!offering) {
      const created = await coursesApi.createOffering(
        props.course.id,
        offeringInputFromForm(form.value),
      );
      emit('saved', created, 'created');
    } else if (overridesMode.value) {
      const updated = await coursesApi.patchOfferingOverrides(offering.id, pendingPatch.value);
      announce(t('admin.courses.overridesSaved'));
      emit('saved', updated, 'overridden');
    } else {
      const updated = await coursesApi.updateOffering(
        offering.id,
        offeringInputFromForm(form.value),
      );
      announce(t('admin.offerings.saved'));
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

const failureMessageKey = computed(() =>
  failure.value?.codes.includes('oecp.sync.channel_disabled')
    ? 'admin.courses.channelDisabled'
    : undefined,
);
const otherSession = OTHER_SESSION;
const statusOptions = ['draft', 'published'] as const;
const dateFields = ['start_date', 'end_date', 'enrol_start_date', 'application_deadline'] as const;
const seatFields = ['max_students', 'alliance_seats', 'seats_available'] as const;
</script>

<template>
  <div class="admin-offering-form">
    <div v-if="overridesMode" class="notice admin-override-banner">
      <p>
        <strong>{{ t('admin.courses.harvestedHeading') }}</strong>
      </p>
      <p>{{ t('admin.offerings.harvestedBanner') }}</p>
    </div>

    <AdminErrorSummary
      :key="summaryKey"
      :heading="t('admin.form.errorSummary', { n: issues.length }, issues.length)"
      :issues="summary"
      @select="focusField"
    />
    <AdminProblem
      v-if="failure"
      :error="failure"
      :heading="t('admin.offerings.saveFailed')"
      :message-key="failureMessageKey"
    />
    <AdminMessage v-if="result" :key="resultKey" class="admin-save-result">
      <p>{{ result }}</p>
    </AdminMessage>

    <form
      class="admin-form"
      novalidate
      :aria-busy="saving ? 'true' : undefined"
      @submit.prevent="save"
    >
      <section aria-labelledby="offering-identity-heading">
        <h2 id="offering-identity-heading">
          {{ t('admin.offerings.sections.identity') }}
        </h2>
        <AdminInputField
          v-if="creating"
          :id="fid('/ext_offering_id')"
          v-model="form.ext_offering_id"
          :label="t('admin.offerings.fields.ext_offering_id')"
          :hint="t('admin.offerings.hints.ext_offering_id')"
          :error="err('/ext_offering_id')"
          required
          :maxlength="200"
        />
        <dl v-else class="facts">
          <dt>{{ t('admin.offerings.fields.ext_offering_id') }}</dt>
          <dd>
            <code :id="fid('/ext_offering_id')" tabindex="-1">{{ form.ext_offering_id }}</code>
            <AdminFieldError
              :id="`${fid('/ext_offering_id')}-error`"
              :message="err('/ext_offering_id')"
            />
          </dd>
        </dl>

        <AdminInputField
          :id="
            form.session === otherSession
              ? `${fid('/academic_session_ext_id')}-select`
              : fid('/academic_session_ext_id')
          "
          v-model="form.session"
          as="select"
          :options="sessionOptions"
          :label="t('admin.offerings.fields.academic_session_ext_id')"
          :hint="overridesMode ? t('admin.courses.hints.notOverridable') : undefined"
          :error="form.session === otherSession ? null : err('/academic_session_ext_id')"
          :disabled="overridesMode"
        />
        <AdminInputField
          v-if="form.session === otherSession"
          :id="fid('/academic_session_ext_id')"
          v-model="form.session_other"
          :label="t('admin.offerings.fields.session_other')"
          :hint="t('admin.offerings.hints.session_other')"
          :error="err('/academic_session_ext_id')"
          :disabled="overridesMode"
          :maxlength="200"
          required
        />
      </section>

      <section aria-labelledby="offering-dates-heading">
        <h2 id="offering-dates-heading">
          {{ t('admin.offerings.sections.dates') }}
        </h2>
        <div class="admin-form__row">
          <AdminOverrideField
            v-for="key in dateFields"
            :key="key"
            v-slot="{ disabled, describedBy }"
            :model-value="isOn(key)"
            :enabled="overridesMode"
            :field-id="fid(`/${key}`)"
            :label="t(`admin.offerings.fields.${key}`)"
            :source="sourceText(key)"
            :stored="stored.has(key)"
            @update:model-value="setOverride(key, $event)"
          >
            <AdminInputField
              :id="fid(`/${key}`)"
              v-model="form[key]"
              type="date"
              :label="t(`admin.offerings.fields.${key}`)"
              :hint="
                key === 'application_deadline' ? t('admin.offerings.hints.deadline') : undefined
              "
              :error="err(`/${key}`)"
              :required="key === 'start_date' || key === 'end_date'"
              :disabled="disabled"
              :described-by="describedBy"
            />
          </AdminOverrideField>
        </div>
        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('timezone')"
          :enabled="overridesMode"
          :field-id="fid('/timezone')"
          :label="t('admin.offerings.fields.timezone')"
          :source="sourceText('timezone')"
          :stored="stored.has('timezone')"
          @update:model-value="setOverride('timezone', $event)"
        >
          <AdminInputField
            :id="fid('/timezone')"
            v-model="form.timezone"
            as="select"
            :options="timezones"
            :label="t('admin.offerings.fields.timezone')"
            :hint="t('admin.offerings.hints.timezone')"
            :error="err('/timezone')"
            :disabled="disabled"
            :described-by="describedBy"
            required
          />
        </AdminOverrideField>
      </section>

      <section aria-labelledby="offering-teaching-heading">
        <h2 id="offering-teaching-heading">
          {{ t('admin.offerings.sections.teaching') }}
        </h2>
        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('teaching_languages')"
          :enabled="overridesMode"
          :field-id="fid('/teaching_languages')"
          :label="t('admin.offerings.fields.teaching_languages')"
          :source="sourceText('teaching_languages')"
          :stored="stored.has('teaching_languages')"
          @update:model-value="setOverride('teaching_languages', $event)"
        >
          <AdminCheckboxGroup
            :id="fid('/teaching_languages')"
            v-model="form.teaching_languages"
            :legend="`${t('admin.offerings.fields.teaching_languages')} ${t('admin.form.required')}`"
            :options="teachingLanguageOptions"
            :error="err('/teaching_languages')"
            :disabled="disabled"
            :described-by="describedBy"
            columns
          />
        </AdminOverrideField>
        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('delivery_modes')"
          :enabled="overridesMode"
          :field-id="fid('/delivery_modes')"
          :label="t('admin.offerings.fields.delivery_modes')"
          :source="sourceText('delivery_modes')"
          :stored="stored.has('delivery_modes')"
          @update:model-value="setOverride('delivery_modes', $event)"
        >
          <AdminCheckboxGroup
            :id="fid('/delivery_modes')"
            v-model="form.delivery_modes"
            :legend="`${t('admin.offerings.fields.delivery_modes')} ${t('admin.form.required')}`"
            :options="modeOptions"
            :error="err('/delivery_modes')"
            :disabled="disabled"
            :described-by="describedBy"
          />
        </AdminOverrideField>
        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('campus')"
          :enabled="overridesMode"
          :field-id="fid('/campus')"
          :label="t('admin.offerings.fields.campus')"
          :source="sourceText('campus')"
          :stored="stored.has('campus')"
          @update:model-value="setOverride('campus', $event)"
        >
          <AdminInputField
            :id="fid('/campus')"
            v-model="form.campus"
            :label="t('admin.offerings.fields.campus')"
            :error="err('/campus')"
            :disabled="disabled"
            :described-by="describedBy"
            :maxlength="200"
          />
        </AdminOverrideField>
      </section>

      <section aria-labelledby="offering-seats-heading">
        <h2 id="offering-seats-heading">
          {{ t('admin.offerings.sections.seats') }}
        </h2>
        <div class="admin-form__row">
          <AdminOverrideField
            v-for="key in seatFields"
            :key="key"
            v-slot="{ disabled, describedBy }"
            :model-value="isOn(key)"
            :enabled="overridesMode"
            :field-id="fid(`/${key}`)"
            :label="t(`admin.offerings.fields.${key}`)"
            :source="sourceText(key)"
            :stored="stored.has(key)"
            @update:model-value="setOverride(key, $event)"
          >
            <AdminInputField
              :id="fid(`/${key}`)"
              v-model="form[key]"
              inputmode="numeric"
              :label="t(`admin.offerings.fields.${key}`)"
              :hint="t(`admin.offerings.hints.${key}`)"
              :error="err(`/${key}`)"
              :disabled="disabled"
              :described-by="describedBy"
            />
          </AdminOverrideField>
        </div>
      </section>

      <section aria-labelledby="offering-application-heading">
        <h2 id="offering-application-heading">
          {{ t('admin.offerings.sections.application') }}
        </h2>
        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('application_url')"
          :enabled="overridesMode"
          :field-id="fid('/application_url')"
          :label="t('admin.offerings.fields.application_url')"
          :source="sourceText('application_url')"
          :stored="stored.has('application_url')"
          @update:model-value="setOverride('application_url', $event)"
        >
          <AdminInputField
            :id="fid('/application_url')"
            v-model="form.application_url"
            type="url"
            inputmode="url"
            :label="t('admin.offerings.fields.application_url')"
            :hint="t('admin.courses.hints.https')"
            :error="err('/application_url')"
            :disabled="disabled"
            :described-by="describedBy"
            :maxlength="2048"
          />
        </AdminOverrideField>
        <AdminOverrideField
          v-slot="{ disabled, describedBy }"
          :model-value="isOn('application_instructions')"
          :enabled="overridesMode"
          :field-id="fid('/application_instructions')"
          :label="t('admin.offerings.fields.application_instructions')"
          :source="sourceText('application_instructions')"
          :stored="stored.has('application_instructions')"
          @update:model-value="setOverride('application_instructions', $event)"
        >
          <AdminLanguageTabs
            id="offering-instructions"
            v-model="activeLang"
            :label="t('admin.offerings.instructionLanguages')"
            :languages="instructionLanguages"
            :available="languageOptions"
            :required="['en']"
            :fixed="disabled"
            @add="addLanguage"
            @remove="removeLanguage"
          >
            <template #default="{ lang }">
              <AdminInputField
                :id="fid(`/application_instructions/${lang}`)"
                :model-value="form.application_instructions[lang] ?? ''"
                as="textarea"
                :rows="5"
                :label="fieldLabel(`/application_instructions/${lang}`)"
                :hint="t('admin.offerings.hints.application_instructions')"
                :error="err(`/application_instructions/${lang}`)"
                :disabled="disabled"
                :described-by="describedBy"
                :lang="lang"
                @update:model-value="setInstructions(lang, $event)"
              />
            </template>
          </AdminLanguageTabs>
        </AdminOverrideField>
      </section>

      <fieldset
        v-if="!overridesMode"
        :id="fid('/status')"
        class="admin-fieldset"
        :aria-describedby="err('/status') ? `${fid('/status')}-error` : undefined"
      >
        <legend>
          {{ t('admin.offerings.fields.status') }}
          <span v-if="creating" class="admin-required">{{ t('admin.form.required') }}</span>
        </legend>
        <p v-if="props.offering && !form.status" class="admin-hint">
          {{
            t('admin.offerings.hints.statusOther', {
              status: t(`admin.lifecycle.${props.offering.status}`),
            })
          }}
        </p>
        <AdminFieldError :id="`${fid('/status')}-error`" :message="err('/status')" />
        <ul class="admin-choices">
          <li v-for="s in statusOptions" :key="s">
            <input
              :id="`${fid('/status')}-${s}`"
              v-model="form.status"
              type="radio"
              name="offering-status"
              :value="s"
            />
            <label :for="`${fid('/status')}-${s}`">{{
              t(`admin.courses.statusChoice.${s}`)
            }}</label>
          </li>
        </ul>
      </fieldset>

      <div class="admin-actions">
        <button type="submit" class="button" :disabled="saving">
          {{
            saving
              ? t('admin.courses.saving')
              : creating
                ? t('admin.offerings.create')
                : overridesMode
                  ? t('admin.courses.saveOverrides')
                  : t('admin.offerings.save')
          }}
        </button>
      </div>
    </form>
  </div>
</template>
