// SPDX-License-Identifier: EUPL-1.2
/**
 * Admin API contracts of the worker's maintenance jobs (spec §2.2, §5.4, §10):
 * `GET /api/admin/v1/maintenance/runs` and
 * `POST /api/admin/v1/maintenance/jobs/{name}/run` (alliance_admin).
 */
import { z } from 'zod';
import { isoDateTime, uuid } from './primitives.js';

/** Job names: lower-case words joined by hyphens, e.g. `history-partitions`. */
export const MAINTENANCE_JOB_NAME_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
export const maintenanceJobName = z.string().regex(MAINTENANCE_JOB_NAME_PATTERN);

export const maintenanceTrigger = z.enum(['schedule', 'startup', 'manual']);
export type MaintenanceTrigger = z.infer<typeof maintenanceTrigger>;

export const maintenanceRunStatus = z.enum(['running', 'succeeded', 'failed', 'skipped']);
export type MaintenanceRunStatus = z.infer<typeof maintenanceRunStatus>;

/** One run of a maintenance job (`maintenance_runs`, kept 12 months). */
export const maintenanceRun = z.object({
  id: uuid,
  job: maintenanceJobName,
  trigger_kind: maintenanceTrigger,
  /** JWT `sub` of the alliance_admin who asked for a manual run. */
  triggered_by: z.string().nullable(),
  status: maintenanceRunStatus,
  started_at: isoDateTime,
  finished_at: isoDateTime.nullable(),
  duration_ms: z.int().nonnegative().nullable(),
  /** Job-specific counts, e.g. `{partitions_created: 1, rows_moved: 120}`. */
  counters: z.record(z.string(), z.number()),
  /** Job-specific review data, e.g. the dormancy candidates. */
  details: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
});
export type MaintenanceRun = z.infer<typeof maintenanceRun>;

/** `GET /api/admin/v1/maintenance/runs?limit=&job=` */
export const maintenanceRunListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  job: maintenanceJobName.optional(),
});
export type MaintenanceRunListQuery = z.infer<typeof maintenanceRunListQuery>;

export const maintenanceRunList = z.object({ items: z.array(maintenanceRun) });
export type MaintenanceRunList = z.infer<typeof maintenanceRunList>;

/**
 * `POST /api/admin/v1/maintenance/jobs/{name}/run` → 202. `already_queued`: a
 * manual run of the job is still waiting or running; no second one is added.
 */
export const maintenanceJobRunResponse = z.object({
  job: maintenanceJobName,
  status: z.enum(['queued', 'already_queued']),
});
export type MaintenanceJobRunResponse = z.infer<typeof maintenanceJobRunResponse>;
