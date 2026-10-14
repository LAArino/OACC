// SPDX-License-Identifier: EUPL-1.2
/**
 * Read queries of the OEAPI v5 API (spec §9): published, non-deleted courses of
 * non-deleted organizations; published or cancelled, non-deleted offerings.
 */
import { Inject, Injectable } from '@nestjs/common';
import { type RawBuilder, sql } from 'kysely';
import { type Db, KYSELY } from '../db/db.module.js';
import type {
  AcademicSessionRow,
  CourseBundle,
  CourseIscedRow,
  CourseRow,
  CourseTextRow,
  OfferingRow,
  OrganizationRow,
} from './oeapi-v5.mapper.js';

export interface Paging {
  pageSize: number;
  pageNumber: number;
}

export interface CourseFilter {
  /** Courses of this organization (or teaching unit); undefined = all. */
  organizationId?: string;
  /** Stored primary subtag of a teaching language of a visible offering. */
  language?: string;
  /** Canonical levels; `null` in the list matches courses without a level. */
  levels?: (string | null)[];
  /** v5 `modeOfDelivery` values of a visible offering (OR). */
  modes?: string[];
  /** v5 `q`: case-insensitive partial match on code, titles, abstracts, descriptions. */
  q?: string;
}

export type CourseSort = 'courseId' | 'name' | '-courseId' | '-name';
export type OfferingSort =
  | 'offeringId'
  | 'name'
  | 'startDate'
  | 'endDate'
  | '-offeringId'
  | '-name'
  | '-startDate'
  | '-endDate';
export type SessionSort =
  'academicSessionId' | 'name' | 'startDate' | '-academicSessionId' | '-name' | '-startDate';

const PUBLISHED_COURSE = sql`c.status = 'published' AND c.deleted_at IS NULL AND org.deleted_at IS NULL`;
const VISIBLE_OFFERING = sql`o.status IN ('published', 'cancelled') AND o.deleted_at IS NULL`;

/** v5 `modeOfDelivery` → condition on `course_offering_delivery_modes m` (spec §9 reverse modes). */
const MODE_CONDITIONS: Readonly<Record<string, RawBuilder<unknown>>> = {
  'on campus': sql`m.mode_code = 'presential'`,
  situated: sql`m.mode_code = 'presential'`,
  online: sql`m.mode_code IN ('online', 'coil')`,
  'distance-learning': sql`m.mode_code IN ('online', 'coil')`,
  hybrid: sql`m.mode_code NOT IN ('presential', 'online', 'coil')`,
};

const OFFERING_COLUMNS = sql`o.id, o.course_id, o.ext_offering_id, o.status, o.academic_session_id,
  o.start_date, o.end_date, o.enrol_start_date, o.application_deadline, o.timezone,
  o.teaching_languages, o.campus, o.max_students, o.alliance_seats, o.seats_available,
  o.seats_updated_at, o.application_url,
  array(SELECT m.mode_code FROM course_offering_delivery_modes m
        JOIN delivery_modes d ON d.code = m.mode_code
        WHERE m.offering_id = o.id ORDER BY d.sort_order, m.mode_code) AS modes`;

const SESSION_COLUMNS = sql`s.id, s.organization_id, s.ext_id, s.parent_id, s.session_type, s.name,
  s.start_date, s.end_date`;

export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

function direction(sort: string): RawBuilder<unknown> {
  return sort.startsWith('-') ? sql`DESC` : sql`ASC`;
}

function orderBy(
  sorts: string[],
  fallback: string,
  columns: Readonly<Record<string, RawBuilder<unknown>>>,
  tieBreaker: RawBuilder<unknown>,
): RawBuilder<unknown> {
  const items = (sorts.length ? sorts : [fallback]).map(
    (s) => sql`${columns[s.replace(/^-/, '')]!} ${direction(s)}`,
  );
  return sql.join([...items, tieBreaker], sql`, `);
}

@Injectable()
export class OeapiRepository {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  async organizations(): Promise<OrganizationRow[]> {
    const { rows } = await sql<OrganizationRow>`SELECT id, parent_id, partner_id, org_type,
        is_partner, slug, name, schac_home_organization, erasmus_code, pic, country_code,
        website_url, logo_url, contact_email
      FROM organizations WHERE deleted_at IS NULL
      ORDER BY (org_type = 'alliance') DESC, created_at, id`.execute(this.db);
    return rows;
  }

