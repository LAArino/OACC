// SPDX-License-Identifier: EUPL-1.2
import { type AttributeDefinition, courseSearchQuery, normalizeCourseSearch } from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import { CourseSearchSql, parseTextQuery, TS_CONFIGS } from '../../src/catalogue/search-sql.js';
import { createFakeDb } from '../support/fake-kysely.js';

const { db } = createFakeDb();
const DEFINITIONS: AttributeDefinition[] = [
  {
    key: 'free_course',
    value_type: 'boolean',
    label: { en: 'Free course' },
    description: null,
    options: null,
    filterable: true,
    show_as_tag: true,
    sort_order: 0,
  },
  {
    key: 'sdg',
    value_type: 'multi_enum',
    label: { en: 'SDG' },
    description: null,
    options: [{ value: 'sdg04', label: { en: 'SDG 4' } }],
    filterable: true,
    show_as_tag: true,
    sort_order: 1,
  },
  {
    key: 'competence_framework',
    value_type: 'enum',
    label: { en: 'Framework' },
    description: null,
    options: [{ value: 'louis', label: { en: 'LOUIS' } }],
    filterable: false,
    show_as_tag: false,
    sort_order: 2,
  },
];
const plan = (query: Record<string, unknown>) =>
  new CourseSearchSql(
    normalizeCourseSearch(courseSearchQuery.parse(query)),
    '2026-10-14',
    DEFINITIONS,
  );
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
    expect(s).toContain('c.levels && $3::text[]');
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

  it('filters by kind and by attributes with jsonb containment, ignoring unknown keys', () => {
    const { sql, parameters } = compile(
      plan({
        kind: ['bip', 'lecture_series'],
        attr_free_course: ['true', 'maybe'],
        attr_sdg: 'sdg04',
        attr_competence_framework: 'louis',
        attr_not_defined: 'x',
        upcoming: 'false',
      }).countQuery(),
    );
    const s = squash(sql);
    expect(s).toContain('c.kind = ANY($1::text[])');
    expect(s).toContain('(c.attributes @> $2::jsonb OR false)');
    expect(s).toContain('(c.attributes @> $3::jsonb)');
    expect(s).toContain('(c.attributes @> $4::jsonb)');
    expect(parameters).toEqual([
      ['bip', 'lecture_series'],
      '{"free_course":true}',
      '{"sdg":["sdg04"]}',
      '{"competence_framework":"louis"}',
    ]);
    expect(s).not.toContain('not_defined');
  });

  it('has one facet per filterable definition, each omitting its own filter', () => {
    const p = plan({ attr_sdg: 'sdg04', attr_free_course: 'true', level: 'master' });
    expect(p.facetKeys()).toEqual([
      'partner',
      'mode',
      'lang',
      'isced',
      'level',
      'kind',
      'attr:free_course',
      'attr:sdg',
    ]);
    const sdg = squash(compile(p.facetQuery('attr:sdg')).sql);
    expect(sdg).toContain('jsonb_array_elements_text');
    expect(sdg).not.toContain('{"sdg"');
    const sdgParams = compile(p.facetQuery('attr:sdg')).parameters;
    expect(sdgParams).toContain('{"free_course":true}');
    expect(sdgParams).not.toContain('{"sdg":["sdg04"]}');
    const free = compile(p.facetQuery('attr:free_course'));
    expect(squash(free.sql)).toContain('jsonb_typeof(c.attributes -> $');
    expect(free.parameters).not.toContain('{"free_course":true}');
    const level = squash(compile(p.facetQuery('level')).sql);
    expect(level).toContain('unnest(c.levels)');
    expect(level).not.toContain('c.levels &&');
    expect(squash(compile(p.facetQuery('kind')).sql)).toContain('GROUP BY c.kind');
  });

  it('sorts by the next upcoming application deadline, courses without one last', () => {
    const { sql, parameters } = compile(plan({ sort: 'deadline' }).pageQuery());
    const s = squash(sql);
    expect(s).toContain('min(o.application_deadline)');
    expect(s).toContain('AND o.application_deadline >= $');
    expect(s).toContain(
      'ORDER BY next_deadline ASC NULLS LAST, next_start ASC NULLS LAST, title_key ASC, c.id',
    );
    expect(parameters.filter((p) => p === '2026-10-14').length).toBeGreaterThanOrEqual(3);
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
