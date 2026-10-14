// SPDX-License-Identifier: EUPL-1.2
/**
 * SQL building blocks of the catalogue search (spec §5 "Search", §7). Pure:
 * every function returns Kysely `sql` fragments with bound parameters, so the
 * generated SQL is unit-testable without a database.
 *
 * Full-text matching ORs one branch per text search configuration
 * (`oecp_ts_config(lang) = cfg AND search_vector @@ websearch_to_tsquery(cfg, q)`)
 * so the GIN index on `course_texts.search_vector` serves every branch. A single
 * token also matches as a prefix (`token:*`) and, from 3 characters, by trigram
 * word similarity on the unaccented lower-case title (typo tolerance). Ranking is
 * `ts_rank_cd` + 0.3 × title trigram similarity, the best text of a course wins.
 */
import type { NormalizedCourseSearch } from '@oecp/schemas';
import { type RawBuilder, sql } from 'kysely';

/** Text search configurations of migrations 0001/0004 (`oecp_ts_config`). */
export const TS_CONFIGS = [
  'oecp_en',
  'oecp_de',
  'oecp_nl',
  'oecp_it',
  'oecp_fr',
  'oecp_da',
  'oecp_es',
  'oecp_ca',
  'oecp_simple',
] as const;

/** Weight of title trigram similarity in the relevance score (spec §5). */
export const TRIGRAM_WEIGHT = 0.3;

const SINGLE_TOKEN = /^[\p{L}\p{N}]+$/u;
const MAX_TRIGRAM_TOKEN = 30;

export interface TextQuery {
  /** The raw query for `websearch_to_tsquery`. */
  q: string;
  /** `to_tsquery` prefix query (`'token':*`) when `q` is one word. */
  prefix: string | null;
  /** Token for trigram word similarity when `q` is one word of 3–30 characters. */
  trigram: string | null;
}

export function parseTextQuery(q: string): TextQuery {
  const trimmed = q.trim();
  const single = SINGLE_TOKEN.test(trimmed);
  return {
    q: trimmed,
    prefix: single ? `'${trimmed.toLowerCase()}':*` : null,
    trigram:
      single && trimmed.length >= 3 && trimmed.length <= MAX_TRIGRAM_TOKEN
        ? trimmed.toLowerCase()
        : null,
  };
}

function tsQuery(cfg: RawBuilder<unknown>, text: TextQuery): RawBuilder<unknown> {
  const web = sql`websearch_to_tsquery(${cfg}, ${text.q})`;
  return text.prefix ? sql`(${web} || to_tsquery(${cfg}, ${text.prefix}))` : web;
}

/** Matching condition on a `course_texts` row aliased `t`. */
export function textMatch(text: TextQuery): RawBuilder<unknown> {
  const branches = TS_CONFIGS.map((name) => {
    const cfg = sql`${sql.lit(name)}::regconfig`;
    return sql`(oecp_ts_config(t.lang) = ${cfg} AND t.search_vector @@ ${tsQuery(cfg, text)})`;
  });
  if (text.trigram) {
    branches.push(sql`(oecp_search_fold(${text.trigram}) <% oecp_search_fold(t.title))`);
  }
  return sql`(${sql.join(branches, sql` OR `)})`;
}

/** Relevance of a `course_texts` row aliased `t`. */
export function textRank(text: TextQuery): RawBuilder<number> {
  const cfg = sql`oecp_ts_config(t.lang)`;
  return sql<number>`(ts_rank_cd(t.search_vector, ${tsQuery(cfg, text)}) + ${sql.lit(TRIGRAM_WEIGHT)} * similarity(oecp_search_fold(t.title), oecp_search_fold(${text.q})))`;
}

/** `hits(course_id, rank)`: best-ranked matching text per course. */
export function hitsCte(text: TextQuery): RawBuilder<unknown> {
  return sql`hits AS (
    SELECT t.course_id, max(${textRank(text)}) AS rank
    FROM course_texts t
    WHERE ${textMatch(text)}
    GROUP BY t.course_id)`;
}

