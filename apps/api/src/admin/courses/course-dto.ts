// SPDX-License-Identifier: EUPL-1.2
/**
 * Channel C mapping (spec §6.1, §6.4): form inputs and current records → the
 * canonical DTOs every channel hands to `CanonicalWriter`. Pure.
 */
import type {
  AdminCourse,
  AdminOffering,
  Course,
  CourseInputValue,
  CourseOffering,
  CourseText,
  LifecycleStatus,
  OfferingInputValue,
} from '@oecp/schemas';
import type {
  CourseEffective,
  OfferingEffective,
  TextEffective,
} from '../../ingestion/canonical-writer.service.js';

/** Stable key order, so equal inputs hash equally (RFC 8785 sorts anyway). */
function sorted<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/** `[{code, is_primary}]` → codes, primary first. */

/** EQF level implied by the primary level when the input does not give one
 * (same table as the OEAPI adapter), so a form save never erases it. */
const EQF_BY_LEVEL: Readonly<Record<string, number>> = {
  short_cycle: 5,
  bachelor: 6,
  master: 7,
  doctoral: 8,
};
function eqfFromLevel(level: string | undefined): number | null {
  return level ? (EQF_BY_LEVEL[level] ?? null) : null;
}

export function iscedList(codes: readonly { code: string; is_primary: boolean }[]): string[] {
  const primary = codes.find((c) => c.is_primary) ?? codes[0];
  return primary ? [primary.code, ...codes.filter((c) => c !== primary).map((c) => c.code)] : [];
}

export function courseFromInput(
  input: CourseInputValue,
  options: { status: LifecycleStatus; sourceRef: string | null },
): Course {
  const texts: Record<string, CourseText> = {};
  for (const [lang, text] of Object.entries(input.texts)) {
    if (!text) continue;
    texts[lang] = {
      title: text.title,
      abstract: text.abstract,
      description: text.description,
      learning_outcomes: text.learning_outcomes,
      prerequisites: text.prerequisites,
      assessment: text.assessment,
      keywords: text.keywords,
      // Texts entered in the form are written by people.
      is_machine_translated: false,
    };
  }
  return {
    ext_id: input.ext_id,
    source_ref: options.sourceRef,
    status: options.status,
    kind: input.kind,
    ects: input.ects,
    level: input.levels[0] ?? null,
    levels: input.levels,
    eqf_level: input.eqf_level ?? eqfFromLevel(input.levels[0]),
    teaching_hours: input.teaching_hours ?? null,
    teaching_unit_ext_id: input.teaching_unit_ext_id ?? null,
    info_url: input.info_url ?? null,
    contact_email: input.contact_email ?? null,
    isced_codes: iscedList(input.isced_codes),
    texts: sorted(texts),
    attributes: sorted(input.attributes),
  };
}

/** The current record with another status (status changes of `write` organizations). */
export function courseFromAdmin(course: AdminCourse, status: LifecycleStatus): Course {
  return {
    ext_id: course.ext_id,
    source_ref: course.source_ref,
    status,
    kind: course.kind,
    ects: course.ects,
    level: course.levels[0] ?? course.level,
    levels: course.levels,
    eqf_level: course.eqf_level,
    teaching_hours: course.teaching_hours,
    teaching_unit_ext_id: course.teaching_unit_ext_id,
    info_url: course.info_url,
    contact_email: course.contact_email,
    isced_codes: iscedList(course.isced_codes),
    texts: sorted(course.texts),
    attributes: sorted(course.attributes),
  };
}

/** The effective record after overrides, for the canonical checks. */
export function courseFromEffective(
  course: Pick<AdminCourse, 'ext_id' | 'source_ref'>,
  next: { course: CourseEffective; texts: Record<string, TextEffective> },
): Course {
  const c = next.course;
  return {
    ext_id: course.ext_id,
    source_ref: course.source_ref,
    status: c.status,
    kind: c.kind,
    ects: c.ects,
    level: c.level,
    levels: c.levels,
    eqf_level: c.eqf_level,
    teaching_hours: c.teaching_hours,
    teaching_unit_ext_id: null,
    info_url: c.info_url,
    contact_email: c.contact_email,
    isced_codes: c.isced_codes,
    texts: next.texts,
    attributes: c.attributes,
  };
}

