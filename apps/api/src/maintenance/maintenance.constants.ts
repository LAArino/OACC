// SPDX-License-Identifier: EUPL-1.2
import { z } from 'zod';
import type { Env } from '../config/env.js';
import {
  IDP_METADATA_REFRESH_CRON,
  IDP_METADATA_REFRESH_JOB,
} from '../identity/metadata-refresh/idp-metadata-refresh.constants.js';
import { CSV_RETENTION_JOB } from '../ingestion/csv/csv.constants.js';

/** BullMQ queue of the worker's maintenance jobs (daily schedules and on-demand runs). */
export const MAINTENANCE_QUEUE = 'maintenance';

export const HISTORY_PARTITIONS_JOB = 'history-partitions';
export const RETENTION_JOB = 'retention';
export const DORMANCY_JOB = 'dormancy';
export const ACCOUNT_CLEANUP_JOB = 'account-cleanup';

/**
 * Daily schedules (UTC), staggered around the 04:30 upload retention of the `csv`
 * queue. `idp-metadata-refresh` (04:15, spec §4) runs here too since 0.4, so its
 * scheduled and start-up runs are recorded like the others.
 */
export const MAINTENANCE_SCHEDULES = [
  { job: HISTORY_PARTITIONS_JOB, pattern: '10 0 * * *' },
  { job: RETENTION_JOB, pattern: '45 4 * * *' },
  { job: DORMANCY_JOB, pattern: '0 5 * * *' },
  { job: ACCOUNT_CLEANUP_JOB, pattern: '15 5 * * *' },
  { job: IDP_METADATA_REFRESH_JOB, pattern: IDP_METADATA_REFRESH_CRON },
] as const;

/** Job scheduler id of a daily maintenance job. */
export const maintenanceSchedulerId = (job: string): string => `maintenance-${job}-daily`;

/**
 * Jobs an alliance_admin may run on demand (`POST /api/admin/v1/maintenance/jobs/{name}/run`).
 * Every name is enqueued on {@link MAINTENANCE_QUEUE} and executed by
 * MaintenanceProcessor in the worker, which records a `maintenance_runs` row.
 */
export const ON_DEMAND_JOBS: readonly string[] = [
  HISTORY_PARTITIONS_JOB,
  RETENTION_JOB,
  DORMANCY_JOB,
  ACCOUNT_CLEANUP_JOB,
  CSV_RETENTION_JOB,
  IDP_METADATA_REFRESH_JOB,
];

/** Data of a maintenance job. Scheduled jobs carry `{}`. */
export const maintenanceJobData = z.object({
  trigger: z.enum(['schedule', 'startup', 'manual']).default('schedule'),
  /** JWT `sub` of the alliance_admin who asked for an on-demand run. */
  triggeredBy: z.string().min(1).max(255).optional(),
  /** `idp-metadata-refresh` start-up run: reuse a cached aggregate younger than this. */
  reuseCacheMaxAgeMs: z.int().positive().optional(),
});
export type MaintenanceJobData = z.input<typeof maintenanceJobData>;

/** BullMQ refuses ':' in custom ids. One pending on-demand run per job name. */
export const manualJobId = (job: string): string => `manual-${job}`;
/** One pending start-up run per job name. */
export const startupJobId = (job: string): string => `startup-${job}`;
export const STARTUP_JOB_ID = startupJobId(HISTORY_PARTITIONS_JOB);
/** Delay of the `idp-metadata-refresh` start-up run (lets Keycloak and its import settle). */
export const IDP_METADATA_STARTUP_DELAY_MS = 60_000;

/** `audit_log.actor_sub` of system-driven changes. */
export const DORMANCY_ACTOR = 'system:dormancy';
export const ACCOUNT_CLEANUP_ACTOR = 'system:account-cleanup';

/** Settings of the maintenance jobs (spec §2.2, §10), read from the environment. */
export interface MaintenanceOptions {
  historyRetentionMonths: number;
  syncErrorsRetentionMonths: number;
  syncRunsRetentionMonths: number;
  auditRetentionMonths: number;
  /** Soft-deleted courses, offerings and organizations (`deleted_at`). */
  softDeletedRetentionMonths: number;
  /** Fixed at 12 months (spec §10): settled invitations, maintenance runs, idle activity rows. */
  invitationsRetentionMonths: number;
  maintenanceRunsRetentionMonths: number;
  adminActivityRetentionMonths: number;
  /** Months of `ext_metadata_history` partitions kept ahead of the current one. */
  historyMonthsAhead: number;
  dormancyDays: number;
  dormancyDryRun: boolean;
  /** Months after the last role removal before a role-less Keycloak account is deleted. */
  accountDeleteMonths: number;
  accountCleanupDryRun: boolean;
}

export const MAINTENANCE_OPTIONS = Symbol('MAINTENANCE_OPTIONS');
/** Optional clock override (tests). */
export const MAINTENANCE_CLOCK = Symbol('MAINTENANCE_CLOCK');

export function maintenanceOptions(
  env: Pick<
    Env,
    | 'OECP_RETENTION_HISTORY_MONTHS'
    | 'OECP_RETENTION_SYNC_ERRORS_MONTHS'
    | 'OECP_RETENTION_SYNC_RUNS_MONTHS'
    | 'OECP_RETENTION_AUDIT_MONTHS'
    | 'OECP_RETENTION_SOFT_DELETED_MONTHS'
    | 'OECP_DORMANCY_DAYS'
    | 'OECP_DORMANCY_DRY_RUN'
    | 'OECP_ACCOUNT_DELETE_MONTHS'
    | 'OECP_ACCOUNT_CLEANUP_DRY_RUN'
  >,
): MaintenanceOptions {
  return {
    historyRetentionMonths: env.OECP_RETENTION_HISTORY_MONTHS,
    syncErrorsRetentionMonths: env.OECP_RETENTION_SYNC_ERRORS_MONTHS,
    syncRunsRetentionMonths: env.OECP_RETENTION_SYNC_RUNS_MONTHS,
    auditRetentionMonths: env.OECP_RETENTION_AUDIT_MONTHS,
    softDeletedRetentionMonths: env.OECP_RETENTION_SOFT_DELETED_MONTHS,
    invitationsRetentionMonths: 12,
    maintenanceRunsRetentionMonths: 12,
    adminActivityRetentionMonths: 12,
    historyMonthsAhead: 3,
    dormancyDays: env.OECP_DORMANCY_DAYS,
    dormancyDryRun: env.OECP_DORMANCY_DRY_RUN,
    accountDeleteMonths: env.OECP_ACCOUNT_DELETE_MONTHS,
    accountCleanupDryRun: env.OECP_ACCOUNT_CLEANUP_DRY_RUN,
  };
}
