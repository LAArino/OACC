// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../db/database.js';
import { type Db, KYSELY } from '../db/db.module.js';
import {
  MAINTENANCE_CLOCK,
  MAINTENANCE_OPTIONS,
  type MaintenanceOptions,
} from './maintenance.constants.js';
import { type JobOutcome, MaintenanceJobError } from './maintenance-runner.js';
import {
  boundLiteral,
  HISTORY_DEFAULT_PARTITION,
  HISTORY_TABLE,
  historyPartition,
  type MonthPartition,
  partitionsToDrop,
  partitionsToEnsure,
} from './months.js';

/** Rows moved from the default partition per statement. */
export const MOVE_BATCH = 5_000;
/**
 * DDL waits at most this long for its locks: a waiting ACCESS EXCLUSIVE request
 * would queue every later reader and writer of the history behind it.
 */
const LOCK_TIMEOUT = '5s';

export interface HistoryPartitionsCounters {
  [key: string]: number;
  partitions_created: number;
  rows_moved: number;
  partitions_dropped: number;
  rows_dropped: number;
  default_rows_remaining: number;
  errors: number;
}

/**
 * Monthly partitions of `ext_metadata_history` (spec §5.4, §10). Partitions are
 * created here, not by migrations:
 *
 * 1. The current month and the next `historyMonthsAhead` (3) exist, named
 *    `ext_metadata_history_YYYY_MM` with UTC month bounds, as in migration 0001.
 * 2. Rows that fell into the default partition (no partition for their month
 *    yet) are moved into a partition of their month. PostgreSQL refuses to create
 *    a partition while the default partition holds rows of its range, so the
 *    month's table is created detached, filled in batches of {@link MOVE_BATCH}
 *    rows deleted from the default partition, and attached, all in one
 *    transaction: readers never see the rows missing (the harvester's hash
 *    comparison reads the latest payload), writers wait for the move.
 * 3. Partitions whose whole month is older than `historyRetentionMonths` (12)
 *    are detached and dropped. The default partition is never dropped and is
 *    only touched by the move.
 *
 * Idempotent; one failing month is reported and does not stop the others.
 */
