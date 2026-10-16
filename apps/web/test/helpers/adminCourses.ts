// SPDX-License-Identifier: EUPL-1.2
// Fixtures of the course wizard API (`/api/admin/v1` courses, offerings and the
// organization reference), shaped like the contract the web app codes against.
import type { CourseImage } from '@oecp/schemas';
import type {
  AdminCourse,
  AdminCourseList,
  AdminCourseListItem,
  AdminCourseReference,
  AdminHistory,
  AdminOffering,
} from '../../app/types/admin';
import { ORG_ID } from './admin';

export const COURSE_ID = '7c1d2e3f-0000-4000-8000-000000000001';
export const OFFERING_ID = '7c1d2e3f-0000-4000-8000-0000000000a1';
export const UNIT_ID = '0b9f6c1e-1d7a-4f39-9a51-6c1e0f0a0101';

export function reference(overrides: Partial<AdminCourseReference> = {}): AdminCourseReference {
  return {
    organization_id: ORG_ID,
    default_timezone: 'Europe/Madrid',
    levels: ['short_cycle', 'bachelor', 'master', 'doctoral', 'other'],
    kinds: [
      { code: 'course', label: { en: 'Course' } },
      { code: 'bip', label: { en: 'Blended Intensive Programme (BIP)' } },
      { code: 'lecture_series', label: { en: 'Lecture series' } },
      { code: 'other', label: { en: 'Other' } },
    ],
    delivery_modes: [
      { code: 'presential', label: { en: 'On campus' } },
      { code: 'online', label: { en: 'Online' } },
      { code: 'hybrid', label: { en: 'Hybrid' } },
    ],
    isced_broad_fields: [
      { code: '02', label: { en: 'Arts and humanities' } },
      { code: '05', label: { en: 'Natural sciences, mathematics and statistics' } },
      { code: '06', label: { en: 'Information and Communication Technologies' } },
    ],
    languages: [
      { tag: 'en', label: { en: 'English' } },
      { tag: 'ca', label: { en: 'Catalan' } },
      { tag: 'es', label: { en: 'Spanish' } },
    ],
    attribute_definitions: [
      {
        key: 'sdgs',
        value_type: 'multi_enum',
        label: { en: 'Sustainable Development Goals' },
        description: { en: 'Goals the course contributes to.' },
        options: [
          { value: 'sdg4', label: { en: 'Quality education' } },
          { value: 'sdg13', label: { en: 'Climate action' } },
        ],
        filterable: true,
        show_as_tag: true,
        sort_order: 2,
      },
      {
        key: 'hub',
        value_type: 'enum',
        label: { en: 'Educational hub' },
        description: null,
        options: [
          { value: 'digital', label: { en: 'Digital' } },
          { value: 'health', label: { en: 'Health' } },
        ],
        filterable: true,
        show_as_tag: true,
        sort_order: 1,
      },
      {
        key: 'micro_credential',
        value_type: 'boolean',
        label: { en: 'Micro-credential' },
        description: { en: 'Leads to a micro-credential.' },
        options: null,
        filterable: true,
        show_as_tag: true,
        sort_order: 3,
      },
      {
        key: 'note',
        value_type: 'text',
        label: { en: 'Internal note' },
        description: null,
        options: null,
        filterable: false,
        show_as_tag: false,
        sort_order: 4,
      },
    ],
    academic_sessions: [
      {
        id: '5e0c0000-0000-4000-8000-000000000001',
        ext_id: '2026-27-S2',
        name: { en: 'Spring semester 2027' },
        session_type: 'semester',
        start_date: '2027-02-01',
        end_date: '2027-06-30',
      },
    ],
    teaching_units: [{ id: UNIT_ID, ext_id: 'ETSE', name: { en: 'School of Engineering' } }],
    authoritative_channel: 'form',
    form_mode: 'write',
    ...overrides,
  };
}

export function offering(overrides: Partial<AdminOffering> = {}): AdminOffering {
  return {
    id: OFFERING_ID,
    course_id: COURSE_ID,
    course_ext_id: 'TEST-101',
    ext_offering_id: '2027S',
    source_ref: null,
    source_channel: 'form',
    status: 'draft',
    academic_session_id: '5e0c0000-0000-4000-8000-000000000001',
    academic_session_ext_id: '2026-27-S2',
    academic_session: {
      id: '5e0c0000-0000-4000-8000-000000000001',
      ext_id: '2026-27-S2',
      name: { en: 'Spring semester 2027' },
    },
    start_date: '2027-02-15',
    end_date: '2027-06-15',
    enrol_start_date: '2026-11-01',
    application_deadline: '2026-12-15',
    timezone: 'Europe/Madrid',
    teaching_languages: ['en'],
    delivery_modes: ['online'],
    campus: null,
    max_students: 30,
    alliance_seats: 5,
    seats_available: null,
    seats_updated_at: null,
    application_url: 'https://apply.example.org/2027S',
    application_instructions: { en: 'Ask your home coordinator for a nomination.' },
    overrides: {},
    override_meta: {},
    source_values: {},
    absent_count: 0,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-10T10:00:00.000Z',
    last_seen_at: null,
    ...overrides,
  };
}

