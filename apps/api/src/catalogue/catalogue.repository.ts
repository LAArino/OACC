// SPDX-License-Identifier: EUPL-1.2
/**
 * Read queries of the public catalogue API (spec §7). Only published,
 * non-deleted courses of non-deleted organizations are ever returned.
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  AttributeDefinition,
  CourseAttributes,
  CourseKind,
  LocalizedLabel,
  NormalizedCourseSearch,
} from '@oecp/schemas';
import { sql } from 'kysely';
import { loadAttributeDefinitions } from '../attributes/attribute-definitions.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { CourseSearchSql, type FacetKey } from './search-sql.js';

/** Image columns of migration 0008 (decision 27). */
export interface ImageRow {
  image_key: string | null;
  image_alt: Record<string, string>;
  image_decorative: boolean;
  image_credit: string | null;
  image_width: number | null;
  image_height: number | null;
}

export interface CardCourseRow extends ImageRow {
  id: string;
  ext_id: string;
  kind: CourseKind;
  ects: string;
  level: string | null;
  levels: string[];
  attributes: CourseAttributes;
  org_id: string;
  org_slug: string;
  org_name: LocalizedLabel;
  org_country_code: string | null;
}

export interface CardTextRow {
  course_id: string;
  lang: string;
  title: string;
  abstract: string | null;
}

export interface IscedRow {
  course_id: string;
  isced_code: string;
  broad_code: string;
  is_primary: boolean;
  label: LocalizedLabel;
}

export interface ModeRef {
  code: string;
  sort_order: number;
  label: LocalizedLabel;
  schema_org: 'Onsite' | 'Online' | 'Blended';
}

export interface CardOfferingRow {
  id: string;
  course_id: string;
  start_date: string;
  end_date: string;
  application_deadline: string | null;
  enrol_start_date: string | null;
  timezone: string;
  teaching_languages: string[];
  alliance_seats: number | null;
  seats_available: number | null;
  seats_updated_at: Date | null;
  application_instructions: Record<string, string>;
  modes: ModeRef[];
}

export interface SearchResultRows {
  ids: string[];
  total: number;
  /** Fixed facets and `attr:<key>` facets of filterable definitions. */
  facets: Map<FacetKey, { value: string; count: number }[]>;
  definitions: AttributeDefinition[];
  courses: CardCourseRow[];
  texts: CardTextRow[];
  isced: IscedRow[];
  offerings: CardOfferingRow[];
}

export interface DetailCourseRow extends ImageRow {
  id: string;
  ext_id: string;
  kind: CourseKind;
  ects: string;
  level: string | null;
  levels: string[];
  attributes: CourseAttributes;
  eqf_level: number | null;
  teaching_hours: string | null;
  info_url: string | null;
  contact_email: string | null;
  instructors: string[];
  updated_at: Date;
  org_id: string;
  org_slug: string;
  org_name: LocalizedLabel;
  org_country_code: string | null;
  org_logo_url: string | null;
  org_website_url: string | null;
  org_contact_email: string | null;
  unit_id: string | null;
  unit_slug: string | null;
  unit_name: LocalizedLabel | null;
}

export interface DetailTextRow {
  lang: string;
  title: string;
  abstract: string | null;
  description: string | null;
  learning_outcomes: string | null;
  prerequisites: string | null;
  assessment: string | null;
  mode_of_repetition: string | null;
  methods: string | null;
  literature: string | null;
  privacy_notice: string | null;
  remarks: string | null;
  keywords: string[];
  is_machine_translated: boolean;
  updated_at: Date;
}

export interface DetailOfferingRow {
  id: string;
  ext_offering_id: string;
  status: 'published' | 'cancelled';
  start_date: string;
  end_date: string;
  enrol_start_date: string | null;
  application_deadline: string | null;
  timezone: string;
  teaching_languages: string[];
  campus: string | null;
  max_students: number | null;
  alliance_seats: number | null;
  seats_available: number | null;
  seats_updated_at: Date | null;
  application_url: string | null;
  application_instructions: Record<string, string>;
  updated_at: Date;
  session_id: string | null;
  session_name: LocalizedLabel | null;
  session_start_date: string | null;
  session_end_date: string | null;
  modes: ModeRef[];
}

