-- SPDX-License-Identifier: EUPL-1.2
-- 0009_course_level_trigger: courses.level is derived from courses.levels at the
-- database (decision 18 d; spec v4.1 §5.2).
--
--   * levels holds every study cycle, primary first; level is the primary one,
--     kept only because the OEAPI v5 read API can express a single level.
--     CanonicalWriter already writes level = levels[1]; the trigger enforces it
--     for every other writer too (manual SQL, future code): on INSERT and on any
--     UPDATE that names levels or level, level := levels[1] (NULL when levels is
--     empty). A write of level alone is therefore replaced by levels[1]: change
--     levels instead.
--   * Backfill, without touching updated_at (the writer never produced such
--     rows; manual SQL might): a level without levels becomes levels = {level},
--     as 0005 did; then every level that differs from levels[1] is corrected.
--
-- Down drops the trigger and its function; the data stay as they are.

-- Up Migration
CREATE FUNCTION oecp_courses_level_from_levels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.level := NEW.levels[1];
  RETURN NEW;
END $$;

SET CONSTRAINTS courses_publishable IMMEDIATE;
ALTER TABLE courses DISABLE TRIGGER courses_set_updated_at;
UPDATE courses SET levels = ARRAY[level] WHERE level IS NOT NULL AND cardinality(levels) = 0;
UPDATE courses SET level = levels[1] WHERE level IS DISTINCT FROM levels[1];
ALTER TABLE courses ENABLE TRIGGER courses_set_updated_at;
SET CONSTRAINTS courses_publishable DEFERRED;

CREATE TRIGGER courses_level_from_levels BEFORE INSERT OR UPDATE OF levels, level ON courses
  FOR EACH ROW EXECUTE FUNCTION oecp_courses_level_from_levels();

-- Down Migration
DROP TRIGGER IF EXISTS courses_level_from_levels ON courses;
DROP FUNCTION IF EXISTS oecp_courses_level_from_levels();
