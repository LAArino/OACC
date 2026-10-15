// SPDX-License-Identifier: EUPL-1.2
/**
 * Channel C, the web form (spec §6.4, §6.5, §8.1 "Course wizard"): request and
 * response contracts of `/api/admin/v1/organizations/{orgId}/courses…`,
 * `/api/admin/v1/courses/{id}…`, `/api/admin/v1/offerings/{id}…` and
 * `/api/admin/v1/organizations/{orgId}/reference`.
 *
 * Two modes, decided by the organization's authoritative channel (spec §6.5):
 *
 * - `write` (`csv`, `form` or no integration): the form creates and replaces
 *   records (`courseInput`, `offeringInput`); CSV and form write the same records.
 * - `overrides` (`oeapi`): the form only stores overrides on harvested records
 *   (`courseOverridesPatch`, `offeringOverridesPatch`); every harvest keeps them.
 *
 * Override keys: the column names of {@link COURSE_OVERRIDE_FIELDS} and
 * {@link OFFERING_OVERRIDE_FIELDS}, and `texts.<lang>.<field>` for course texts
 * ({@link TEXT_OVERRIDE_FIELDS}; `<lang>` is a primary language subtag). Values
 * have the shape of the same member of `courseInput`/`offeringInput`.
 *
 * Browser-safe (Zod only). Issue messages are stable error codes.
 */
import { z } from 'zod';
import { attributeDefinition, courseAttributes } from './attributes.js';
import { instructorList } from './canonical.js';
import type { CsvReferenceData } from './csv-validate.js';
import { courseKind, courseLevel, lifecycleStatus, sessionType, sourceChannel } from './enums.js';
import type { ErrorCode } from './error-codes.js';
import { courseCompleteness } from './handbook.js';
import {
  CODE_PATTERN,
  deliveryModeCode,
  email,
  httpsUrl,
  ianaTimeZone,
  ISCED_CODE_PATTERN,
  isoDate,
  isoDateTime,
  localizedLabel,
  uuid,
} from './primitives.js';

/** `sync_runs.schema_version` of form saves (DDL comment: 'form-1'). */
export const FORM_SCHEMA_VERSION = 'form-1';

/**
 * Languages offered by the form for course texts, teaching languages and
 * application instructions: EU/EEA languages (primary subtags), English labels.
 */
export const FORM_LANGUAGES = [
  { tag: 'en', label: 'English' },
  { tag: 'de', label: 'German' },
  { tag: 'fr', label: 'French' },
  { tag: 'es', label: 'Spanish' },
  { tag: 'ca', label: 'Catalan' },
  { tag: 'it', label: 'Italian' },
  { tag: 'nl', label: 'Dutch' },
  { tag: 'da', label: 'Danish' },
  { tag: 'is', label: 'Icelandic' },
  { tag: 'cs', label: 'Czech' },
  { tag: 'pt', label: 'Portuguese' },
  { tag: 'pl', label: 'Polish' },
  { tag: 'sv', label: 'Swedish' },
  { tag: 'fi', label: 'Finnish' },
  { tag: 'no', label: 'Norwegian' },
  { tag: 'el', label: 'Greek' },
  { tag: 'hu', label: 'Hungarian' },
  { tag: 'ro', label: 'Romanian' },
  { tag: 'bg', label: 'Bulgarian' },
  { tag: 'hr', label: 'Croatian' },
  { tag: 'sk', label: 'Slovak' },
  { tag: 'sl', label: 'Slovenian' },
  { tag: 'et', label: 'Estonian' },
  { tag: 'lv', label: 'Latvian' },
  { tag: 'lt', label: 'Lithuanian' },
  { tag: 'ga', label: 'Irish' },
  { tag: 'mt', label: 'Maltese' },
  { tag: 'eu', label: 'Basque' },
  { tag: 'gl', label: 'Galician' },
] as const;
export type FormLanguage = (typeof FORM_LANGUAGES)[number]['tag'];
export const FORM_LANGUAGE_TAGS = FORM_LANGUAGES.map((l) => l.tag) as [
  FormLanguage,
  ...FormLanguage[],
];