export interface CourseDetailRows {
  course: DetailCourseRow;
  texts: DetailTextRow[];
  isced: IscedRow[];
  offerings: DetailOfferingRow[];
  definitions: AttributeDefinition[];
}

export interface SuggestRow {
  id: string;
  title: string;
  lang: string;
  organization_slug: string;
}

export interface ReferenceRows {
  organizations: {
    id: string;
    slug: string;
    name: LocalizedLabel;
    country_code: string | null;
    logo_url: string | null;
    website_url: string | null;
    org_type: string;
    is_partner: boolean;
    parent_id: string | null;
    keycloak_idp_alias: string | null;
  }[];
  modes: ModeRef[];
  isced: { code: string; label: LocalizedLabel }[];
  languages: string[];
  definitions: AttributeDefinition[];
}

/** Delivery modes of an offering `o`, as a JSON array ordered by `sort_order`. */
const OFFERING_MODES = sql<ModeRef[]>`coalesce((
  SELECT json_agg(json_build_object('code', d.code, 'sort_order', d.sort_order,
                                    'label', d.label, 'schema_org', d.schema_org)
                  ORDER BY d.sort_order, d.code)
  FROM course_offering_delivery_modes m JOIN delivery_modes d ON d.code = m.mode_code
  WHERE m.offering_id = o.id), '[]'::json)`;

/** Minimum trigram word similarity of a suggestion (pg_trgm default 0.6 misses `histry`). */
export const SUGGEST_WORD_SIMILARITY = 0.5;

/** Visible-course predicate on `c`/`org`. */
const IMAGE_COLUMNS = sql`c.image_key, c.image_alt, c.image_decorative, c.image_credit,
  c.image_width, c.image_height`;
const PUBLISHED = sql`c.status = 'published' AND c.deleted_at IS NULL AND org.deleted_at IS NULL`;

@Injectable()
export class CatalogueRepository {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  async search(search: NormalizedCourseSearch, today: string): Promise<SearchResultRows> {
    const definitions = await loadAttributeDefinitions(this.db);
    const plan = new CourseSearchSql(search, today, definitions);
    const facetKeys = plan.facetKeys();
    const [page, count, ...facetRows] = await Promise.all([
      plan.pageQuery().execute(this.db),
      plan.countQuery().execute(this.db),
      ...facetKeys.map((key) => plan.facetQuery(key).execute(this.db)),
    ]);
    const ids = page.rows.map((r) => r.id);
    const facets = new Map(
      facetKeys.map((key, i) => [
        key,
        (facetRows[i]?.rows ?? []).map((r) => ({ value: r.value, count: Number(r.count) })),
      ]),
    );
    const total = Number(count.rows[0]?.total ?? 0);
    if (ids.length === 0) {
      return {
        ids,
        total,
        facets,
        definitions,
        courses: [],
        texts: [],
        isced: [],
        offerings: [],
      };
    }
    const langs = [...new Set([search.locale, 'en'])];
    const [courses, texts, isced, offerings] = await Promise.all([
      sql<CardCourseRow>`SELECT c.id, c.ext_id, c.kind, c.ects, c.level, c.levels, c.attributes,
          ${IMAGE_COLUMNS}, org.id AS org_id, org.slug AS org_slug, org.name AS org_name,
          org.country_code AS org_country_code
        FROM courses c JOIN organizations org ON org.id = c.organization_id
        WHERE c.id = ANY(${ids}::uuid[])`.execute(this.db),
      sql<CardTextRow>`SELECT t.course_id, t.lang, t.title, t.abstract FROM course_texts t
        WHERE t.course_id = ANY(${ids}::uuid[]) AND t.lang = ANY(${langs}::text[])`.execute(
        this.db,
      ),
      this.isced(ids),
      sql<CardOfferingRow>`SELECT o.id, o.course_id, o.start_date, o.end_date,
          o.application_deadline, o.enrol_start_date, o.timezone, o.teaching_languages,
          o.alliance_seats, o.seats_available, o.seats_updated_at, o.application_instructions,
          ${OFFERING_MODES} AS modes
        FROM course_offerings o
        WHERE o.course_id = ANY(${ids}::uuid[]) AND o.status = 'published'
          AND o.deleted_at IS NULL AND o.end_date >= ${today}::date
        ORDER BY o.start_date, o.end_date, o.id`.execute(this.db),
    ]);
    return {
      ids,
      total,
      facets,
      definitions,
      courses: courses.rows,
      texts: texts.rows,
      isced: isced,
      offerings: offerings.rows,
    };
  }

