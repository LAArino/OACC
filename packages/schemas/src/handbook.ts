// SPDX-License-Identifier: EUPL-1.2
/**
 * Publication rule of the Aurora IT Handbook §3.4 (decision 21c): a course is
 * shown only when every obligatory field of the agreed data model is present.
 * {@link completeness} is the single, pure definition of that rule; the writer
 * applies it on every channel (harvest, CSV, form) according to the deployment's
 * `OECP_PUBLISH_RULE` (spec §6.1):
 *
 * - `warn` (default, transition period): an incomplete course is published as
 *   before, with the warning `oecp.content.handbook_incomplete` in the run;
 * - `enforce`: the incomplete course is stored as `draft` with the same warning.
 *   It is never rejected, and harvests and uploads never fail because of it.
 *
 * Fields the handbook marks obligatory and OACC already requires for every
 * record (organization, course number, start and end dates, teaching language,
 * delivery mode) are listed too, so `missing` always names the handbook's field.
 *
 * Browser-safe (Zod only).
 */
import { z } from 'zod';
import { ERROR_CODES } from './error-codes.js';

export const PUBLISH_RULE_MODES = ['warn', 'enforce'] as const;
/** `OECP_PUBLISH_RULE`. */
export const publishRuleMode = z.enum(PUBLISH_RULE_MODES);
export type PublishRuleMode = z.infer<typeof publishRuleMode>;

/** Obligatory course fields, as `missing` names them (texts in English). */
export const HANDBOOK_COURSE_FIELDS = [
  'texts.en.title',
  'texts.en.description',
  'texts.en.learning_outcomes',
  'texts.en.prerequisites',
  'texts.en.assessment',
  'ects',
  'levels',
  'contact_email',
  'instructors',
] as const;

/** Obligatory fields of an offering; `missing` names them `offerings.<field>`. */
export const HANDBOOK_OFFERING_FIELDS = [
  'start_date',
  'end_date',
  'enrol_start_date',
  'application_deadline',
  'teaching_languages',
  'delivery_modes',
] as const;
export type HandbookOfferingField = (typeof HANDBOOK_OFFERING_FIELDS)[number];

/** Every value `missing` can contain; `offerings` = the course has no published offering. */
export const HANDBOOK_MISSING_FIELDS = [
  ...HANDBOOK_COURSE_FIELDS,
  'offerings',
  ...HANDBOOK_OFFERING_FIELDS.map((f) => `offerings.${f}` as const),
] as const;
export type HandbookMissingField = (typeof HANDBOOK_MISSING_FIELDS)[number];

/** English names of the handbook (§3.4) for each {@link HandbookMissingField}, for UIs and messages. */
export const HANDBOOK_FIELD_LABELS: Readonly<Record<HandbookMissingField, string>> = {
  'texts.en.title': 'Title (English)',
  'texts.en.description': 'Content (English description)',
  'texts.en.learning_outcomes': 'Learning outcomes (English)',
  'texts.en.prerequisites': 'Requirements (English prerequisites)',
  'texts.en.assessment': 'Assessment (English)',
  ects: 'ECTS credits',
  levels: 'Study cycle',
  contact_email: 'Contact',
  instructors: 'Instructors',
  offerings: 'A published offering',
  'offerings.start_date': 'Start date',
  'offerings.end_date': 'End date',
  'offerings.enrol_start_date': 'Application start',
  'offerings.application_deadline': 'Application deadline',
  'offerings.teaching_languages': 'Language of instruction',
  'offerings.delivery_modes': 'Mode of delivery',
};

/** Result of {@link completeness}; `missing` in the order of {@link HANDBOOK_MISSING_FIELDS}. */
export const courseCompleteness = z.strictObject({
  complete: z.boolean(),
  missing: z.array(z.enum(HANDBOOK_MISSING_FIELDS)),
});
export type CourseCompleteness = z.infer<typeof courseCompleteness>;

