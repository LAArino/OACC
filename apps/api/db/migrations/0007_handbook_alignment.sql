-- SPDX-License-Identifier: EUPL-1.2
-- 0007_handbook_alignment: the catalogue data model agreed in the Aurora IT
-- Handbook §3.4 (decision 21; docs/research/aurora-it-handbook-data-model.md).
--
--   * courses.instructors: names (or role descriptions) of the teaching staff, as
--     the university publishes them in its own catalogue; primary first, at most
--     50 entries of 1–200 characters. Optional to fill (decision 21a); required
--     only by the handbook publication rule, which the application enforces
--     (OECP_PUBLISH_RULE, spec §6.1), not the database.
--   * course_texts gains five optional multilingual texts of the handbook:
--     mode_of_repetition, methods, literature, privacy_notice, remarks.
--   * The search vector also indexes methods, literature and remarks (weight C,
--     with description, outcomes, prerequisites and assessment); mode of
--     repetition and the privacy notice are not searchable. PostgreSQL 16 cannot
--     change a generation expression in place, so search_vector is dropped and
--     re-added (and its GIN index recreated), as 0004 did.
--
-- Does not depend on 0006. Down restores the 0006 (or 0005) schema exactly,
-- column order of course_texts included.

-- Up Migration
CREATE FUNCTION oecp_valid_instructors(a text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT cardinality(a) <= 50 AND NOT EXISTS (
    SELECT 1 FROM unnest(a) AS i(name)
    WHERE i.name IS NULL OR length(i.name) NOT BETWEEN 1 AND 200)
$$;

ALTER TABLE courses
  ADD COLUMN instructors text[] NOT NULL DEFAULT '{}'
    CONSTRAINT courses_instructors_check CHECK (oecp_valid_instructors(instructors));

ALTER TABLE course_texts
  ADD COLUMN mode_of_repetition text,
  ADD COLUMN methods text,
  ADD COLUMN literature text,
  ADD COLUMN privacy_notice text,
  ADD COLUMN remarks text;

CREATE FUNCTION oecp_course_search_vector(
  lang text, title text, keywords text[], abstract text,
  description text, learning_outcomes text, prerequisites text, assessment text,
  methods text, literature text, remarks text)
RETURNS tsvector LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE cfg regconfig := oecp_ts_config(lang);
BEGIN
  RETURN setweight(to_tsvector(cfg, coalesce(title, '')), 'A')
      || setweight(to_tsvector(cfg, coalesce(array_to_string(keywords, ' '), '') || ' '
                                    || coalesce(abstract, '')), 'B')
      || setweight(to_tsvector(cfg, concat_ws(' ', description, learning_outcomes,
                                              prerequisites, assessment,
                                              methods, literature, remarks)), 'C');
END $$;

ALTER TABLE course_texts DROP COLUMN search_vector;
ALTER TABLE course_texts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS
  (oecp_course_search_vector(lang, title, keywords, abstract, description,
                             learning_outcomes, prerequisites, assessment,
                             methods, literature, remarks)) STORED;
CREATE INDEX course_texts_fts ON course_texts USING gin (search_vector);

DROP FUNCTION oecp_course_search_vector(text, text, text[], text, text, text, text, text);

-- Down Migration
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

ALTER TABLE course_texts DROP COLUMN search_vector;
ALTER TABLE course_texts
  DROP COLUMN mode_of_repetition,
  DROP COLUMN methods,
  DROP COLUMN literature,
  DROP COLUMN privacy_notice,
  DROP COLUMN remarks;
ALTER TABLE course_texts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS
  (oecp_course_search_vector(lang, title, keywords, abstract, description,
                             learning_outcomes, prerequisites, assessment)) STORED;
CREATE INDEX course_texts_fts ON course_texts USING gin (search_vector);

DROP FUNCTION oecp_course_search_vector(text, text, text[], text, text, text, text, text,
                                        text, text, text);

ALTER TABLE courses DROP COLUMN instructors;
DROP FUNCTION oecp_valid_instructors(text[]);
