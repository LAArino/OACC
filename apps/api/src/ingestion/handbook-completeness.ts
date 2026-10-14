// SPDX-License-Identifier: EUPL-1.2
/**
 * Loads what the IT Handbook publication rule reads (decision 21c) and applies
 * the pure {@link completeness} of `@oecp/schemas` to stored, effective values:
 * the course (English texts, ECTS, levels, contact, instructors), the contact of
 * its organization and its published, non-deleted offerings with their delivery
 * modes. Shared by the writer (every channel) and the admin course API.
 */
import { completeness, type CourseCompleteness } from '@oecp/schemas';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../db/database.js';

/** Completeness of each course of `courseIds` (unknown ids are absent from the map). */
export async function loadCompleteness(
  db: Kysely<Database>,
  courseIds: readonly string[],
): Promise<Map<string, CourseCompleteness>> {
  const out = new Map<string, CourseCompleteness>();
  const ids = [...new Set(courseIds)];
  if (ids.length === 0) return out;
  const [courses, texts, offerings] = await Promise.all([
    db
      .selectFrom('courses as c')
      .innerJoin('organizations as org', 'org.id', 'c.organization_id')
      .select([
        'c.id',
        'c.ects',
        'c.levels',
        'c.contact_email',
        'c.instructors',
        'org.contact_email as organization_contact_email',
      ])
      .where('c.id', 'in', ids)
      .execute(),
    db
      .selectFrom('course_texts')
      .select([
        'course_id',
        'title',
        'description',
        'learning_outcomes',
        'prerequisites',
        'assessment',
      ])
      .where('course_id', 'in', ids)
      .where('lang', '=', 'en')
      .execute(),
    db
      .selectFrom('course_offerings as o')
      .select([
        'o.course_id',
        'o.status',
        'o.start_date',
        'o.end_date',
        'o.enrol_start_date',
        'o.application_deadline',
        'o.teaching_languages',
        sql<string[]>`array(select m.mode_code from course_offering_delivery_modes m
          where m.offering_id = o.id order by m.mode_code)`.as('delivery_modes'),
      ])
      .where('o.course_id', 'in', ids)
      .where('o.deleted_at', 'is', null)
      .where('o.status', '=', 'published')
      .orderBy('o.start_date')
      .orderBy('o.ext_offering_id')
      .execute(),
  ]);
  for (const c of courses) {
    const en = texts.find((t) => t.course_id === c.id);
    out.set(
      c.id,
      completeness(
        {
          texts: en ? { en } : {},
          ects: Number(c.ects),
          levels: c.levels,
          contact_email: c.contact_email,
          instructors: c.instructors,
        },
        offerings.filter((o) => o.course_id === c.id),
        { organizationContactEmail: c.organization_contact_email },
      ),
    );
  }
  return out;
}