@Injectable()
export class HistoryPartitionsService {
  private readonly logger = new Logger(HistoryPartitionsService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    @Inject(MAINTENANCE_OPTIONS) private readonly options: MaintenanceOptions,
    @Optional() @Inject(MAINTENANCE_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async maintain(): Promise<JobOutcome> {
    const now = this.now();
    const counters: HistoryPartitionsCounters = {
      partitions_created: 0,
      rows_moved: 0,
      partitions_dropped: 0,
      rows_dropped: 0,
      default_rows_remaining: 0,
      errors: 0,
    };
    const errors: string[] = [];
    const created: string[] = [];
    const dropped: string[] = [];

    const existing = new Set(await this.partitionNames());
    const wanted = new Map<string, MonthPartition>();
    for (const p of partitionsToEnsure(now, this.options.historyMonthsAhead)) wanted.set(p.name, p);
    for (const ym of await this.defaultPartitionMonths()) {
      const p = historyPartition(ym);
      wanted.set(p.name, p);
    }
    const toCreate = [...wanted.values()]
      .filter((p) => !existing.has(p.name))
      .sort((a, b) => a.from.getTime() - b.from.getTime());

    for (const partition of toCreate) {
      try {
        const moved = await this.createPartition(partition);
        counters.partitions_created += 1;
        counters.rows_moved += moved;
        created.push(partition.name);
        existing.add(partition.name);
      } catch (error) {
        counters.errors += 1;
        errors.push(`${partition.name}: ${(error as Error).message}`);
        this.logger.error(error, `Partition ${partition.name} could not be created`);
      }
    }

    for (const partition of partitionsToDrop(
      [...existing],
      now,
      this.options.historyRetentionMonths,
    )) {
      try {
        counters.rows_dropped += await this.dropPartition(partition);
        counters.partitions_dropped += 1;
        dropped.push(partition.name);
      } catch (error) {
        counters.errors += 1;
        errors.push(`${partition.name}: ${(error as Error).message}`);
        this.logger.error(error, `Partition ${partition.name} could not be dropped`);
      }
    }

    counters.default_rows_remaining = await this.defaultRowCount();
    if (counters.default_rows_remaining > 0) {
      this.logger.warn(
        `${counters.default_rows_remaining} rows remain in ${HISTORY_DEFAULT_PARTITION}`,
      );
    }
    const outcome: JobOutcome = {
      counters,
      details: created.length || dropped.length ? { created, dropped } : null,
    };
    if (created.length || dropped.length) {
      this.logger.log(
        `History partitions: created ${created.join(', ') || 'none'} (${counters.rows_moved} rows ` +
          `moved from default); dropped ${dropped.join(', ') || 'none'} (${counters.rows_dropped} rows, ` +
          `retention ${this.options.historyRetentionMonths} months)`,
      );
    }
    if (errors.length) throw new MaintenanceJobError(errors.join('; '), outcome);
    return outcome;
  }

  /** Names of the partitions of `ext_metadata_history`, the default one included. */
  async partitionNames(db: Kysely<Database> = this.db): Promise<string[]> {
    const { rows } = await sql<{ name: string }>`
      SELECT c.relname AS name
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = ${HISTORY_TABLE}::regclass
      ORDER BY c.relname`.execute(db);
    return rows.map((r) => r.name);
  }

  /** Months (UTC) of the rows in the default partition. */
  private async defaultPartitionMonths(): Promise<{ year: number; month: number }[]> {
    const { rows } = await sql<{ year: number; month: number }>`
      SELECT DISTINCT
        extract(year FROM received_at AT TIME ZONE 'UTC')::int AS year,
        extract(month FROM received_at AT TIME ZONE 'UTC')::int AS month
      FROM ${sql.table(HISTORY_DEFAULT_PARTITION)}`.execute(this.db);
    return rows;
  }

  private async defaultRowCount(): Promise<number> {
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM ${sql.table(HISTORY_DEFAULT_PARTITION)}`.execute(this.db);
    return rows[0]?.n ?? 0;
  }

  /** Creates the month's partition; returns the number of rows moved from the default one. */
  private createPartition(p: MonthPartition): Promise<number> {
    const table = sql.table(p.name);
    const from = sql.raw(boundLiteral(p.from));
    const to = sql.raw(boundLiteral(p.to));
    const inRange = sql`received_at >= ${from} AND received_at < ${to}`;
    return this.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL lock_timeout = ${sql.lit(LOCK_TIMEOUT)}`.execute(trx);
      // Blocks inserts into the default partition (not reads) until commit, so
      // that no row of the month can arrive between the check and the DDL.
      await sql`LOCK TABLE ${sql.table(HISTORY_DEFAULT_PARTITION)} IN SHARE ROW EXCLUSIVE MODE`.execute(
        trx,
      );
      const { rows } = await sql<{ found: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM ${sql.table(HISTORY_DEFAULT_PARTITION)} WHERE ${inRange}
        ) AS found`.execute(trx);
      if (!rows[0]?.found) {
        await sql`CREATE TABLE IF NOT EXISTS ${table} PARTITION OF ${sql.table(HISTORY_TABLE)}
          FOR VALUES FROM (${from}) TO (${to})`.execute(trx);
        return 0;
      }

      await sql`CREATE TABLE ${table}
        (LIKE ${sql.table(HISTORY_TABLE)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`.execute(trx);
      let moved = 0;
      for (;;) {
        const result = await sql`
          WITH moved AS (
            DELETE FROM ${sql.table(HISTORY_DEFAULT_PARTITION)}
            WHERE ctid IN (
              SELECT ctid FROM ${sql.table(HISTORY_DEFAULT_PARTITION)} WHERE ${inRange}
              LIMIT ${sql.lit(MOVE_BATCH)}
            )
            RETURNING *
          )
          INSERT INTO ${table} SELECT * FROM moved`.execute(trx);
        const n = Number(result.numAffectedRows ?? 0);
        moved += n;
        if (n < MOVE_BATCH) break;
      }
      // A CHECK matching the bounds lets ATTACH skip scanning the new table.
      const check = sql.id(`${p.name}_bound`);
      await sql`ALTER TABLE ${table} ADD CONSTRAINT ${check} CHECK (${inRange})`.execute(trx);
      await sql`ALTER TABLE ${sql.table(HISTORY_TABLE)} ATTACH PARTITION ${table}
        FOR VALUES FROM (${from}) TO (${to})`.execute(trx);
      await sql`ALTER TABLE ${table} DROP CONSTRAINT ${check}`.execute(trx);
      return moved;
    });
  }

  /** Detaches and drops a partition; returns its number of rows. */
  private dropPartition(p: MonthPartition): Promise<number> {
    const table = sql.table(p.name);
    return this.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL lock_timeout = ${sql.lit(LOCK_TIMEOUT)}`.execute(trx);
      const { rows } = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${table}`.execute(
        trx,
      );
      await sql`ALTER TABLE ${sql.table(HISTORY_TABLE)} DETACH PARTITION ${table}`.execute(trx);
      await sql`DROP TABLE ${table}`.execute(trx);
      return rows[0]?.n ?? 0;
    });
  }
}
