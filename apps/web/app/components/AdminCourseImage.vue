<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// The image of an existing course [DL 27], a card of the wizard's Review step:
// preview, file (JPEG, PNG or WebP up to 5 MiB, checked here before any request),
// English alternative text or "decorative", and credit. Its buttons act at once,
// apart from the wizard's Save: `PUT …/image` (multipart), `PATCH …/image` (text
// only) and `DELETE …/image` (after a confirmation). Client checks mirror the
// server's; failures go through AdminProblem. After each action the course is
// read again and handed up (`changed`), so the page's history follows. Harvested
// courses use the same card: images are never harvested, so there is no source
// value to override.
import {
  COURSE_IMAGE_ALT_MAX,
  COURSE_IMAGE_CREDIT_MAX,
  COURSE_IMAGE_INPUT_TYPES,
  COURSE_IMAGE_MAX_BYTES,
  courseImagePath,
  type CourseImage,
  type CourseImagePatch,
} from '@oecp/schemas';
import type { AdminCourse } from '~/types/admin';

const props = defineProps<{
  course: AdminCourse;
  /** The organization's courses are harvested (overrides mode). */
  harvested?: boolean;
}>();
const emit = defineEmits<{ changed: [course: AdminCourse] }>();
const { t, locale } = useI18n();
const coursesApi = useAdminCoursesApi();
const { apiBase } = useRuntimeConfig().public;

const ID = 'course-image';
const ACCEPT = COURSE_IMAGE_INPUT_TYPES.join(',');
/** Extensions accepted when the browser reports no type for the file. */
const EXTENSIONS = /\.(jpe?g|png|webp)$/i;

type Field = 'file' | 'alt' | 'credit';
const image = computed<CourseImage | null>(() => props.course.image ?? null);
const file = ref<File | null>(null);
const alt = ref('');
const decorative = ref(false);
const credit = ref('');
/** The text typed before "decorative" was ticked, given back when it is unticked. */
let altBeforeDecorative = '';
const errors = ref<Partial<Record<Field, string>>>({});
const failure = ref<AdminApiError | null>(null);
const busy = ref(false);
const done = ref<string | null>(null);
const doneKey = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);
const confirm = ref<{
  ask: (o: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
} | null>(null);

function reset() {
  const current = image.value;
  alt.value = current?.decorative ? '' : (current?.alt.en ?? '');
  decorative.value = current?.decorative ?? false;
  credit.value = current?.credit ?? '';
  altBeforeDecorative = '';
  errors.value = {};
}
reset();
// Only a new or changed image resets the inputs (not every new course object).
watch(() => `${props.course.id}|${image.value?.key ?? ''}|${image.value?.updated_at ?? ''}`, reset);

watch(decorative, (value) => {
  if (value) {
    altBeforeDecorative = alt.value;
    alt.value = '';
    errors.value = { ...errors.value, alt: undefined };
  } else if (!alt.value) {
    alt.value = altBeforeDecorative;
  }
});

const previewUrl = computed(() =>
  image.value
    ? `${String(apiBase ?? '').replace(/\/$/, '')}${courseImagePath(props.course.id, image.value.key, 'sm')}`
    : '',
);
const previewAlt = computed(() =>
  image.value && !image.value.decorative ? (image.value.alt.en ?? '') : '',
);

/** Whether the text inputs differ from the stored image (enables "Save text"). */
const textChanged = computed(() => {
  const current = image.value;
  if (!current) return false;
  if (decorative.value !== current.decorative) return true;
  if (credit.value.trim() !== (current.credit ?? '')) return true;
  return !decorative.value && alt.value.trim() !== (current.alt.en ?? '');
});

// ---------------------------------------------------------------------------
// Checks (the server's rules, before any request)

function fileError(value: File | null): string | undefined {
  if (!value) return t('admin.courseImage.errors.fileRequired');
  const type = value.type.toLowerCase();
  const known = type
    ? (COURSE_IMAGE_INPUT_TYPES as readonly string[]).includes(type)
    : EXTENSIONS.test(value.name);
  if (!known) return t('admin.courseImage.errors.fileType');
  if (value.size > COURSE_IMAGE_MAX_BYTES) return t('admin.courseImage.errors.fileSize');
  return undefined;
}

function textErrors(): Partial<Record<Field, string>> {
  const found: Partial<Record<Field, string>> = {};
  const text = alt.value.trim();
  if (!decorative.value && !text) found.alt = t('admin.courseImage.errors.altRequired');
  else if (text.length > COURSE_IMAGE_ALT_MAX) {
    found.alt = t('admin.courseImage.errors.tooLong', { max: COURSE_IMAGE_ALT_MAX });
  }
  if (credit.value.trim().length > COURSE_IMAGE_CREDIT_MAX) {
    found.credit = t('admin.courseImage.errors.tooLong', { max: COURSE_IMAGE_CREDIT_MAX });
  }
  return found;
}

const FIELD_IDS: Record<Field, string> = {
  file: `${ID}-file`,
  alt: `${ID}-alt`,
  credit: `${ID}-credit`,
};

/** Shows the problems; focuses the first field that has one. */
async function report(found: Partial<Record<Field, string>>): Promise<boolean> {
  errors.value = found;
  const first = (['file', 'alt', 'credit'] as const).find((f) => found[f]);
  if (!first) return true;
  await nextTick();
  document.getElementById(FIELD_IDS[first])?.focus();
  return false;
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
  const problem = file.value ? fileError(file.value) : undefined;
  errors.value = { ...errors.value, file: problem };
}

/** Enter in a text input must not submit the wizard around this card. */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
}