  courseConditions(filter: CourseFilter): RawBuilder<unknown> {
    const conds: RawBuilder<unknown>[] = [PUBLISHED_COURSE];
    if (filter.organizationId) {
      conds.push(sql`(c.organization_id = ${filter.organizationId}::uuid
        OR c.teaching_unit_id = ${filter.organizationId}::uuid)`);
    }
    if (filter.language) {
      conds.push(sql`EXISTS (SELECT 1 FROM course_offerings o
        CROSS JOIN LATERAL unnest(o.teaching_languages) AS tl(tag)
        WHERE o.course_id = c.id AND ${VISIBLE_OFFERING}
          AND split_part(tl.tag, '-', 1) = ${filter.language})`);
    }
    if (filter.levels) {
      const values = filter.levels.filter((l): l is string => l !== null);
      const parts = [sql`c.level = ANY(${values}::text[])`];
      if (filter.levels.includes(null)) parts.push(sql`c.level IS NULL`);
      conds.push(sql`(${sql.join(parts, sql` OR `)})`);
    }
    if (filter.modes?.length) {
      const modeConds = filter.modes.map((m) => MODE_CONDITIONS[m] ?? sql`false`);
      conds.push(sql`EXISTS (SELECT 1 FROM course_offerings o
        JOIN course_offering_delivery_modes m ON m.offering_id = o.id
        WHERE o.course_id = c.id AND ${VISIBLE_OFFERING} AND (${sql.join(modeConds, sql` OR `)}))`);
    }
    if (filter.q) {
      const p = likePattern(filter.q);
      conds.push(sql`(c.ext_id ILIKE ${p} OR EXISTS (SELECT 1 FROM course_texts t
        WHERE t.course_id = c.id
          AND (t.title ILIKE ${p} OR t.abstract ILIKE ${p} OR t.description ILIKE ${p})))`);
    }
    return sql.join(conds, sql` AND `);
  }

  async coursePage(
    filter: CourseFilter,
    paging: Paging,
    sort: CourseSort[],
  ): Promise<{ ids: string[]; total: number }> {
    const where = this.courseConditions(filter);
    const from = sql`FROM courses c JOIN organizations org ON org.id = c.organization_id`;
    const order = orderBy(
      sort,
      'name',
      {
        courseId: sql`c.id`,
        name: sql`oecp_search_fold((SELECT t.title FROM course_texts t
          WHERE t.course_id = c.id AND t.lang = 'en'))`,
      },
      sql`c.id`,
    );
    const [page, count] = await Promise.all([
      sql<{ id: string }>`SELECT c.id ${from} WHERE ${where} ORDER BY ${order}
        LIMIT ${paging.pageSize} OFFSET ${(paging.pageNumber - 1) * paging.pageSize}`.execute(
        this.db,
      ),
      sql<{ total: string }>`SELECT count(*) AS total ${from} WHERE ${where}`.execute(this.db),
    ]);
    return { ids: page.rows.map((r) => r.id), total: Number(count.rows[0]?.total ?? 0) };
  }

  /** Bundles of the published courses among `ids`, in the order of `ids`. */
  async courseBundles(ids: string[]): Promise<CourseBundle[]> {
    if (ids.length === 0) return [];
    const [courses, texts, isced, offerings] = await Promise.all([
      sql<CourseRow>`SELECT c.id, c.organization_id, c.teaching_unit_id, c.ext_id, c.ects,
          c.level, c.eqf_level, c.teaching_hours, c.info_url, c.contact_email, c.updated_at
        FROM courses c JOIN organizations org ON org.id = c.organization_id
        WHERE c.id = ANY(${ids}::uuid[]) AND ${PUBLISHED_COURSE}`.execute(this.db),
      sql<CourseTextRow>`SELECT t.course_id, t.lang, t.title, t.abstract, t.description,
          t.learning_outcomes, t.prerequisites, t.assessment, t.keywords
        FROM course_texts t WHERE t.course_id = ANY(${ids}::uuid[])
        ORDER BY t.course_id, (t.lang = 'en') DESC, t.lang`.execute(this.db),
      sql<CourseIscedRow>`SELECT i.course_id, i.isced_code, i.is_primary FROM course_isced_codes i
        WHERE i.course_id = ANY(${ids}::uuid[])
        ORDER BY i.course_id, i.is_primary DESC, i.isced_code`.execute(this.db),
      sql<OfferingRow>`SELECT ${OFFERING_COLUMNS} FROM course_offerings o
        WHERE o.course_id = ANY(${ids}::uuid[]) AND ${VISIBLE_OFFERING}
        ORDER BY o.course_id, o.start_date, o.end_date, o.id`.execute(this.db),
    ]);
    const byCourse = <T extends { course_id: string }>(rows: T[], id: string) =>
      rows.filter((r) => r.course_id === id);
    const found = new Map(courses.rows.map((c) => [c.id, c]));
    return ids.flatMap((id) => {
      const course = found.get(id);
      return course
        ? [
            {
              course,
              texts: byCourse(texts.rows, id),
              isced: byCourse(isced.rows, id),
              offerings: byCourse(offerings.rows, id),
            },
          ]
        : [];
    });
  }