type Text = string | null | undefined;

/**
 * The course members the rule reads; the canonical DTO, the admin course and the
 * writer's effective values all fit.
 */
export interface CompletenessCourse {
  texts: Readonly<
    Record<
      string,
      | {
          title?: Text;
          description?: Text;
          learning_outcomes?: Text;
          prerequisites?: Text;
          assessment?: Text;
        }
      | undefined
    >
  >;
  ects?: number | null | undefined;
  levels?: readonly string[] | null | undefined;
  contact_email?: Text;
  instructors?: readonly string[] | null | undefined;
}

/** The offering members the rule reads; offerings without `status` count as published. */
export interface CompletenessOffering {
  status?: string | undefined;
  start_date?: Text;
  end_date?: Text;
  enrol_start_date?: Text;
  application_deadline?: Text;
  teaching_languages?: readonly string[] | null | undefined;
  delivery_modes?: readonly string[] | null | undefined;
}

export interface CompletenessOptions {
  /** The organization's contact: satisfies "Contact" when the course has none (spec §7.1). */
  organizationContactEmail?: Text;
}

const filled = (value: Text): boolean => typeof value === 'string' && value.trim() !== '';
const nonEmpty = (list: readonly string[] | null | undefined): boolean =>
  Array.isArray(list) && list.some((v) => typeof v === 'string' && v.trim() !== '');

function offeringMissing(o: CompletenessOffering): HandbookOfferingField[] {
  return HANDBOOK_OFFERING_FIELDS.filter((field) => {
    const value = o[field];
    return Array.isArray(value) ? !nonEmpty(value) : !filled(value as Text);
  });
}

/**
 * Whether a course meets the handbook publication rule (decision 21c). Course:
 * English title, description, learning outcomes, prerequisites and assessment;
 * ECTS; at least one study cycle; a contact (the course's, else the
 * organization's); at least one instructor. Offerings: at least one published
 * offering with start and end dates, application start, application deadline,
 * a teaching language and a delivery mode. When no published offering is
 * complete, the offering fields reported are those of the most complete one
 * (the first in the given order on a tie).
 */
export function completeness(
  course: CompletenessCourse,
  offerings: readonly CompletenessOffering[],
  options: CompletenessOptions = {},
): CourseCompleteness {
  const missing: HandbookMissingField[] = [];
  const en = course.texts['en'];
  if (!filled(en?.title)) missing.push('texts.en.title');
  if (!filled(en?.description)) missing.push('texts.en.description');
  if (!filled(en?.learning_outcomes)) missing.push('texts.en.learning_outcomes');
  if (!filled(en?.prerequisites)) missing.push('texts.en.prerequisites');
  if (!filled(en?.assessment)) missing.push('texts.en.assessment');
  if (!(typeof course.ects === 'number' && course.ects > 0)) missing.push('ects');
  if (!nonEmpty(course.levels)) missing.push('levels');
  if (!filled(course.contact_email) && !filled(options.organizationContactEmail)) {
    missing.push('contact_email');
  }
  if (!nonEmpty(course.instructors)) missing.push('instructors');

  const published = offerings.filter((o) => o.status === undefined || o.status === 'published');
  if (published.length === 0) {
    missing.push('offerings');
  } else {
    let best: HandbookOfferingField[] | null = null;
    for (const offering of published) {
      const gaps = offeringMissing(offering);
      if (best === null || gaps.length < best.length) best = gaps;
      if (gaps.length === 0) break;
    }
    for (const field of best ?? []) missing.push(`offerings.${field}`);
  }
  return { complete: missing.length === 0, missing };
}

/** Message of the warning `oecp.content.handbook_incomplete` (stored in `sync_errors.message`). */
export function handbookIncompleteMessage(missing: readonly string[]): string {
  return `${ERROR_CODES['oecp.content.handbook_incomplete'].message}: ${missing.join(', ')}`;
}