/** One of {@link FORM_LANGUAGES}. */
export const formLanguage = z.enum(FORM_LANGUAGE_TAGS, {
  error: 'oecp.content.unsupported_language',
});

/**
 * A map keyed by {@link formLanguage} (unknown keys → `oecp.content.unsupported_language`);
 * non-exhaustive, unlike a record over an enum.
 */
function languageRecord<T extends z.ZodType>(value: T) {
  return z.record(z.string(), value).superRefine((record, ctx) => {
    for (const key of Object.keys(record)) {
      if (!(FORM_LANGUAGE_TAGS as readonly string[]).includes(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'oecp.content.unsupported_language' });
      }
    }
  });
}

/** ISCED-F 2013 broad fields (seeded in `isced_broad_fields`, migration 0002). */
export const ISCED_BROAD_FIELD_CODES: readonly string[] = [
  '00',
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '99',
];

/** Course and offering codes, as `course_code`/`offering_code` of the CSV template. */
export const formCode = z.string().regex(CODE_PATTERN, { error: 'oecp.content.invalid_code' });

/** Trimmed; an empty string becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    });

/** At most `decimals` decimal places (DDL `numeric` scale; avoids silent rounding). */
const decimals = (n: number) => (v: number) => {
  const scaled = v * 10 ** n;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
};

const ects = z
  .number()
  .positive()
  .max(120)
  .refine(decimals(2), { error: 'oecp.content.invalid_value' });
const teachingHours = z
  .number()
  .positive()
  .max(99999.9)
  .refine(decimals(1), { error: 'oecp.content.invalid_value' });
const int32 = z.int().max(2_147_483_647);

/** Per-language course texts; `title` is required for every language given. */
export const courseTextInput = z.strictObject({
  title: z.string().trim().min(1).max(500),
  abstract: optionalText(20_000),
  description: optionalText(20_000),
  learning_outcomes: optionalText(20_000),
  prerequisites: optionalText(20_000),
  assessment: optionalText(20_000),
  /** Optional texts of the IT Handbook (decision 21b). */
  mode_of_repetition: optionalText(20_000),
  methods: optionalText(20_000),
  literature: optionalText(20_000),
  privacy_notice: optionalText(20_000),
  remarks: optionalText(20_000),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
});
export type CourseTextInput = z.input<typeof courseTextInput>;
export type CourseTextValue = z.output<typeof courseTextInput>;

export const iscedCodeInput = z.strictObject({
  code: z.string().regex(ISCED_CODE_PATTERN, { error: 'oecp.content.invalid_value' }),
  is_primary: z.boolean().default(false),
});
export type IscedCodeInput = z.input<typeof iscedCodeInput>;

/**
 * ISCED-F codes: 1–10, no duplicates, at most one `is_primary` (none: the first
 * is primary), known broad field (first two digits).
 */
export const iscedCodesInput = z
  .array(iscedCodeInput)
  .min(1)
  .max(10)
  .superRefine((codes, ctx) => {
    const seen = new Set<string>();
    codes.forEach((c, i) => {
      if (seen.has(c.code)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'code'],
          message: 'oecp.content.duplicate_isced',
        });
      }
      seen.add(c.code);
      if (
        ISCED_CODE_PATTERN.test(c.code) &&
        !ISCED_BROAD_FIELD_CODES.includes(c.code.slice(0, 2))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'code'],
          message: 'oecp.content.unknown_isced_field',
        });
      }
    });
    if (codes.filter((c) => c.is_primary).length > 1) {
      ctx.addIssue({ code: 'custom', path: [], message: 'oecp.content.invalid_value' });
    }
  })
  .transform((codes) => {
    const primary = Math.max(
      0,
      codes.findIndex((c) => c.is_primary),
    );
    return codes.map((c, i) => ({ code: c.code, is_primary: i === primary }));
  });

/** Every study cycle, primary first; no duplicates. */
const levelsInput = z
  .array(courseLevel)
  .min(1)
  .max(5)
  .refine((l) => new Set(l).size === l.length, { error: 'oecp.content.invalid_value' });