  private async isced(ids: string[]): Promise<IscedRow[]> {
    const { rows } = await sql<IscedRow>`SELECT i.course_id, i.isced_code, i.broad_code,
        i.is_primary, b.label
      FROM course_isced_codes i JOIN isced_broad_fields b ON b.code = i.broad_code
      WHERE i.course_id = ANY(${ids}::uuid[])
      ORDER BY i.course_id, i.is_primary DESC, i.isced_code`.execute(this.db);
    return rows;
  }

  async courseDetail(id: string, today: string): Promise<CourseDetailRows | null> {
    const { rows } = await sql<DetailCourseRow>`SELECT c.id, c.ext_id, c.kind, c.ects, c.level,
        c.levels, c.attributes, c.eqf_level, c.teaching_hours, c.info_url, c.contact_email,
        c.instructors, c.updated_at, ${IMAGE_COLUMNS}, org.id AS org_id, org.slug AS org_slug, org.name AS org_name,
        org.country_code AS org_country_code, org.logo_url AS org_logo_url,
        org.website_url AS org_website_url, org.contact_email AS org_contact_email,
        tu.id AS unit_id, tu.slug AS unit_slug, tu.name AS unit_name
      FROM courses c
      JOIN organizations org ON org.id = c.organization_id
      LEFT JOIN organizations tu ON tu.id = c.teaching_unit_id AND tu.deleted_at IS NULL
      WHERE c.id = ${id}::uuid AND ${PUBLISHED}`.execute(this.db);
    const course = rows[0];
    if (!course) return null;
    const [texts, isced, offerings, definitions] = await Promise.all([
      sql<DetailTextRow>`SELECT t.lang, t.title, t.abstract, t.description, t.learning_outcomes,
          t.prerequisites, t.assessment, t.mode_of_repetition, t.methods, t.literature,
          t.privacy_notice, t.remarks, t.keywords, t.is_machine_translated, t.updated_at
        FROM course_texts t WHERE t.course_id = ${id}::uuid
        ORDER BY (t.lang = 'en') DESC, t.lang`.execute(this.db),
      this.isced([id]),
      sql<DetailOfferingRow>`SELECT o.id, o.ext_offering_id, o.status, o.start_date, o.end_date,
          o.enrol_start_date, o.application_deadline, o.timezone, o.teaching_languages,
          o.campus, o.max_students, o.alliance_seats, o.seats_available, o.seats_updated_at,
          o.application_url, o.application_instructions, o.updated_at,
          s.id AS session_id, s.name AS session_name, s.start_date AS session_start_date,
          s.end_date AS session_end_date, ${OFFERING_MODES} AS modes
        FROM course_offerings o
        LEFT JOIN academic_sessions s ON s.id = o.academic_session_id AND s.deleted_at IS NULL
        WHERE o.course_id = ${id}::uuid AND o.deleted_at IS NULL
          AND (o.status = 'published' OR (o.status = 'cancelled' AND o.start_date >= ${today}::date))
        ORDER BY o.start_date, o.end_date, o.id`.execute(this.db),
      loadAttributeDefinitions(this.db),
    ]);
    return { course, texts: texts.rows, isced, offerings: offerings.rows, definitions };
  }

