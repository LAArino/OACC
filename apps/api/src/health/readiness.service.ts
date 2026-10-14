// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'kysely';
import { type Db, KYSELY } from '../db/db.module.js';
import { HARVEST_QUEUE } from '../ingestion/harvest.constants.js';

export interface ReadinessReport {
  ready: boolean;
  checks: Record<'database' | 'valkey', 'up' | 'down'>;
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    @InjectQueue(HARVEST_QUEUE) private readonly queue: Queue,
  ) {}

  async check(): Promise<ReadinessReport> {
    const [database, valkey] = await Promise.all([
      probe(() => sql`select 1`.execute(this.db)),
      probe(() => this.queue.waitUntilReady()),
    ]);
    return { ready: database === 'up' && valkey === 'up', checks: { database, valkey } };
  }
}

const PROBE_TIMEOUT_MS = 2_000;

async function probe(fn: () => Promise<unknown>): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
  });
  try {
    await Promise.race([fn(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