/**
 * Codes of the content rules of the course and offering bodies (English title to
 * publish, date order, seats, ISCED list). A body that is well formed and breaks
 * only these rules is answered 422 (content), not 400 (request shape), spec §6.6.
 */
export const CONTENT_RULE_CODES = [
  'oecp.content.english_missing',
  'oecp.content.date_order',
  'oecp.content.seats_exceed_capacity',
  'oecp.content.seats_without_timestamp',
  'oecp.content.duplicate_isced',
  'oecp.content.unknown_isced_field',
] as const satisfies readonly ErrorCode[];

/** Statuses a create or replace may set; `withdrawn`/`cancelled` via `…/status`. */
export const formWriteStatus = z.enum(['draft', 'published']);

/**
 * `POST /organizations/{orgId}/courses` and `PUT /courses/{id}` (full replace;
 * `ext_id` cannot change). `status` defaults to `draft` on create and keeps the
 * current status on replace. Publishing requires `texts.en`. A replace deletes
 * the languages it omits, except English. `attributes` are checked against the
 * alliance's definitions by the server ({@link buildAttributesSchema} in the browser).
 */
export const courseInput = z
  .strictObject({
    ext_id: formCode,
    status: formWriteStatus.optional(),
    kind: courseKind.default('course'),
    levels: levelsInput,
    eqf_level: z.int().min(1).max(8).nullable().optional(),
    ects,
    teaching_hours: teachingHours.nullable().optional(),
    info_url: httpsUrl.nullable().optional(),
    contact_email: email.nullable().optional(),
    /** `ext_id` of one of the organization's teaching units (`reference.teaching_units`). */
    teaching_unit_ext_id: formCode.nullable().optional(),
    isced_codes: iscedCodesInput,
    /**
     * Teaching staff (decision 21a): names or role descriptions as the university
     * publishes them, 1–200 characters each, at most 50, no duplicates.
     */
    instructors: instructorList.default([]),
    attributes: courseAttributes.default({}),
    /** Keyed by {@link formLanguage}. */
    texts: languageRecord(courseTextInput).default({}),
  })
  .superRefine((c, ctx) => {
    if (c.status === 'published' && !c.texts.en) {
      ctx.addIssue({
        code: 'custom',
        path: ['texts', 'en'],
        message: 'oecp.content.english_missing',
      });
    }
  });
export type CourseInput = z.input<typeof courseInput>;
export type CourseInputValue = z.output<typeof courseInput>;

