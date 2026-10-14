// SPDX-License-Identifier: EUPL-1.2
/** Health rule of `GET /api/admin/v1/network-status` (see `networkHealth` in @oecp/schemas). */
import {
  isValidCron,
  type NetworkHealth,
  type SourceChannel,
  type SyncRunStatus,
} from '@oecp/schemas';

export interface FinishedRunFacts {
  status: SyncRunStatus;
  is_complete: boolean;
  finished_at: Date | null;
}

export interface HealthFacts {
  /** `form` when no integration row exists. */
  authoritativeChannel: SourceChannel;
  enabled: boolean;
  /** Whether {@link integrationBlocker} reports a problem (host not approved…). */
  blocked: boolean;
  /** Latest `succeeded`/`partial`/`failed` run of the authoritative channel(s). */
  lastFinished: FinishedRunFacts | null;
  /** Whether any CSV upload or form save exists (any status). */
  hasWrites: boolean;
  scheduleCron: string | null;
  now: Date;
}

/** A harvest is stale when it finished longer ago than this many schedule gaps. */
export const STALE_FACTOR = 2;

export function networkHealthOf(facts: HealthFacts): NetworkHealth {
  const last = facts.lastFinished;
  if (facts.authoritativeChannel !== 'oeapi') {
    if (!facts.hasWrites) return 'unconfigured';
    return last?.status === 'failed' ? 'warning' : 'ok';
  }
  if (!facts.enabled) return 'warning';
  if (facts.blocked || last?.status === 'failed') return 'error';
  if (!last || !last.finished_at) return 'warning';
  const succeeded = last.status === 'succeeded' || (last.status === 'partial' && last.is_complete);
  if (!succeeded) return 'warning';
  const gap = facts.scheduleCron ? cronMaxGapMs(facts.scheduleCron, facts.now) : null;
  if (gap !== null && facts.now.getTime() - last.finished_at.getTime() > STALE_FACTOR * gap) {
    return 'warning';
  }
  return 'ok';
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Days scanned for firing times: covers yearly schedules with two firings. */
const HORIZON_DAYS = 800;

const FIELDS: readonly { min: number; max: number; names?: readonly string[] }[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  {
    min: 1,
    max: 12,
    names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  },
  { min: 0, max: 7, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
];

/** Values of one cron field (`*`, lists, ranges, steps, names; day-of-week 7 = 0). */
export function expandCronField(field: string, index: number): Set<number> {
  const spec = FIELDS[index]!;
  const value = (token: string): number => {
    const named = spec.names?.indexOf(token.toUpperCase()) ?? -1;
    if (named >= 0) return named + (index === 3 ? 1 : 0);
    return Number(token);
  };
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range = '*', stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    let from = spec.min;
    let to = spec.max;
    if (range !== '*') {
      const [a = '', b] = range.split('-');
      from = value(a);
      // `a/step` runs to the maximum, a plain `a` is the single value.
      to = b !== undefined ? value(b) : stepText !== undefined ? spec.max : from;
    }
    for (let v = from; v <= to; v += step) out.add(index === 4 && v === 7 ? 0 : v);
  }
  return out;
}

/**
 * Longest interval between two consecutive firings of a five-field cron
 * expression, in milliseconds, computed in UTC over {@link HORIZON_DAYS} days
 * from `from` (time zone shifts of an hour do not matter against a factor of 2).
 * Day-of-month and day-of-week combine as in Vixie cron: when both are
 * restricted, a day matching either fires. Null if the expression is invalid or
 * fires fewer than twice in the horizon.
 */
export function cronMaxGapMs(expression: string, from: Date): number | null {
  if (!isValidCron(expression)) return null;
  const fields = expression.trim().split(/\s+/);
  const [minutes, hours, doms, months, dows] = fields.map((f, i) => expandCronField(f, i)) as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  const domRestricted = !fields[2]!.startsWith('*');
  const dowRestricted = !fields[4]!.startsWith('*');

  // Firing minutes within a matching day, ascending.
  const times: number[] = [];
  for (const h of [...hours].sort((a, b) => a - b)) {
    for (const m of [...minutes].sort((a, b) => a - b)) times.push(h * 60 + m);
  }
  if (times.length === 0) return null;
  let maxGap = 0;
  for (let i = 1; i < times.length; i += 1) {
    maxGap = Math.max(maxGap, (times[i]! - times[i - 1]!) * MINUTE);
  }

  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  let lastFiring: number | null = null;
  let firingDays = 0;
  for (let d = 0; d < HORIZON_DAYS; d += 1) {
    const day = new Date(start + d * DAY);
    if (!months.has(day.getUTCMonth() + 1)) continue;
    const domMatch = doms.has(day.getUTCDate());
    const dowMatch = dows.has(day.getUTCDay());
    const matches = domRestricted && dowRestricted ? domMatch || dowMatch : domMatch && dowMatch;
    if (!matches) continue;
    const dayStart = start + d * DAY;
    const first = dayStart + times[0]! * MINUTE;
    if (lastFiring !== null) maxGap = Math.max(maxGap, first - lastFiring);
    lastFiring = dayStart + times[times.length - 1]! * MINUTE;
    firingDays += 1;
  }
  if (firingDays === 0 || (firingDays === 1 && times.length === 1)) return null;
  return maxGap;
}
