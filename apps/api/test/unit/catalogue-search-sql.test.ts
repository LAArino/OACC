// SPDX-License-Identifier: EUPL-1.2
import { courseSearchQuery, normalizeCourseSearch } from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import { CourseSearchSql, parseTextQuery, TS_CONFIGS } from '../../src/catalogue/search-sql.js';
import { createFakeDb } from '../support/fake-kysely.js';

const { db } = createFakeDb();
const plan = (query: Record<string, unknown>) =>
  new CourseSearchSql(normalizeCourseSearch(courseSearchQuery.parse(query)), '2026-10-14');
const compile = (b: { compile(db: never): { sql: string; parameters: readonly unknown[] } }) =>
  b.compile(db as never);
const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('parseTextQuery', () => {
  it.each([
    ['quantum', { prefix: "'quantum':*", trigram: 'quantum' }],
    ['Física', { prefix: "'física':*", trigram: 'física' }],
    ['ab', { prefix: "'ab':*", trigram: null }],
    ['quantum computing', { prefix: null, trigram: null }],
    ['C++', { prefix: null, trigram: null }],
    ["o'brien", { prefix: null, trigram: null }],
    ['a'.repeat(31), { prefix: `'${'a'.repeat(31)}':*`, trigram: null }],
  ])('%s', (q, expected) => {
    expect(parseTextQuery(q)).toEqual({ q, ...expected });
  });
});

describe('CourseSearchSql', () => {
  it('lists published, upcoming courses by next start without a text query', () => {
    const { sql, parameters } = compile(plan({}).pageQuery());
    const s = squash(sql);
    expect(s).not.toContain('WITH hits');
    expect(s).toContain(
      "c.status = 'published' AND c.deleted_at IS NULL AND org.deleted_at IS NULL",
    );
    expect(s).toContain("o.status = 'published' AND o.deleted_at IS NULL AND o.end_date >= $");
    expect(s).toContain('ORDER BY next_start ASC NULLS LAST, title_key ASC, c.id');
    expect(parameters).toEqual(['2026-10-14', 'en', '2026-10-14', 20, 0]);
  });

  it('drops the upcoming condition with upcoming=false', () => {
    const s = squash(compile(plan({ upcoming: 'false' }).countQuery()).sql);
    expect(s).not.toContain('EXISTS (SELECT 1 FROM course_offerings');
  });

  it('ORs one full-text branch per configuration and ranks by relevance', () => {
    const { sql, parameters } = compile(plan({ q: 'quantum' }).pageQuery());
    for (const cfg of TS_CONFIGS) {
      expect(sql).toContain(
        `(oecp_ts_config(t.lang) = '${cfg}'::regconfig AND t.search_vector @@ (websearch_to_tsquery('${cfg}'::regconfig, $`,
      );
    }
    expect(sql).toContain('<% oecp_search_fold(t.title)');
    expect(sql).toContain('+ 0.3 * similarity(oecp_search_fold(t.title)');
    expect(squash(sql)).toContain('ORDER BY h.rank DESC, next_start ASC NULLS LAST');
    expect(parameters).toContain("'quantum':*");
  });

  it('uses no prefix or trigram branch for several words', () => {
    const { sql } = compile(plan({ q: 'quantum computing' }).countQuery());
    expect(sql).not.toMatch(/(^|[^_])to_tsquery\(/);
    expect(sql).not.toContain('<%');
    expect(sql).toContain('websearch_to_tsquery');
  });

  it('applies list filters as parameters', () => {
    const { sql, parameters } = compile(
      plan({
        partner: ['uibk', 'urv'],
        isced: '06',
        level: 'master',
        ects_min: '3',
        ectsMax: '10',
        mode: 'online',
        lang: 'en',
      }).countQuery(),
    );
    const s = squash(sql);
    expect(s).toContain('org.slug = ANY($1::text[])');
    expect(s).toContain('i.broad_code = ANY($2::text[])');
    expect(s).toContain('c.level = ANY($3::text[])');
    expect(s).toContain('c.ects >= $4 AND c.ects <= $5');
    expect(s).toContain('m.mode_code = ANY($7::text[])');
    expect(s).toContain("split_part(tl.tag, '-', 1) = ANY($8::text[])");
    expect(parameters).toEqual([
      ['uibk', 'urv'],
      ['06'],
      ['master'],
      3,
      10,
      '2026-10-14',
      ['online'],
      ['en'],
    ]);
  });

  it('omits the facet own filter (disjunctive facets)', () => {
    const p = plan({ partner: 'uibk', mode: 'online' });
    const partner = compile(p.facetQuery('partner'));
    expect(partner.sql).not.toContain('org.slug = ANY');
    expect(partner.sql).toContain('m.mode_code = ANY');
    const mode = compile(p.facetQuery('mode'));
    expect(mode.sql).toContain('org.slug = ANY');
    expect(mode.sql).not.toContain('m.mode_code = ANY');
    expect(mode.sql).toContain('GROUP BY m.mode_code');
  });

  it('sorts by title or relevance as asked', () => {
    expect(squash(compile(plan({ sort: 'title' }).pageQuery()).sql)).toContain(
      'ORDER BY title_key ASC, c.id',
    );
    // relevance without q falls back to the next start date
    expect(squash(compile(plan({ sort: 'relevance' }).pageQuery()).sql)).toContain(
      'ORDER BY next_start ASC',
    );
  });

  it('pages with LIMIT/OFFSET', () => {
    const { parameters } = compile(plan({ page: '3', pageSize: '5' }).pageQuery());
    expect(parameters.slice(-2)).toEqual([5, 10]);
  });
});