/** Shared date and seat rules of offerings (DDL CHECKs), as issues on `ctx`. */
function checkOfferingRules(
  o: {
    start_date?: string | undefined;
    end_date?: string | undefined;
    enrol_start_date?: string | null | undefined;
    application_deadline?: string | null | undefined;
    max_students?: number | null | undefined;
    alliance_seats?: number | null | undefined;
    seats_available?: number | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (o.start_date && o.end_date && o.end_date < o.start_date) {
    issue('end_date', 'oecp.content.date_order');
  }
  if (o.application_deadline && o.end_date && o.application_deadline > o.end_date) {
    issue('application_deadline', 'oecp.content.date_order');
  }
  if (o.enrol_start_date && o.application_deadline && o.enrol_start_date > o.application_deadline) {
    issue('enrol_start_date', 'oecp.content.date_order');
  }
  if (o.alliance_seats != null && o.max_students != null && o.alliance_seats > o.max_students) {
    issue('alliance_seats', 'oecp.content.seats_exceed_capacity');
  }
  if (o.seats_available != null && o.max_students != null && o.seats_available > o.max_students) {
    issue('seats_available', 'oecp.content.seats_exceed_capacity');
  }
}

const uniqueList = <T extends z.ZodType<string>>(item: T, max: number) =>
  z
    .array(item)
    .min(1)
    .max(max)
    .refine((l) => new Set(l).size === l.length, { error: 'oecp.content.invalid_value' });

/**
 * `POST /courses/{id}/offerings` and `PUT /offerings/{id}` (full replace;
 * `ext_offering_id` cannot change). `timezone` defaults to the organization's;
 * `seats_available` sets `seats_updated_at` to the time of the save; an unknown
 * `academic_session_ext_id` creates a minimal session (type `period`, name = code,
 * the offering's dates), as CSV uploads do.
 */
export const offeringInput = z
  .strictObject({
    ext_offering_id: formCode,
    status: formWriteStatus.optional(),
    academic_session_ext_id: formCode.nullable().optional(),
    start_date: isoDate,
    end_date: isoDate,
    enrol_start_date: isoDate.nullable().optional(),
    application_deadline: isoDate.nullable().optional(),
    timezone: ianaTimeZone.optional(),
    teaching_languages: uniqueList(formLanguage, 10),
    /** Codes of `reference.delivery_modes`. */
    delivery_modes: uniqueList(deliveryModeCode, 10),
    campus: optionalText(200),
    max_students: int32.positive().nullable().optional(),
    alliance_seats: int32.nonnegative().nullable().optional(),
    seats_available: int32.nonnegative().nullable().optional(),
    application_url: httpsUrl.nullable().optional(),
    application_instructions: languageRecord(z.string().trim().min(1).max(20_000)).default({}),
  })
  .superRefine(checkOfferingRules);
export type OfferingInput = z.input<typeof offeringInput>;
export type OfferingInputValue = z.output<typeof offeringInput>;

/** `POST /courses/{id}/status` and `POST /offerings/{id}/status`. */
export const statusChangeRequest = z.strictObject({ status: lifecycleStatus });
export type StatusChangeRequest = z.infer<typeof statusChangeRequest>;

/* ------------------------------------------------------------------ overrides */

/** Course columns an override may replace. */
export const COURSE_OVERRIDE_FIELDS = [
  'status',
  'kind',
  'levels',
  'ects',
  'teaching_hours',
  'info_url',
  'contact_email',
  'attributes',
  'isced_codes',
  'instructors',
] as const;
export type CourseOverrideField = (typeof COURSE_OVERRIDE_FIELDS)[number];

/** Fields of `course_texts` an override may replace (`texts.<lang>.<field>`). */
export const TEXT_OVERRIDE_FIELDS = [
  'title',
  'abstract',
  'description',
  'learning_outcomes',
  'prerequisites',
  'assessment',
  'mode_of_repetition',
  'methods',
  'literature',
  'privacy_notice',
  'remarks',
  'keywords',
] as const;
export type TextOverrideField = (typeof TEXT_OVERRIDE_FIELDS)[number];

/** Offering columns an override may replace (`seats_updated_at` follows `seats_available`). */
export const OFFERING_OVERRIDE_FIELDS = [
  'status',
  'start_date',
  'end_date',
  'enrol_start_date',
  'application_deadline',
  'timezone',
  'teaching_languages',
  'delivery_modes',
  'campus',
  'max_students',
  'alliance_seats',
  'seats_available',
  'application_url',
  'application_instructions',
] as const;
export type OfferingOverrideField = (typeof OFFERING_OVERRIDE_FIELDS)[number];

export const TEXT_OVERRIDE_KEY_PATTERN = new RegExp(
  `^texts\\.([a-z]{2,3})\\.(${TEXT_OVERRIDE_FIELDS.join('|')})$`,
);

export type CourseOverrideKey =
  | { kind: 'course'; field: CourseOverrideField }
  | { kind: 'text'; lang: string; field: TextOverrideField };

/** `status` → course field; `texts.de.title` → text field; anything else → null. */
export function parseCourseOverrideKey(key: string): CourseOverrideKey | null {
  if ((COURSE_OVERRIDE_FIELDS as readonly string[]).includes(key)) {
    return { kind: 'course', field: key as CourseOverrideField };
  }
  const match = TEXT_OVERRIDE_KEY_PATTERN.exec(key);
  if (!match) return null;
  return { kind: 'text', lang: match[1] as string, field: match[2] as TextOverrideField };
}

export function courseOverrideKey(key: CourseOverrideKey): string {
  return key.kind === 'course' ? key.field : `texts.${key.lang}.${key.field}`;
}

const COURSE_OVERRIDE_VALUES: Record<CourseOverrideField, z.ZodType> = {
  status: lifecycleStatus,
  kind: courseKind,
  levels: levelsInput,
  ects,
  teaching_hours: teachingHours.nullable(),
  info_url: httpsUrl.nullable(),
  contact_email: email.nullable(),
  attributes: courseAttributes,
  isced_codes: iscedCodesInput,
  instructors: instructorList,
};

const TEXT_OVERRIDE_VALUES: Record<TextOverrideField, z.ZodType> = {
  title: courseTextInput.shape.title,
  abstract: optionalText(20_000),
  description: optionalText(20_000),
  learning_outcomes: optionalText(20_000),
  prerequisites: optionalText(20_000),
  assessment: optionalText(20_000),
  mode_of_repetition: optionalText(20_000),
  methods: optionalText(20_000),
  literature: optionalText(20_000),
  privacy_notice: optionalText(20_000),
  remarks: optionalText(20_000),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50),
};

