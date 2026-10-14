-- SPDX-License-Identifier: EUPL-1.2
-- 0006_maintenance: bookkeeping for the worker's maintenance jobs (spec §2.2,
-- §5.4, §10).
--
--   * maintenance_runs: one row per run of a maintenance job (history-partitions,
--     retention, dormancy, csv-retention, ...): trigger, status, counters, error.
--     Kept 12 months by the retention job.
--   * admin_activity: when each administrator (JWT `sub`) last used the admin API,
--     written by AdminJwtGuard at most once per hour per `sub`; read by the
--     dormancy job (180 days). Deliberately no IP address or user agent (data
--     minimisation). Rows idle for 12 months are deleted by the retention job.
--   * Indexes for the batched retention deletes (`created_at` / `occurred_at`
--     ranges) and for the foreign key ext_metadata_history.sync_run_id, which
--     PostgreSQL checks on every `sync_runs` delete.
--
-- Monthly partitions of ext_metadata_history are NOT created by migrations: the
-- worker job `history-partitions` (apps/api/src/maintenance) keeps the current
-- month and the next three, moves rows that fell into the default partition into
-- their month and drops partitions older than OECP_RETENTION_HISTORY_MONTHS. It
-- runs at worker start and daily. 0001 created only `_default` and `_2026_11`.
--
-- The time this migration ran (pgmigrations.run_on of `0006_maintenance`) is the
-- start of activity tracking: the dormancy job never counts inactivity from
-- before it.

-- Up Migration
CREATE TABLE maintenance_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job           text NOT NULL CHECK (job ~ '^[a-z][a-z0-9-]{1,62}$'),
  trigger_kind  text NOT NULL CHECK (trigger_kind IN ('schedule', 'startup', 'manual')),
  triggered_by  text,                               -- JWT sub for manual runs
  status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  counters      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(counters) = 'object'),
  details       jsonb,
  error         text,
  CHECK ((status = 'running') = (finished_at IS NULL)),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX maintenance_runs_recent ON maintenance_runs (started_at DESC);
CREATE INDEX maintenance_runs_job_recent ON maintenance_runs (job, started_at DESC);

CREATE TABLE admin_activity (
  sub              text PRIMARY KEY CHECK (length(sub) BETWEEN 1 AND 255),
  organization_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
  last_seen_at     timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_activity_last_seen ON admin_activity (last_seen_at);

CREATE INDEX sync_errors_created ON sync_errors (created_at);
CREATE INDEX sync_runs_created ON sync_runs (created_at);
CREATE INDEX audit_log_occurred ON audit_log (occurred_at);
CREATE INDEX ext_history_sync_run ON ext_metadata_history (sync_run_id);

-- Down Migration
-- Partitions created by the history-partitions job are kept: they are ordinary
-- partitions of ext_metadata_history.
DROP INDEX IF EXISTS ext_history_sync_run;
DROP INDEX IF EXISTS audit_log_occurred;
DROP INDEX IF EXISTS sync_runs_created;
DROP INDEX IF EXISTS sync_errors_created;
DROP TABLE IF EXISTS admin_activity;
DROP TABLE IF EXISTS maintenance_runs;