export type FacetKey = 'partner' | 'mode' | 'lang' | 'isced' | 'level';

/**
 * Filters of one search request as SQL. Aliases: `c` courses, `org` the course's
 * organization, `o` course_offerings; `hits` exists when the request has `q`.
 */
export class CourseSearchSql {
  readonly text: TextQuery | null;

  constructor(
    readonly search: NormalizedCourseSearch,
    /** `YYYY-MM-DD`; offerings with `end_date >= today` are upcoming. */
    readonly today: string,
  ) {
    this.text = search.q ? parseTextQuery(search.q) : null;
  }

  /** `WITH hits AS (…)` when the request has a text query, else nothing. */
  with(): RawBuilder<unknown> {
    return this.text ? sql`WITH ${hitsCte(this.text)} ` : sql``;
  }

  /** Conditions on an offering `o` (published, not deleted, upcoming, mode, language). */
  offeringConditions(
    options: { omit?: FacetKey; forceUpcoming?: boolean } = {},
  ): RawBuilder<unknown> {
    const s = this.search;
    const conds: RawBuilder<unknown>[] = [sql`o.status = 'published'`, sql`o.deleted_at IS NULL`];
    if (s.upcoming || options.forceUpcoming) conds.push(sql`o.end_date >= ${this.today}::date`);
    if (s.mode.length && options.omit !== 'mode') {
      conds.push(sql`EXISTS (SELECT 1 FROM course_offering_delivery_modes m
        WHERE m.offering_id = o.id AND m.mode_code = ANY(${s.mode}::text[]))`);
    }
    if (s.lang.length && options.omit !== 'lang') {
      conds.push(sql`EXISTS (SELECT 1 FROM unnest(o.teaching_languages) AS tl(tag)
        WHERE split_part(tl.tag, '-', 1) = ANY(${s.lang}::text[]))`);
    }
    return sql.join(conds, sql` AND `);
  }

  /** Whether the offering filters restrict the course list. */
  private needsOffering(omit?: FacetKey): boolean {
    const s = this.search;
    return (
      s.upcoming || (s.mode.length > 0 && omit !== 'mode') || (s.lang.length > 0 && omit !== 'lang')
    );
  }

  /**
   * WHERE clause on `c`/`org`. `omit` drops one filter (disjunctive facets);
   * `offerings: false` leaves the offering filters to a join of the caller.
   */
  courseConditions(options: { omit?: FacetKey; offerings?: boolean } = {}): RawBuilder<unknown> {
    const s = this.search;
    const { omit } = options;
    const conds: RawBuilder<unknown>[] = [
      sql`c.status = 'published'`,
      sql`c.deleted_at IS NULL`,
      sql`org.deleted_at IS NULL`,
    ];
    if (this.text) conds.push(sql`c.id IN (SELECT course_id FROM hits)`);
    if (s.partner.length && omit !== 'partner') {
      conds.push(sql`org.slug = ANY(${s.partner}::text[])`);
    }
    if (s.isced.length && omit !== 'isced') {
      conds.push(sql`EXISTS (SELECT 1 FROM course_isced_codes i
        WHERE i.course_id = c.id AND i.broad_code = ANY(${s.isced}::text[]))`);
    }
    if (s.level.length && omit !== 'level') conds.push(sql`c.level = ANY(${s.level}::text[])`);
    if (s.ectsMin !== undefined) conds.push(sql`c.ects >= ${s.ectsMin}`);
    if (s.ectsMax !== undefined) conds.push(sql`c.ects <= ${s.ectsMax}`);
    if (options.offerings !== false && this.needsOffering(omit)) {
      conds.push(sql`EXISTS (SELECT 1 FROM course_offerings o
        WHERE o.course_id = c.id AND ${this.offeringConditions({ omit })})`);
    }
    return sql.join(conds, sql` AND `);
  }