const OFFERING_OVERRIDE_VALUES: Record<OfferingOverrideField, z.ZodType> = {
  status: lifecycleStatus,
  start_date: isoDate,
  end_date: isoDate,
  enrol_start_date: isoDate.nullable(),
  application_deadline: isoDate.nullable(),
  timezone: ianaTimeZone,
  teaching_languages: uniqueList(formLanguage, 10),
  delivery_modes: uniqueList(deliveryModeCode, 10),
  campus: optionalText(200),
  max_students: int32.positive().nullable(),
  alliance_seats: int32.nonnegative().nullable(),
  seats_available: int32.nonnegative().nullable(),
  application_url: httpsUrl.nullable(),
  application_instructions: languageRecord(z.string().trim().min(1).max(20_000)),
};

/** Value schema of a course override key, or undefined for an unknown key. */
export function courseOverrideValueSchema(key: string): z.ZodType | undefined {
  const parsed = parseCourseOverrideKey(key);
  if (!parsed) return undefined;
  return parsed.kind === 'course'
    ? COURSE_OVERRIDE_VALUES[parsed.field]
    : TEXT_OVERRIDE_VALUES[parsed.field];
}

/** Value schema of an offering override key, or undefined for an unknown key. */
export function offeringOverrideValueSchema(key: string): z.ZodType | undefined {
  return (OFFERING_OVERRIDE_FIELDS as readonly string[]).includes(key)
    ? OFFERING_OVERRIDE_VALUES[key as OfferingOverrideField]
    : undefined;
}

/**
 * `PATCH /courses/{id}/overrides` and `PATCH /offerings/{id}/overrides` (shape):
 * `set` stores overrides (`{key: value}`), `clear` removes them, restoring the
 * harvested value. A key may not be in both; at least one change is required.
 */
export const overridesPatch = z.strictObject({
  set: z.record(z.string(), z.unknown()).default({}),
  clear: z.array(z.string()).max(100).default([]),
});
export type OverridesPatch = z.input<typeof overridesPatch>;

function refinedPatch(schemaFor: (key: string) => z.ZodType | undefined) {
  return overridesPatch
    .superRefine((patch, ctx) => {
      const keys = Object.keys(patch.set);
      if (keys.length === 0 && patch.clear.length === 0) {
        ctx.addIssue({ code: 'custom', path: [], message: 'oecp.request.validation_failed' });
      }
      if (keys.length > 100) {
        ctx.addIssue({ code: 'custom', path: ['set'], message: 'oecp.request.validation_failed' });
      }
      for (const key of keys) {
        const schema = schemaFor(key);
        if (!schema) {
          ctx.addIssue({
            code: 'custom',
            path: ['set', key],
            message: 'oecp.content.override_not_allowed',
          });
          continue;
        }
        const result = schema.safeParse(patch.set[key]);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({
              code: 'custom',
              path: ['set', key, ...issue.path.map((p) => p as string | number)],
              message: issue.message,
            });
          }
        }
        if (patch.clear.includes(key)) {
          ctx.addIssue({ code: 'custom', path: ['clear'], message: 'oecp.content.invalid_value' });
        }
      }
      patch.clear.forEach((key, i) => {
        if (!schemaFor(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['clear', i],
            message: 'oecp.content.override_not_allowed',
          });
        }
      });
    })
    .transform((patch) => ({
      set: Object.fromEntries(
        Object.entries(patch.set).map(([key, value]) => [
          key,
          (schemaFor(key) as z.ZodType).parse(value),
        ]),
      ) as Record<string, unknown>,
      clear: [...new Set(patch.clear)],
    }));
}

