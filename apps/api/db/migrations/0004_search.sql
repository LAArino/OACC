-- SPDX-License-Identifier: EUPL-1.2
-- 0004_search: full-text search and title suggestions for the public catalogue
-- (spec §5 "Search", §7, §9).
--
-- 0001 already creates the per-language text search configurations (oecp_en …
-- oecp_ca, oecp_simple: unaccent, then the Snowball stemmer) and a first
-- search_vector. This migration:
--   * asserts that the Snowball `catalan` configuration exists (spec §5: PostgreSQL
--     14+ ships it; the image build checks it too, this guards foreign servers);
--   * maps every language explicitly in oecp_ts_config (cs and is have no stemmer
--     and use oecp_simple, like any language without a configuration);
--   * rebuilds course_texts.search_vector with the weights of the portal ranking:
--     A title; B keywords and abstract; C description, learning outcomes,
--     prerequisites and assessment (0001 indexed only title, keywords, abstract,
--     description and outcomes, with keywords at A);
--   * adds oecp_search_fold(text) = lower(unaccent(text)), IMMUTABLE, and rebuilds
--     the pg_trgm index of titles on it, so queries and index share one expression;
--   * adds partial indexes for the published-only predicates of the public APIs.
--
-- unaccent() itself is only STABLE (it reads a dictionary by search_path), so it is
-- wrapped in IMMUTABLE functions with the dictionary schema-qualified (0001
-- oecp_unaccent), as is customary for index expressions.

-- Up Migration
DO $$
BEGIN
  PERFORM 'pg_catalog.catalan'::regconfig;
  PERFORM 'pg_catalog.catalan_stem'::regdictionary;
EXCEPTION WHEN undefined_object THEN
  RAISE EXCEPTION 'Snowball text search configuration "catalan" is missing (PostgreSQL 14+ required)';
END $$;

CREATE OR REPLACE FUNCTION oecp_ts_config(lang text) RETURNS regconfig
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (CASE split_part(lower(lang), '-', 1)
    WHEN 'en' THEN 'oecp_en' WHEN 'de' THEN 'oecp_de' WHEN 'nl' THEN 'oecp_nl' WHEN 'it' THEN 'oecp_it'
    WHEN 'fr' THEN 'oecp_fr' WHEN 'da' THEN 'oecp_da' WHEN 'es' THEN 'oecp_es' WHEN 'ca' THEN 'oecp_ca'
    WHEN 'cs' THEN 'oecp_simple' WHEN 'is' THEN 'oecp_simple'
    ELSE 'oecp_simple' END)::regconfig
$$;

CREATE FUNCTION oecp_search_fold(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1))
$$;

CREATE FUNCTION oecp_course_search_vector(
  lang text, title text, keywords text[], abstract text,
  description text, learning_outcomes text, prerequisites text, assessment text)
RETURNS tsvector LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE cfg regconfig := oecp_ts_config(lang);
BEGIN
  RETURN setweight(to_tsvector(cfg, coalesce(title, '')), 'A')
      || setweight(to_tsvector(cfg, coalesce(array_to_string(keywords, ' '), '') || ' '
                                    || coalesce(abstract, '')), 'B')
      || setweight(to_tsvector(cfg, concat_ws(' ', description, learning_outcomes,
                                              prerequisites, assessment)), 'C');
END $$;

-- PostgreSQL 16 cannot change a generation expression in place: drop and re-add
-- (the column's GIN index goes with it and is recreated below).
ALTER TABLE course_texts DROP COLUMN search_vector;
ALTER TABLE course_texts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS
  (oecp_course_search_vector(lang, title, keywords, abstract, description,
                             learning_outcomes, prerequisites, assessment)) STORED;
CREATE INDEX course_texts_fts ON course_texts USING gin (search_vector);

DROP INDEX course_texts_title_trgm;
CREATE INDEX course_texts_title_trgm ON course_texts USING gin (oecp_search_fold(title) gin_trgm_ops);

CREATE INDEX courses_published ON courses (organization_id)
  WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX offerings_course_visible ON course_offerings (course_id, start_date, end_date)
  WHERE status IN ('published', 'cancelled') AND deleted_at IS NULL;

DROP FUNCTION oecp_course_tsv(text, text, text[], text, text);

-- Down Migration
DROP INDEX IF EXISTS offerings_course_visible;
DROP INDEX IF EXISTS courses_published;

CREATE OR REPLACE FUNCTION oecp_course_tsv(lang text, title text, keywords text[], abstract text, body text)
RETURNS tsvector LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE cfg regconfig := oecp_ts_config(lang);
BEGIN
  RETURN setweight(to_tsvector(cfg, coalesce(title, '')), 'A')
      || setweight(to_tsvector(cfg, coalesce(array_to_string(keywords, ' '), '')), 'A')
      || setweight(to_tsvector(cfg, coalesce(abstract, '')), 'B')
      || setweight(to_tsvector(cfg, coalesce(body, '')), 'C');
END $$;

ALTER TABLE course_texts DROP COLUMN search_vector;
ALTER TABLE course_texts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS
  (oecp_course_tsv(lang, title, keywords, abstract,
                   coalesce(description, '') || ' ' || coalesce(learning_outcomes, ''))) STORED;
CREATE INDEX course_texts_fts ON course_texts USING gin (search_vector);

DROP INDEX IF EXISTS course_texts_title_trgm;
CREATE INDEX course_texts_title_trgm ON course_texts USING gin (lower(oecp_unaccent(title)) gin_trgm_ops);

DROP FUNCTION IF EXISTS oecp_course_search_vector(text, text, text[], text, text, text, text, text);
DROP FUNCTION IF EXISTS oecp_search_fold(text);

CREATE OR REPLACE FUNCTION oecp_ts_config(lang text) RETURNS regconfig
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (CASE split_part(lower(lang), '-', 1)
    WHEN 'en' THEN 'oecp_en' WHEN 'de' THEN 'oecp_de' WHEN 'nl' THEN 'oecp_nl' WHEN 'it' THEN 'oecp_it'
    WHEN 'fr' THEN 'oecp_fr' WHEN 'da' THEN 'oecp_da' WHEN 'es' THEN 'oecp_es' WHEN 'ca' THEN 'oecp_ca'
    ELSE 'oecp_simple' END)::regconfig
$$;
