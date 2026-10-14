// SPDX-License-Identifier: EUPL-1.2
/**
 * UTC calendar arithmetic for retention cut-offs and the monthly partitions of
 * `ext_metadata_history` (bounds `[YYYY-MM-01 00:00 UTC, next month)`, as in 0001).
 */

export const HISTORY_TABLE = 'ext_metadata_history';
export const HISTORY_DEFAULT_PARTITION = `${HISTORY_TABLE}_default`;
const PARTITION_NAME = /^ext_metadata_history_(\d{4})_(\d{2})$/;

/** A calendar month, `month` 1–12. */
export interface YearMonth {
  year: number;
  month: number;
}

export interface MonthPartition extends YearMonth {
  name: string;
  /** Inclusive lower bound (first instant of the month, UTC). */
  from: Date;
  /** Exclusive upper bound (first instant of the next month, UTC). */
  to: Date;
}

export function monthOf(date: Date): YearMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthStart(ym: YearMonth): Date {
  return new Date(Date.UTC(ym.year, ym.month - 1, 1));
}

/** `ext_metadata_history_YYYY_MM` with its bounds. */
export function historyPartition(ym: YearMonth): MonthPartition {
  const name = `${HISTORY_TABLE}_${String(ym.year).padStart(4, '0')}_${String(ym.month).padStart(2, '0')}`;
  return { ...ym, name, from: monthStart(ym), to: monthStart(addMonths(ym, 1)) };
}

/** The month a managed partition covers, or undefined for any other name (e.g. `_default`). */
export function parseHistoryPartitionName(name: string): MonthPartition | undefined {
  const match = PARTITION_NAME.exec(name);
  if (!match) return undefined;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return historyPartition({ year: Number(match[1]), month });
}

/** Partitions to keep in place: the month of `now` and the `ahead` following months. */
export function partitionsToEnsure(now: Date, ahead: number): MonthPartition[] {
  const current = monthOf(now);
  return Array.from({ length: ahead + 1 }, (_, i) => historyPartition(addMonths(current, i)));
}

/**
 * `date` minus `months` calendar months (UTC), the day clamped to the target
 * month's length (31 March − 1 month = 28/29 February), time of day kept.
 */
export function subtractMonths(date: Date, months: number): Date {
  const target = addMonths(monthOf(date), -months);
  const lastDay = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      target.year,
      target.month - 1,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/**
 * Managed partitions whose whole month is older than the retention period: the
 * upper bound is at or before `now − retentionMonths`. No row younger than the
 * retention period is ever dropped (rows are kept between 12 and 13 months).
 */
export function partitionsToDrop(
  names: readonly string[],
  now: Date,
  retentionMonths: number,
): MonthPartition[] {
  const cutoff = subtractMonths(now, retentionMonths);
  return names
    .map(parseHistoryPartitionName)
    .filter((p): p is MonthPartition => p !== undefined && p.to.getTime() <= cutoff.getTime())
    .sort((a, b) => a.from.getTime() - b.from.getTime());
}

/** SQL literal of a bound, as 0001 writes it: `'2026-11-01 00:00:00+00'`. */
export function boundLiteral(date: Date): string {
  return `'${date.toISOString().slice(0, 19).replace('T', ' ')}+00'`;
}