  async offeringPage(
    courseId: string,
    window: { since: string; until?: string },
    paging: Paging,
    sort: OfferingSort[],
  ): Promise<{ rows: OfferingRow[]; total: number }> {
    const conds = [
      sql`o.course_id = ${courseId}::uuid`,
      VISIBLE_OFFERING,
      sql`o.start_date >= ${window.since}::date`,
    ];
    if (window.until) conds.push(sql`o.end_date <= ${window.until}::date`);
    const where = sql.join(conds, sql` AND `);
    const order = orderBy(
      sort,
      'startDate',
      {
        offeringId: sql`o.id`,
        name: sql`o.ext_offering_id`,
        startDate: sql`o.start_date`,
        endDate: sql`o.end_date`,
      },
      sql`o.id`,
    );
    const [page, count] = await Promise.all([
      sql<OfferingRow>`SELECT ${OFFERING_COLUMNS} FROM course_offerings o WHERE ${where}
        ORDER BY ${order}
        LIMIT ${paging.pageSize} OFFSET ${(paging.pageNumber - 1) * paging.pageSize}`.execute(
        this.db,
      ),
      sql<{
        total: string;
      }>`SELECT count(*) AS total FROM course_offerings o WHERE ${where}`.execute(this.db),
    ]);
    return { rows: page.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  /** A visible offering of a published course. */
  async offering(id: string): Promise<OfferingRow | null> {
    const { rows } = await sql<OfferingRow>`SELECT ${OFFERING_COLUMNS}
      FROM course_offerings o
      JOIN courses c ON c.id = o.course_id
      JOIN organizations org ON org.id = c.organization_id
      WHERE o.id = ${id}::uuid AND ${VISIBLE_OFFERING} AND ${PUBLISHED_COURSE}`.execute(this.db);
    return rows[0] ?? null;
  }

  async sessionPage(
    filter: { sessionType?: string; parent?: string },
    paging: Paging,
    sort: SessionSort[],
  ): Promise<{ rows: AcademicSessionRow[]; total: number }> {
    const conds = [sql`s.deleted_at IS NULL`];
    if (filter.sessionType) conds.push(sql`s.session_type = ${filter.sessionType}`);
    if (filter.parent) conds.push(sql`s.parent_id = ${filter.parent}::uuid`);
    const where = sql.join(conds, sql` AND `);
    const order = orderBy(
      sort,
      'startDate',
      {
        academicSessionId: sql`s.id`,
        name: sql`oecp_search_fold(s.name->>'en')`,
        startDate: sql`s.start_date`,
      },
      sql`s.id`,
    );
    const [page, count] = await Promise.all([
      sql<AcademicSessionRow>`SELECT ${SESSION_COLUMNS} FROM academic_sessions s WHERE ${where}
        ORDER BY ${order}
        LIMIT ${paging.pageSize} OFFSET ${(paging.pageNumber - 1) * paging.pageSize}`.execute(
        this.db,
      ),
      sql<{
        total: string;
      }>`SELECT count(*) AS total FROM academic_sessions s WHERE ${where}`.execute(this.db),
    ]);
    return { rows: page.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  async sessions(ids: string[]): Promise<AcademicSessionRow[]> {
    if (ids.length === 0) return [];
    const { rows } = await sql<AcademicSessionRow>`SELECT ${SESSION_COLUMNS}
      FROM academic_sessions s WHERE s.id = ANY(${ids}::uuid[]) AND s.deleted_at IS NULL`.execute(
      this.db,
    );
    return rows;
  }

  async sessionChildren(parentIds: string[]): Promise<AcademicSessionRow[]> {
    if (parentIds.length === 0) return [];
    const { rows } = await sql<AcademicSessionRow>`SELECT ${SESSION_COLUMNS}
      FROM academic_sessions s
      WHERE s.parent_id = ANY(${parentIds}::uuid[]) AND s.deleted_at IS NULL
      ORDER BY s.start_date, s.id`.execute(this.db);
    return rows;
  }
}