// ---------------------------------------------------------------------------
// Actions

/** Reads the course again (the image and the history changed). */
async function refresh(updated: CourseImage | null) {
  try {
    emit('changed', await coursesApi.get(props.course.id));
  } catch {
    emit('changed', { ...props.course, image: updated });
  }
}

async function run(action: () => Promise<CourseImage | null>, message: string) {
  busy.value = true;
  failure.value = null;
  done.value = null;
  try {
    const updated = await action();
    file.value = null;
    if (fileInput.value) fileInput.value.value = '';
    await refresh(updated);
    done.value = message;
    doneKey.value++;
  } catch (error) {
    const e = asAdminApiError(error);
    if (e.codes.includes('oecp.media.alt_required')) {
      errors.value = { ...errors.value, alt: t('admin.courseImage.errors.altRequired') };
    }
    failure.value = e;
  } finally {
    busy.value = false;
  }
}

async function upload() {
  done.value = null;
  if (!(await report({ file: fileError(file.value), ...textErrors() }))) return;
  const form = new FormData();
  form.append('file', file.value as File);
  const text = alt.value.trim();
  if (!decorative.value && text) form.append('alt_en', text);
  form.append('decorative', decorative.value ? 'true' : 'false');
  const by = credit.value.trim();
  if (by) form.append('credit', by);
  const replacing = image.value !== null;
  await run(
    () => coursesApi.putImage(props.course.id, form),
    t(replacing ? 'admin.courseImage.replaced' : 'admin.courseImage.uploaded'),
  );
}

async function saveText() {
  const current = image.value;
  done.value = null;
  if (!current || !textChanged.value) return;
  if (!(await report(textErrors()))) return;
  const patch: CourseImagePatch = {
    alt: decorative.value ? {} : { ...current.alt, en: alt.value.trim() },
    decorative: decorative.value,
    credit: credit.value.trim() || null,
  };
  await run(() => coursesApi.patchImage(props.course.id, patch), t('admin.courseImage.textSaved'));
}

async function remove() {
  done.value = null;
  const ok = await confirm.value?.ask({
    title: t('admin.courseImage.removeTitle'),
    message: t('admin.courseImage.removeMessage', { code: props.course.ext_id }),
    confirmLabel: t('admin.courseImage.remove'),
    danger: true,
  });
  if (!ok) return;
  await run(async () => {
    await coursesApi.removeImage(props.course.id);
    return null;
  }, t('admin.courseImage.removed'));
}

const describedBy = (field: Field, hint = true) =>
  [hint ? `${FIELD_IDS[field]}-hint` : '', errors.value[field] ? `${FIELD_IDS[field]}-error` : '']
    .filter(Boolean)
    .join(' ') || undefined;
</script>