/** Course overrides: keys of {@link COURSE_OVERRIDE_FIELDS} and `texts.<lang>.<field>`. */
export const courseOverridesPatch = refinedPatch(courseOverrideValueSchema);
/** Offering overrides: keys of {@link OFFERING_OVERRIDE_FIELDS}. */
export const offeringOverridesPatch = refinedPatch(offeringOverrideValueSchema);
export type ParsedOverridesPatch = z.output<typeof courseOverridesPatch>;

/* ------------------------------------------------------------------ responses */

const timestamp = isoDateTime;

/** Who set an override and when (`override_meta`; the value is in `overrides`). */
export const adminOverrideMeta = z.strictObject({ by: z.string(), at: timestamp });
export type AdminOverrideMeta = z.infer<typeof adminOverrideMeta>;

export const formMode = z.enum(['write', 'overrides']);
export type FormMode = z.infer<typeof formMode>;

export const adminCourseText = z.strictObject({
  title: z.string(),
  abstract: z.string().nullable(),
  description: z.string().nullable(),
  learning_outcomes: z.string().nullable(),
  prerequisites: z.string().nullable(),
  assessment: z.string().nullable(),
  mode_of_repetition: z.string().nullable(),
  methods: z.string().nullable(),
  literature: z.string().nullable(),
  privacy_notice: z.string().nullable(),
  remarks: z.string().nullable(),
  keywords: z.array(z.string()),
  is_machine_translated: z.boolean(),
});
export type AdminCourseText = z.infer<typeof adminCourseText>;

/** Effective values (source merged with overrides), plus overrides and their source values. */
export const adminOffering = z.strictObject({
  id: uuid,
  course_id: uuid,
  course_ext_id: z.string(),
  ext_offering_id: z.string(),
  source_ref: z.string().nullable(),
  source_channel: sourceChannel,
  status: lifecycleStatus,
  academic_session_id: uuid.nullable(),
  academic_session_ext_id: z.string().nullable(),
  academic_session: z
    .strictObject({ id: uuid, ext_id: z.string(), name: localizedLabel })
    .nullable(),
  start_date: isoDate,
  end_date: isoDate,
  enrol_start_date: isoDate.nullable(),
  application_deadline: isoDate.nullable(),
  timezone: z.string(),
  teaching_languages: z.array(z.string()),
  delivery_modes: z.array(z.string()),
  campus: z.string().nullable(),
  max_students: z.int().nullable(),
  alliance_seats: z.int().nullable(),
  seats_available: z.int().nullable(),
  seats_updated_at: timestamp.nullable(),
  application_url: z.string().nullable(),
  application_instructions: z.record(z.string(), z.string()),
  /**
   * Override values (shape of the `offeringInput` member), keyed by
   * {@link OFFERING_OVERRIDE_FIELDS} (plus `seats_updated_at` with `seats_available`).
   */
  overrides: z.record(z.string(), z.unknown()),
  override_meta: z.record(z.string(), adminOverrideMeta),
  /** Harvested (or CSV) value of every overridden field; null when the source has none. */
  source_values: z.record(z.string(), z.unknown()),
  absent_count: z.int(),
  created_at: timestamp,
  updated_at: timestamp,
  last_seen_at: timestamp.nullable(),
});
export type AdminOffering = z.infer<typeof adminOffering>;

