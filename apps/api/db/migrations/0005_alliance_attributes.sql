-- SPDX-License-Identifier: EUPL-1.2
-- 0005_alliance_attributes: alliance-level course attributes and Aurora Virtual
-- Campus parity (decision 18; docs/research/aurora-virtual-campus-draft.md).
--
--   * courses.kind: course / bip / lecture_series / other.
--   * courses.levels: every study cycle of a course ("Bachelor, Master"), primary
--     first; backfilled from `level`. `level` stays the primary level (the one the
--     OEAPI read API can express); CanonicalWriter keeps level = levels[1] (no trigger).
--   * courses.attributes: values of the alliance's attributes, keyed by attribute
--     key (string | string[] | boolean), validated against attribute_definitions
--     by the writer; GIN (jsonb_path_ops) for containment filters.
--   * course_offerings.application_instructions: how to apply (e.g. a nomination
--     process), keyed by primary language subtag, next to application_url.
--   * attribute_definitions: the attributes one deployment's alliance defines,
--     seeded by `oecp seed-attribute-definitions` (one alliance per deployment, so
--     no organization_id).
--
-- The backfill does not touch updated_at (sitemap lastmod): the row trigger is
-- disabled for its UPDATE. The deferred courses_publishable check is made immediate
-- around it, so that no trigger event is pending when the table is altered again.

-- Up Migration
CREATE FUNCTION oecp_valid_attributes(a jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT jsonb_typeof(a) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(a) AS e(key, value)
    WHERE e.key !~ '^[a-z][a-z0-9_]{1,39}$'
       OR NOT (
         jsonb_typeof(e.value) IN ('string', 'boolean')
         OR (jsonb_typeof(e.value) = 'array'
             AND jsonb_array_length(e.value) > 0
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) AS v(item)
                             WHERE jsonb_typeof(v.item) <> 'string'))))
$$;

CREATE FUNCTION oecp_valid_language_texts(m jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT jsonb_typeof(m) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(m) AS e(key, value)
    WHERE e.key !~ '^[a-z]{2,3}$' OR jsonb_typeof(e.value) <> 'string' OR e.value = '""'::jsonb)
$$;

CREATE FUNCTION oecp_valid_attribute_options(o jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT jsonb_typeof(o) = 'array' AND jsonb_array_length(o) > 0 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(o) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
       OR jsonb_typeof(e.item -> 'value') IS DISTINCT FROM 'string'
       OR (e.item ->> 'value') !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
       OR jsonb_typeof(e.item -> 'label') IS DISTINCT FROM 'object'
       OR NOT ((e.item -> 'label') ? 'en'))
  AND (SELECT count(DISTINCT e.item ->> 'value') FROM jsonb_array_elements(o) AS e(item))
      = jsonb_array_length(o)
$$;

ALTER TABLE courses
  ADD COLUMN kind text NOT NULL DEFAULT 'course'
    CONSTRAINT courses_kind_check CHECK (kind IN ('course', 'bip', 'lecture_series', 'other')),
  ADD COLUMN levels text[] NOT NULL DEFAULT '{}'
    CONSTRAINT courses_levels_check CHECK (
      levels <@ ARRAY['short_cycle', 'bachelor', 'master', 'doctoral', 'other']::text[]
      AND cardinality(levels) <= 5),
  ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT courses_attributes_check CHECK (oecp_valid_attributes(attributes));

SET CONSTRAINTS courses_publishable IMMEDIATE;
ALTER TABLE courses DISABLE TRIGGER courses_set_updated_at;
UPDATE courses SET levels = ARRAY[level] WHERE level IS NOT NULL;
ALTER TABLE courses ENABLE TRIGGER courses_set_updated_at;
SET CONSTRAINTS courses_publishable DEFERRED;

CREATE INDEX courses_attributes ON courses USING gin (attributes jsonb_path_ops);

ALTER TABLE course_offerings
  ADD COLUMN application_instructions jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT course_offerings_application_instructions_check
    CHECK (oecp_valid_language_texts(application_instructions));

CREATE TABLE attribute_definitions (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  value_type   text NOT NULL CHECK (value_type IN ('enum', 'multi_enum', 'boolean', 'text')),
  label        jsonb NOT NULL CHECK (jsonb_typeof(label) = 'object' AND label ? 'en'),
  description  jsonb CHECK (description IS NULL
                            OR (jsonb_typeof(description) = 'object' AND description ? 'en')),
  options      jsonb CHECK (options IS NULL OR oecp_valid_attribute_options(options)),
  filterable   boolean NOT NULL DEFAULT false,
  show_as_tag  boolean NOT NULL DEFAULT true,
  sort_order   smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- options are required for enum/multi_enum and meaningless otherwise.
  CHECK ((value_type IN ('enum', 'multi_enum')) = (options IS NOT NULL))
);
CREATE TRIGGER attribute_definitions_set_updated_at BEFORE UPDATE ON attribute_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS attribute_definitions;

-- Overrides of the new fields go with them; a course with levels but no level keeps
-- its primary level (the writer never produces that state, manual SQL might).
SET CONSTRAINTS courses_publishable IMMEDIATE;
ALTER TABLE courses DISABLE TRIGGER courses_set_updated_at;
UPDATE courses SET level = levels[1] WHERE level IS NULL AND cardinality(levels) > 0;
UPDATE courses SET overrides = overrides - 'kind' - 'levels' - 'attributes'
  WHERE overrides ?| ARRAY['kind', 'levels', 'attributes'];
ALTER TABLE courses ENABLE TRIGGER courses_set_updated_at;
SET CONSTRAINTS courses_publishable DEFERRED;
ALTER TABLE course_offerings DISABLE TRIGGER course_offerings_set_updated_at;
UPDATE course_offerings SET overrides = overrides - 'application_instructions'
  WHERE overrides ? 'application_instructions';
ALTER TABLE course_offerings ENABLE TRIGGER course_offerings_set_updated_at;

ALTER TABLE course_offerings DROP COLUMN IF EXISTS application_instructions;
DROP INDEX IF EXISTS courses_attributes;
ALTER TABLE courses
  DROP COLUMN IF EXISTS attributes,
  DROP COLUMN IF EXISTS levels,
  DROP COLUMN IF EXISTS kind;

DROP FUNCTION IF EXISTS oecp_valid_attribute_options(jsonb);
DROP FUNCTION IF EXISTS oecp_valid_language_texts(jsonb);
DROP FUNCTION IF EXISTS oecp_valid_attributes(jsonb);