export function course(overrides: Partial<AdminCourse> = {}): AdminCourse {
  return {
    id: COURSE_ID,
    organization_id: ORG_ID,
    ext_id: 'TEST-101',
    source_ref: null,
    source_channel: 'form',
    status: 'draft',
    kind: 'course',
    level: 'bachelor',
    levels: ['bachelor'],
    eqf_level: null,
    ects: 6,
    teaching_hours: 45,
    info_url: 'https://www.example.org/test-101',
    contact_email: 'courses@example.org',
    teaching_unit_id: UNIT_ID,
    teaching_unit_ext_id: 'ETSE',
    isced_codes: [{ code: '0541', is_primary: true }],
    attributes: { hub: 'digital' },
    texts: {
      en: {
        title: 'Applied statistics',
        abstract: 'Statistics for practitioners.',
        description: 'An introduction to applied statistics.',
        learning_outcomes: null,
        prerequisites: null,
        assessment: null,
        keywords: ['statistics', 'data'],
        is_machine_translated: false,
      },
    },
    image: null,
    overrides: {},
    override_meta: {},
    source_values: {},
    offerings: [offering()],
    absent_count: 0,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-10T10:00:00.000Z',
    last_seen_at: null,
    ...overrides,
  };
}

/** A stored course image [DL 27] (`image` of the admin course record). */
export function courseImage(overrides: Partial<CourseImage> = {}): CourseImage {
  return {
    key: '3f9a1c0d2b4e6a81',
    alt: { en: 'Students measuring a river with GPS receivers' },
    decorative: false,
    credit: 'Photo: URV, CC BY 4.0',
    width: 1600,
    height: 900,
    source_url: null,
    updated_at: '2026-10-12T09:00:00.000Z',
    ...overrides,
  };
}

/**
 * A course as an API implementing DL 21 sends it: instructors, the optional
 * IT Handbook texts and the completeness against the publication rule.
 */
export function handbookCourse(overrides: Partial<AdminCourse> = {}): AdminCourse {
  const base = course();
  return course({
    instructors: ['Dr. Ada Lovelace', 'Prof. Alan Turing'],
    texts: {
      en: {
        ...base.texts.en!,
        methods: 'Lectures and computer labs.',
        mode_of_repetition: 'Every autumn semester.',
        literature: null,
        remarks: null,
        privacy_notice: 'Applicant data is processed for admission only.',
      },
    },
    completeness: {
      complete: false,
      missing: [
        'texts.en.learning_outcomes',
        'texts.en.prerequisites',
        'texts.en.assessment',
        'offerings',
      ],
    },
    ...overrides,
  });
}

export function listItem(
  i: number,
  overrides: Partial<AdminCourseListItem> = {},
): AdminCourseListItem {
  return {
    id: `7c1d2e3f-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ext_id: `TEST-${100 + i}`,
    kind: 'course',
    status: 'published',
    source_channel: 'csv',
    title: `Course ${i}`,
    title_lang: 'en',
    ects: 5,
    levels: ['bachelor', 'master'],
    updated_at: '2026-10-10T10:00:00.000Z',
    offerings_count: 2,
    has_overrides: false,
    next_start_date: '2027-02-15',
    ...overrides,
  };
}

export function courseList(
  items: AdminCourseListItem[],
  extra: Partial<AdminCourseList> = {},
): AdminCourseList {
  return { items, page: 1, page_size: 25, total: items.length, ...extra };
}

/** A 400 validation problem with `errors[]` pointing at fields. */
export function validationProblem(
  errors: { code: string; json_pointer?: string; message?: string }[],
) {
  return {
    type: '/problems/validation-failed',
    title: 'Validation failed',
    status: 400,
    errors: errors.map((e) => ({ severity: 'error', message: `Server: ${e.code}`, ...e })),
  };
}

export function history(): AdminHistory {
  return {
    items: [
      {
        kind: 'audit',
        at: '2026-10-10T10:00:00.000Z',
        actor: 'admin@example.org',
        action: 'course.update',
        entity_type: 'course',
        entity_id: COURSE_ID,
        ext_id: 'TEST-101',
        channel: 'form',
        sync_run_id: null,
        summary: 'ECTS 5 → 6',
        details: { fields: ['ects'] },
      },
    ],
  };
}