export function offeringFromInput(
  input: OfferingInputValue,
  options: {
    courseExtId: string;
    status: LifecycleStatus;
    sourceRef: string | null;
    defaultTimezone: string;
    now: Date;
  },
): CourseOffering {
  const seats = input.seats_available ?? null;
  return {
    course_ext_id: options.courseExtId,
    ext_offering_id: input.ext_offering_id,
    source_ref: options.sourceRef,
    status: options.status,
    academic_session_ext_id: input.academic_session_ext_id ?? null,
    start_date: input.start_date,
    end_date: input.end_date,
    enrol_start_date: input.enrol_start_date ?? null,
    application_deadline: input.application_deadline ?? null,
    timezone: input.timezone ?? options.defaultTimezone,
    teaching_languages: input.teaching_languages,
    delivery_modes: input.delivery_modes,
    campus: input.campus,
    max_students: input.max_students ?? null,
    alliance_seats: input.alliance_seats ?? null,
    seats_available: seats,
    // Spec §6.3 (as CSV): a seat count is current as of the save.
    seats_updated_at: seats === null ? null : options.now.toISOString(),
    application_url: input.application_url ?? null,
    application_instructions: sorted(
      Object.fromEntries(
        Object.entries(input.application_instructions).filter(
          (e): e is [string, string] => typeof e[1] === 'string',
        ),
      ),
    ),
  };
}

export function offeringFromAdmin(
  offering: AdminOffering,
  status: LifecycleStatus,
): CourseOffering {
  return {
    course_ext_id: offering.course_ext_id,
    ext_offering_id: offering.ext_offering_id,
    source_ref: offering.source_ref,
    status,
    academic_session_ext_id: offering.academic_session_ext_id,
    start_date: offering.start_date,
    end_date: offering.end_date,
    enrol_start_date: offering.enrol_start_date,
    application_deadline: offering.application_deadline,
    timezone: offering.timezone,
    teaching_languages: offering.teaching_languages,
    delivery_modes: offering.delivery_modes,
    campus: offering.campus,
    max_students: offering.max_students,
    alliance_seats: offering.alliance_seats,
    seats_available: offering.seats_available,
    seats_updated_at: offering.seats_updated_at,
    application_url: offering.application_url,
    application_instructions: sorted(offering.application_instructions),
  };
}

export function offeringFromEffective(
  offering: Pick<
    AdminOffering,
    'course_ext_id' | 'ext_offering_id' | 'source_ref' | 'academic_session_ext_id'
  >,
  next: OfferingEffective,
): CourseOffering {
  return {
    course_ext_id: offering.course_ext_id,
    ext_offering_id: offering.ext_offering_id,
    source_ref: offering.source_ref,
    academic_session_ext_id: offering.academic_session_ext_id,
    ...next,
  };
}

/** Comparable view of a course for audit summaries (`fields` that changed). */
export function courseFields(course: AdminCourse | undefined): Record<string, unknown> {
  if (!course) return {};
  const out: Record<string, unknown> = {
    status: course.status,
    kind: course.kind,
    levels: course.levels,
    eqf_level: course.eqf_level,
    ects: course.ects,
    teaching_hours: course.teaching_hours,
    info_url: course.info_url,
    contact_email: course.contact_email,
    teaching_unit_ext_id: course.teaching_unit_ext_id,
    isced_codes: course.isced_codes,
    attributes: sorted(course.attributes),
  };
  for (const [lang, text] of Object.entries(course.texts)) out[`texts.${lang}`] = text;
  return out;
}

export function offeringFields(offering: AdminOffering | undefined): Record<string, unknown> {
  if (!offering) return {};
  const {
    id: _id,
    course_id: _c,
    overrides: _o,
    source_values: _s,
    created_at: _ca,
    updated_at: _u,
    last_seen_at: _l,
    absent_count: _a,
    seats_updated_at: _su,
    academic_session_id: _si,
    source_channel: _sc,
    ...fields
  } = offering;
  return fields;
}

/** Keys whose values differ between two {@link courseFields}/{@link offeringFields} views. */
export function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}