<template>
  <section
    class="admin-card admin-course-image"
    :aria-labelledby="`${ID}-heading`"
    :aria-busy="busy ? 'true' : undefined"
    @keydown="onKeydown"
  >
    <h3 :id="`${ID}-heading`">{{ t('admin.courseImage.heading') }}</h3>
    <p class="admin-hint">{{ t('admin.courseImage.intro') }}</p>
    <p class="admin-hint">{{ t('admin.courseImage.rights') }}</p>
    <p v-if="props.harvested" class="admin-hint">{{ t('admin.courseImage.harvested') }}</p>

    <AdminProblem v-if="failure" :error="failure" :heading="t('admin.courseImage.failed')" />
    <AdminMessage v-if="done" :key="doneKey">
      <p>{{ done }}</p>
    </AdminMessage>

    <figure v-if="image" class="admin-course-image__preview">
      <img
        :src="previewUrl"
        :alt="previewAlt"
        :width="image.width"
        :height="image.height"
        loading="lazy"
        decoding="async"
      />
      <figcaption>
        <dl class="facts">
          <template v-if="image.decorative">
            <dt>{{ t('admin.courseImage.altCurrent') }}</dt>
            <dd>{{ t('admin.courseImage.decorativeCurrent') }}</dd>
          </template>
          <template v-else>
            <dt>{{ t('admin.courseImage.altCurrent') }}</dt>
            <dd lang="en">{{ image.alt.en ?? t('admin.none') }}</dd>
          </template>
          <dt>{{ t('admin.courseImage.credit') }}</dt>
          <dd>{{ image.credit ?? t('admin.none') }}</dd>
          <dt>{{ t('admin.courseImage.size') }}</dt>
          <dd>
            {{ t('admin.courseImage.sizeValue', { width: image.width, height: image.height }) }}
          </dd>
          <dt>{{ t('admin.courseImage.source') }}</dt>
          <dd>
            {{
              image.source_url
                ? t('admin.courseImage.sourceCsv', { url: image.source_url })
                : t('admin.courseImage.sourceUpload')
            }}
          </dd>
          <dt>{{ t('admin.courseImage.updated') }}</dt>
          <dd>{{ formatAdminDateTime(image.updated_at, locale) }}</dd>
        </dl>
      </figcaption>
    </figure>
    <p v-else>{{ t('admin.courseImage.none') }}</p>

    <div class="admin-field" :class="{ 'admin-field--invalid': errors.file }">
      <label :for="FIELD_IDS.file">{{ t('admin.courseImage.file') }}</label>
      <p :id="`${FIELD_IDS.file}-hint`" class="admin-hint">
        {{ t('admin.courseImage.fileHint') }}
      </p>
      <AdminFieldError :id="`${FIELD_IDS.file}-error`" :message="errors.file" />
      <input
        :id="FIELD_IDS.file"
        ref="fileInput"
        type="file"
        name="file"
        :accept="ACCEPT"
        :disabled="busy"
        :aria-describedby="describedBy('file')"
        :aria-invalid="errors.file ? 'true' : undefined"
        @change="onFile"
      />
    </div>

    <AdminInputField
      :id="FIELD_IDS.alt"
      v-model="alt"
      :label="t('admin.courseImage.alt')"
      :hint="t('admin.courseImage.altHint', { max: COURSE_IMAGE_ALT_MAX })"
      :error="errors.alt"
      :required="!decorative"
      :disabled="decorative"
      :maxlength="COURSE_IMAGE_ALT_MAX"
      lang="en"
    />
    <div class="admin-check">
      <input
        :id="`${ID}-decorative`"
        v-model="decorative"
        type="checkbox"
        :aria-describedby="`${ID}-decorative-hint`"
      />
      <label :for="`${ID}-decorative`">{{ t('admin.courseImage.decorative') }}</label>
    </div>
    <p :id="`${ID}-decorative-hint`" class="admin-hint">
      {{ t('admin.courseImage.decorativeHint') }}
    </p>
    <AdminInputField
      :id="FIELD_IDS.credit"
      v-model="credit"
      :label="t('admin.courseImage.credit')"
      :hint="t('admin.courseImage.creditHint', { max: COURSE_IMAGE_CREDIT_MAX })"
      :error="errors.credit"
      :maxlength="COURSE_IMAGE_CREDIT_MAX"
    />

    <p class="admin-actions">
      <button type="button" class="button" :disabled="busy" @click="upload">
        {{ image ? t('admin.courseImage.replace') : t('admin.courseImage.upload') }}
      </button>
      <button
        v-if="image"
        type="button"
        class="button button--secondary"
        :disabled="busy || !textChanged"
        @click="saveText"
      >
        {{ t('admin.courseImage.saveText') }}
      </button>
      <button
        v-if="image"
        type="button"
        class="button button--secondary button--danger-text"
        :disabled="busy"
        @click="remove"
      >
        {{ t('admin.courseImage.remove') }}
      </button>
      <span v-if="busy" role="status">{{ t('admin.courseImage.working') }}</span>
    </p>
    <AdminConfirm ref="confirm" />
  </section>
</template>

<style scoped>
.admin-course-image__preview {
  margin: 0.5rem 0 1rem;
}
.admin-course-image__preview img {
  display: block;
  width: 100%;
  max-width: 24rem;
  height: auto;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border: 1px solid var(--c-divider);
  border-radius: var(--radius);
  background: var(--c-surface);
}
</style>