/** `GET /courses/{id}` and the result of every course write. */
export const adminCourse = z.strictObject({
  id: uuid,
  organization_id: uuid,
  ext_id: z.string(),
  source_ref: z.string().nullable(),
  source_channel: sourceChannel,
  status: lifecycleStatus,
  kind: courseKind,
  /** Primary level, `levels[0]`. */
  level: courseLevel.nullable(),
  levels: z.array(courseLevel),
  eqf_level: z.int().nullable(),
  ects: z.number(),
  teaching_hours: z.number().nullable(),
  info_url: z.string().nullable(),
  contact_email: z.string().nullable(),
  teaching_unit_id: uuid.nullable(),
  teaching_unit_ext_id: z.string().nullable(),
  /** Primary first. */
  isced_codes: z.array(z.strictObject({ code: z.string(), is_primary: z.boolean() })),
  /** Teaching staff (decision 21a); may be empty. */
  instructors: z.array(z.string()),
  attributes: courseAttributes,
  /** Keyed by primary language subtag. */
  texts: z.record(z.string(), adminCourseText),
  /**
   * The IT Handbook publication rule on the effective values (decision 21c,
   * {@link completeness}): published offerings count; the organization's contact
   * satisfies a missing course contact.
   */
  completeness: courseCompleteness,
  /**
   * Override values (shape of the `courseInput` member; `isced_codes` as
   * `[{code, is_primary}]`), keyed by {@link COURSE_OVERRIDE_FIELDS} and
   * `texts.<lang>.<field>`. The effective values above already include them.
   */
  overrides: z.record(z.string(), z.unknown()),
  /** Same keys as `overrides`: who set each one and when. */
  override_meta: z.record(z.string(), adminOverrideMeta),
  /** Source value of every overridden key; null when the source has none (e.g. a language added by override). */
  source_values: z.record(z.string(), z.unknown()),
  offerings: z.array(adminOffering),
  absent_count: z.int(),
  created_at: timestamp,
  updated_at: timestamp,
  last_seen_at: timestamp.nullable(),
});
export type AdminCourse = z.infer<typeof adminCourse>;

const list = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(item).max(20));

/** Accepts both `status=a&status=b` and `status[]=a&status[]=b`. */
function mergeBracketParams(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    const key = name.endsWith('[]') ? name.slice(0, -2) : name;
    const prev = out[key];
    out[key] =
      prev === undefined
        ? value
        : [...(Array.isArray(prev) ? prev : [prev]), ...(Array.isArray(value) ? value : [value])];
  }
  return out;
}

export const ADMIN_COURSES_MAX_PAGE_SIZE = 100;

/** `GET /organizations/{orgId}/courses`: every status, deleted courses excluded. */
export const adminCourseListQuery = z.preprocess(
  mergeBracketParams,
  z.object({
    /** Case-insensitive match on the code or any title. */
    q: z.string().trim().max(200).optional(),
    status: list(lifecycleStatus),
    kind: list(courseKind),
    source_channel: list(sourceChannel),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    page_size: z.coerce.number().int().min(1).max(ADMIN_COURSES_MAX_PAGE_SIZE).default(20),
  }),
);
export type AdminCourseListQuery = z.output<typeof adminCourseListQuery>;

export const adminCourseListItem = z.strictObject({
  id: uuid,
  ext_id: z.string(),
  kind: courseKind,
  status: lifecycleStatus,
  source_channel: sourceChannel,
  /** English title, else the first language's; null for a course without texts. */
  title: z.string().nullable(),
  title_lang: z.string().nullable(),
  ects: z.number(),
  levels: z.array(courseLevel),
  updated_at: timestamp,
  /** Offerings not deleted, any status. */
  offerings_count: z.int().min(0),
  /** The course, one of its texts or one of its offerings carries an override. */
  has_overrides: z.boolean(),
  /** `completeness.complete` of the course (IT Handbook publication rule, decision 21c). */
  complete: z.boolean(),
  /** Number of entries of `completeness.missing`; 0 exactly when `complete`. */
  missing_count: z.int().min(0),
  /** Earliest start date today or later of a draft or published offering. */
  next_start_date: isoDate.nullable(),
});
export type AdminCourseListItem = z.infer<typeof adminCourseListItem>;