  /** Total number of matching courses. */
  countQuery(): RawBuilder<{ total: string }> {
    return sql<{ total: string }>`${this.with()}SELECT count(*) AS total
      FROM courses c JOIN organizations org ON org.id = c.organization_id
      WHERE ${this.courseConditions()}`;
  }

  /** Ordered ids of one page. */
  pageQuery(): RawBuilder<{ id: string }> {
    const s = this.search;
    const title = sql`oecp_search_fold(coalesce(
        (SELECT t.title FROM course_texts t WHERE t.course_id = c.id AND t.lang = ${s.locale}),
        (SELECT t.title FROM course_texts t WHERE t.course_id = c.id AND t.lang = 'en')))`;
    const nextStart = sql`(SELECT min(o.start_date) FROM course_offerings o
        WHERE o.course_id = c.id AND ${this.offeringConditions({ forceUpcoming: true })})`;
    const order =
      s.sort === 'relevance' && this.text
        ? sql`h.rank DESC, next_start ASC NULLS LAST, title_key ASC, c.id`
        : s.sort === 'title'
          ? sql`title_key ASC, c.id`
          : sql`next_start ASC NULLS LAST, title_key ASC, c.id`;
    const hitsJoin = this.text ? sql`JOIN hits h ON h.course_id = c.id` : sql``;
    return sql<{
      id: string;
    }>`${this.with()}SELECT c.id, ${nextStart} AS next_start, ${title} AS title_key
      FROM courses c JOIN organizations org ON org.id = c.organization_id ${hitsJoin}
      WHERE ${this.courseConditions()}
      ORDER BY ${order}
      LIMIT ${s.pageSize} OFFSET ${(s.page - 1) * s.pageSize}`;
  }

  /** `{value, count}` rows of one facet, most frequent first. */
  facetQuery(facet: FacetKey): RawBuilder<{ value: string; count: string }> {
    const from = sql`FROM courses c JOIN organizations org ON org.id = c.organization_id`;
    const order = sql`ORDER BY count DESC, value ASC`;
    switch (facet) {
      case 'partner':
        return sql`${this.with()}SELECT org.slug AS value, count(*) AS count ${from}
          WHERE ${this.courseConditions({ omit: 'partner' })} GROUP BY org.slug ${order}`;
      case 'level':
        return sql`${this.with()}SELECT c.level AS value, count(*) AS count ${from}
          WHERE ${this.courseConditions({ omit: 'level' })} AND c.level IS NOT NULL
          GROUP BY c.level ${order}`;
      case 'isced':
        return sql`${this.with()}SELECT i.broad_code AS value, count(DISTINCT c.id) AS count ${from}
          JOIN course_isced_codes i ON i.course_id = c.id
          WHERE ${this.courseConditions({ omit: 'isced' })} GROUP BY i.broad_code ${order}`;
      case 'mode':
        return sql`${this.with()}SELECT m.mode_code AS value, count(DISTINCT c.id) AS count ${from}
          JOIN course_offerings o ON o.course_id = c.id
          JOIN course_offering_delivery_modes m ON m.offering_id = o.id
          WHERE ${this.courseConditions({ omit: 'mode', offerings: false })}
            AND ${this.offeringConditions({ omit: 'mode' })}
          GROUP BY m.mode_code ${order}`;
      case 'lang':
        return sql`${this.with()}SELECT split_part(tl.tag, '-', 1) AS value, count(DISTINCT c.id) AS count ${from}
          JOIN course_offerings o ON o.course_id = c.id
          CROSS JOIN LATERAL unnest(o.teaching_languages) AS tl(tag)
          WHERE ${this.courseConditions({ omit: 'lang', offerings: false })}
            AND ${this.offeringConditions({ omit: 'lang' })}
          GROUP BY split_part(tl.tag, '-', 1) ${order}`;
    }
  }
}
