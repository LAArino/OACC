-- SPDX-License-Identifier: EUPL-1.2
-- 0010_sync_run_files: original file names of a CSV upload on its run (spec §6.3,
-- §8.1 sync monitor; API member SyncRun.files).
--
--   * sync_runs.files: {"courses": "<name>", "offerings": "<name>"}, one member per
--     uploaded file, the name as the browser sent it (at most 200 characters, as in
--     the upload.create audit row). NULL for harvests, form saves and runs without
--     files. The names stay when the retention job purges the files themselves.
--   * Backfill from the upload.create audit rows (changes.files.<kind>.name).
--
-- Down drops the column.

-- Up Migration
ALTER TABLE sync_runs
  ADD COLUMN files jsonb
    CONSTRAINT sync_runs_files_check CHECK (
      jsonb_typeof(files) = 'object'
      AND files - 'courses' - 'offerings' = '{}'::jsonb
      AND files <> '{}'::jsonb
      AND (NOT files ? 'courses' OR (jsonb_typeof(files -> 'courses') = 'string'
           AND length(files ->> 'courses') BETWEEN 1 AND 200))
      AND (NOT files ? 'offerings' OR (jsonb_typeof(files -> 'offerings') = 'string'
           AND length(files ->> 'offerings') BETWEEN 1 AND 200)));

UPDATE sync_runs r SET files = f.files
FROM (
  SELECT a.entity_id AS id,
         jsonb_strip_nulls(jsonb_build_object(
           'courses', left(nullif(a.changes #>> '{files,courses,name}', ''), 200),
           'offerings', left(nullif(a.changes #>> '{files,offerings,name}', ''), 200))) AS files
  FROM audit_log a
  WHERE a.action = 'upload.create' AND a.entity_type = 'sync_run'
) f
WHERE r.id = f.id AND r.channel = 'csv' AND f.files <> '{}'::jsonb;

-- Down Migration
ALTER TABLE sync_runs DROP COLUMN IF EXISTS files;