export const adminCourseList = z.strictObject({
  items: z.array(adminCourseListItem),
  page: z.int(),
  page_size: z.int(),
  total: z.int(),
});
export type AdminCourseList = z.infer<typeof adminCourseList>;

/** `GET /courses/{id}/history?limit`. */
export const adminCourseHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * One change of a course or one of its offerings: `history` = a payload accepted
 * or rejected from any channel (`ext_metadata_history`, body not included),
 * `audit` = an audit row (form saves, status changes, withdrawals by absence…).
 */
export const adminHistoryEntry = z.strictObject({
  kind: z.enum(['history', 'audit']),
  at: timestamp,
  /** JWT `sub`, or `system:<job>` (`system:harvester` for scheduled harvests). */
  actor: z.string(),
  /** `ingest.accepted`/`ingest.rejected`, or the audit action (`course.update`, `course.status`…). */
  action: z.string(),
  entity_type: z.enum(['course', 'course_offering']),
  entity_id: uuid.nullable(),
  /** Course code, or `<course code>#<offering code>` for offerings. */
  ext_id: z.string().nullable(),
  channel: sourceChannel.nullable(),
  sync_run_id: uuid.nullable(),
  /** One line in English, e.g. `Status published → withdrawn` or `Fields changed: ects, texts.en`. */
  summary: z.string(),
  /** Structured details (changed fields, status from/to, payload hash…), never a payload body. */
  details: z.record(z.string(), z.unknown()),
});
export type AdminHistoryEntry = z.infer<typeof adminHistoryEntry>;

export const adminCourseHistory = z.strictObject({ items: z.array(adminHistoryEntry) });
export type AdminCourseHistory = z.infer<typeof adminCourseHistory>;

/**
 * `GET /organizations/{orgId}/reference`: everything the course wizard and the
 * CSV console need for one organization (course codes excepted; see
 * {@link csvReferenceDataFromAdminReference}). Labels are `{en, …}` objects.
 */
export const adminReference = z.strictObject({
  organization_id: uuid,
  /** Default offering `timezone`. */
  default_timezone: z.string(),
  levels: z.array(courseLevel),
  kinds: z.array(z.strictObject({ code: courseKind, label: localizedLabel })),
  /** Active modes, by `sort_order`. */
  delivery_modes: z.array(z.strictObject({ code: z.string(), label: localizedLabel })),
  isced_broad_fields: z.array(z.strictObject({ code: z.string(), label: localizedLabel })),
  /** {@link FORM_LANGUAGES}. */
  languages: z.array(z.strictObject({ tag: z.string(), label: localizedLabel })),
  /** By `sort_order`, then key. */
  attribute_definitions: z.array(attributeDefinition),
  /** The organization's sessions (not deleted), latest start first. */
  academic_sessions: z.array(
    z.strictObject({
      id: uuid,
      ext_id: z.string(),
      name: localizedLabel,
      session_type: sessionType,
      start_date: isoDate,
      end_date: isoDate,
    }),
  ),
  /** Sub-units with an `ext_id` (`teaching_unit_ext_id`, CSV `teaching_unit_code`). */
  teaching_units: z.array(z.strictObject({ id: uuid, ext_id: z.string(), name: localizedLabel })),
  authoritative_channel: sourceChannel.nullable(),
  /** `overrides` when the authoritative channel is `oeapi`, else `write`. */
  form_mode: formMode,
});
export type AdminReference = z.infer<typeof adminReference>;

/** Reference data of the browser CSV validator from the admin reference (no course codes). */
export function csvReferenceDataFromAdminReference(
  reference: Pick<
    AdminReference,
    'isced_broad_fields' | 'delivery_modes' | 'teaching_units' | 'attribute_definitions'
  >,
): CsvReferenceData {
  return {
    iscedCodes: reference.isced_broad_fields.map((f) => f.code),
    deliveryModes: reference.delivery_modes.map((m) => m.code),
    teachingUnitCodes: reference.teaching_units.map((u) => u.ext_id),
    attributeDefinitions: reference.attribute_definitions,
  };
}
