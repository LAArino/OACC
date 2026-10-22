// SPDX-License-Identifier: EUPL-1.2
// Maintenance jobs of the worker (spec §2.2, §10) as the admin page shows them:
// the jobs an alliance administrator may run on demand, the dry-run switches of
// the jobs that remove access, and readers of the job-specific `counters` and
// `details` of a run (`GET /api/admin/v1/maintenance/runs`), which are free-form
// JSON and are therefore read defensively.
import type { AdminMaintenanceRun } from '~/types/admin';

/** Jobs accepted by `POST /maintenance/jobs/{name}/run`, in display order. */
export const MAINTENANCE_JOBS = [
  'history-partitions',
  'retention',
  'dormancy',
  'account-cleanup',
  'csv-retention',
  'idp-metadata-refresh',
] as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[number];

/** Jobs that run in dry run until the operator enables them, with their switch. */
export const DRY_RUN_SWITCHES: Readonly<Partial<Record<MaintenanceJobName, string>>> = {
  dormancy: 'OECP_DORMANCY_DRY_RUN',
  'account-cleanup': 'OECP_ACCOUNT_CLEANUP_DRY_RUN',
};

export function isKnownMaintenanceJob(name: string): name is MaintenanceJobName {
  return (MAINTENANCE_JOBS as readonly string[]).includes(name);
}

/** i18n key segment of a job name (`history-partitions` → `historyPartitions`). */
export function maintenanceJobKey(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Badge tone of a run status (the text says the same; WCAG 1.4.1). */
export function maintenanceStatusTone(
  status: AdminMaintenanceRun['status'],
): 'ok' | 'bad' | 'warn' | 'neutral' {
  switch (status) {
    case 'succeeded':
      return 'ok';
    case 'failed':
      return 'bad';
    case 'skipped':
      return 'warn';
    default:
      return 'neutral';
  }
}

/** `details.dry_run` of a run: true, false, or null when the job does not report it. */
export function runDryRun(run: Pick<AdminMaintenanceRun, 'details'> | null | undefined) {
  const value = run?.details?.['dry_run'];
  return typeof value === 'boolean' ? value : null;
}

/** An administrator listed by the dormancy or account clean-up job for review. */
export interface MaintenanceCandidate {
  sub: string;
  roles: string[];
  organizationId: string | null;
  lastActivityAt: string | null;
  /** As sent, else whole days from the last activity to the start of the run. */
  inactiveDays: number | null;
  action: string | null;
  /** Account clean-up: when and how the OACC roles were removed. */
  rolesRemovedAt: string | null;
  removalAction: string | null;
}

const DAY_MS = 86_400_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const firstString = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = o[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
};
const firstNumber = (o: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = o[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
};

/**
 * `details.candidates` of a run, or null when the run carries no such list.
 * Dormancy lists `{sub, roles, organization_id, last_activity_at, inactive_days,
 * action}`; account clean-up `{sub, organization_id, last_role_removal_at,
 * removal_action, last_activity_at, action}`.
 */
export function runCandidates(
  run: Pick<AdminMaintenanceRun, 'details'> & Partial<Pick<AdminMaintenanceRun, 'started_at'>>,
): MaintenanceCandidate[] | null {
  const list = run.details?.['candidates'];
  if (!Array.isArray(list)) return null;
  const startedAt = run.started_at ? Date.parse(run.started_at) : Number.NaN;
  return list.filter(isRecord).map((c) => {
    const roles = c['roles'] ?? c['roles_removed'];
    const lastActivityAt = firstString(c, ['last_activity_at', 'last_seen_at']);
    const lastActivity = lastActivityAt ? Date.parse(lastActivityAt) : Number.NaN;
    const derivedDays =
      Number.isNaN(startedAt) || Number.isNaN(lastActivity)
        ? null
        : Math.max(0, Math.floor((startedAt - lastActivity) / DAY_MS));
    return {
      sub: firstString(c, ['sub', 'keycloak_user_id', 'user_id']) ?? '',
      roles: Array.isArray(roles)
        ? roles.filter((r): r is string => typeof r === 'string')
        : typeof roles === 'string'
          ? [roles]
          : [],
      organizationId: firstString(c, ['organization_id', 'org_id', 'oecp_org_id']),
      lastActivityAt,
      inactiveDays: firstNumber(c, ['inactive_days', 'days_inactive']) ?? derivedDays,
      action: firstString(c, ['action']),
      rolesRemovedAt: firstString(c, ['last_role_removal_at', 'roles_removed_at']),
      removalAction: firstString(c, ['removal_action']),
    };
  });
}

/** Counters in their order, e.g. `[['partitions_created', 1]]`. */
export function runCounters(run: Pick<AdminMaintenanceRun, 'counters'>): [string, number][] {
  return Object.entries(run.counters ?? {}).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );
}

/** A counter or details key for people: `rows_moved` → `rows moved`. */
export function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ');
}

/** A details value as text: scalars as they are, lists and objects as compact JSON. */
export function detailValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return value.join(', ');
  }
  return JSON.stringify(value, null, 2);
}

/** Whether a details value is structured (shown preformatted). */
export function isStructuredDetail(value: unknown): boolean {
  if (Array.isArray(value)) {
    return !value.every((v) => typeof v === 'string' || typeof v === 'number');
  }
  return isRecord(value);
}

/** The first `max` characters of an error message, with an ellipsis when cut. */
export function textExcerpt(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