  /**
   * Titles matching `q` (unaccented, case-insensitive), one per course: the title
   * in `locale` if it matches, else the English one, else the best-scoring one.
   * Under 3 characters only word prefixes match; from 3, any substring or a
   * trigram word similarity of at least {@link SUGGEST_WORD_SIMILARITY}.
   */
  async suggest(q: string, limit: number, locale: string): Promise<SuggestRow[]> {
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    const fq = sql`oecp_search_fold(${q})`;
    const fp = sql`oecp_search_fold(${escaped})`;
    const ft = sql`oecp_search_fold(t.title)`;
    const wordPrefix = sql`(' ' || ${ft}) LIKE '% ' || ${fp} || '%'`;
    const match =
      q.length >= 3 ? sql`(${ft} LIKE '%' || ${fp} || '%' OR ${fq} <% ${ft})` : wordPrefix;
    // Whole-title prefix > word prefix > elsewhere, then trigram word similarity.
    const score = sql`(CASE WHEN ${ft} LIKE ${fp} || '%' THEN 2 WHEN ${wordPrefix} THEN 1 ELSE 0 END
        + word_similarity(${fq}, ${ft}))`;
    const query = sql<SuggestRow & { score: number }>`SELECT * FROM (
        SELECT DISTINCT ON (t.course_id) t.course_id AS id, t.title, t.lang,
          org.slug AS organization_slug, ${score} AS score
        FROM course_texts t
        JOIN courses c ON c.id = t.course_id
        JOIN organizations org ON org.id = c.organization_id
        WHERE ${PUBLISHED} AND ${match}
        ORDER BY t.course_id, (t.lang = ${locale}) DESC, (t.lang = 'en') DESC, score DESC, t.lang
      ) best
      ORDER BY score DESC, oecp_search_fold(title), id
      LIMIT ${limit}`;
    // `<%` uses the session threshold; lower it for this transaction only.
    const { rows } = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(SUGGEST_WORD_SIMILARITY)}, true)`.execute(
        trx,
      );
      return query.execute(trx);
    });
    return rows.map(({ score: _score, ...row }) => row);
  }

  async reference(): Promise<ReferenceRows> {
    const [organizations, modes, isced, languages, definitions] = await Promise.all([
      sql<ReferenceRows['organizations'][number]>`SELECT id, slug, name, country_code, logo_url,
          website_url, org_type, is_partner, parent_id, keycloak_idp_alias
        FROM organizations WHERE deleted_at IS NULL
        ORDER BY (org_type = 'alliance') DESC, is_partner DESC, slug`.execute(this.db),
      sql<ModeRef>`SELECT code, sort_order, label, schema_org FROM delivery_modes
        WHERE active ORDER BY sort_order, code`.execute(this.db),
      sql<{ code: string; label: LocalizedLabel }>`SELECT code, label FROM isced_broad_fields
        ORDER BY code`.execute(this.db),
      sql<{ lang: string }>`SELECT DISTINCT split_part(tl.tag, '-', 1) AS lang
        FROM course_offerings o
        JOIN courses c ON c.id = o.course_id
        JOIN organizations org ON org.id = c.organization_id
        CROSS JOIN LATERAL unnest(o.teaching_languages) AS tl(tag)
        WHERE o.status = 'published' AND o.deleted_at IS NULL AND ${PUBLISHED}
        ORDER BY 1`.execute(this.db),
      loadAttributeDefinitions(this.db),
    ]);
    return {
      organizations: organizations.rows,
      modes: modes.rows,
      isced: isced.rows,
      languages: languages.rows.map((r) => r.lang),
      definitions,
    };
  }

  /** Published courses with the latest change of the course, its texts or offerings. */
  async sitemap(): Promise<{ id: string; lastmod: Date }[]> {
    const { rows } = await sql<{ id: string; lastmod: Date }>`SELECT c.id, greatest(c.updated_at,
          (SELECT max(t.updated_at) FROM course_texts t WHERE t.course_id = c.id),
          (SELECT max(o.updated_at) FROM course_offerings o
            WHERE o.course_id = c.id AND o.deleted_at IS NULL)) AS lastmod
      FROM courses c JOIN organizations org ON org.id = c.organization_id
      WHERE ${PUBLISHED}
      ORDER BY c.id
      LIMIT 50000`.execute(this.db);
    return rows;
  }
}
