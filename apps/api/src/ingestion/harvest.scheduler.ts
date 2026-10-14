// SPDX-License-Identifier: EUPL-1.2
import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { type Db, KYSELY } from '../db/db.module.js';
import {
  HARVEST_SCHEDULE_JOB,
  HARVEST_SCHEDULE_QUEUE,
  type HarvestTickData,
  harvestSchedulerId,
} from './harvest.constants.js';
import { integrationBlocker, OeapiClientFactory } from './oeapi/oeapi-client.factory.js';

/** Spec §6.2.1 / §3: schedules are re-registered at start and every 15 minutes. */
export const SCHEDULE_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const SCHEDULER_PREFIX = 'harvest-schedule-';

export interface ScheduleSyncResult {
  scheduled: string[];
  removed: string[];
  skipped: { organizationId: string; reason: string }[];
}

/**
 * Keeps one BullMQ job scheduler per harvestable partner (enabled, authoritative
 * channel `oeapi`, runnable access settings) with its `schedule_cron` in
 * `schedule_timezone`; removes the others. Valkey state is therefore rebuildable.
 */
@Injectable()
export class HarvestScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HarvestScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    @InjectQueue(HARVEST_SCHEDULE_QUEUE) private readonly queue: Queue<HarvestTickData>,
    @Inject(KYSELY) private readonly db: Db,
    private readonly clients: OeapiClientFactory,
  ) {}

  onApplicationBootstrap(): void {
    if (this.clients.settings.allowInsecure) {
      this.logger.warn(
        'OECP_ALLOW_INSECURE_PARTNER_HTTP=true: partner endpoints may use http and private ' +
          'addresses. Development only; never enable this in production.',
      );
    }
    this.trigger();
    this.timer = setInterval(() => this.trigger(), SCHEDULE_SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private trigger(): void {
    if (this.running) return;
    this.running = this.sync()
      .catch((error: unknown) => this.logger.error(error, 'Harvest schedule sync failed'))
      .finally(() => {
        this.running = undefined;
      });
  }

  async sync(): Promise<ScheduleSyncResult> {
    const rows = await this.db
      .selectFrom('partner_integrations as pi')
      .innerJoin('organizations as o', 'o.id', 'pi.organization_id')
      .selectAll('pi')
      .where('pi.enabled', '=', true)
      .where('pi.authoritative_channel', '=', 'oeapi')
      .where('o.deleted_at', 'is', null)
      .execute();

    const result: ScheduleSyncResult = { scheduled: [], removed: [], skipped: [] };
    const existing = new Map(
      (await this.queue.getJobSchedulers(0, -1)).map((s) => [s.key, s] as const),
    );
    const wanted = new Set<string>();
    for (const row of rows) {
      const blocker = integrationBlocker(row, this.clients.settings);
      if (blocker) {
        result.skipped.push({ organizationId: row.organization_id, reason: blocker.detail });
        continue;
      }
      const id = harvestSchedulerId(row.organization_id);
      wanted.add(id);
      const current = existing.get(id);
      if (current?.pattern === row.schedule_cron && current.tz === row.schedule_timezone) continue;
      try {
        await this.queue.upsertJobScheduler(
          id,
          { pattern: row.schedule_cron, tz: row.schedule_timezone },
          {
            name: HARVEST_SCHEDULE_JOB,
            data: { organizationId: row.organization_id },
            opts: { removeOnComplete: true, removeOnFail: 100 },
          },
        );
        result.scheduled.push(row.organization_id);
      } catch (error) {
        result.skipped.push({
          organizationId: row.organization_id,
          reason: `invalid schedule: ${(error as Error).message}`,
        });
      }
    }
    for (const key of existing.keys()) {
      if (key.startsWith(SCHEDULER_PREFIX) && !wanted.has(key)) {
        await this.queue.removeJobScheduler(key);
        result.removed.push(key.slice(SCHEDULER_PREFIX.length));
      }
    }
    for (const skip of result.skipped) {
      this.logger.warn(`Harvest of ${skip.organizationId} not scheduled: ${skip.reason}`);
    }
    if (result.scheduled.length || result.removed.length) {
      this.logger.log(
        `Harvest schedules: ${result.scheduled.length} set, ${result.removed.length} removed, ${wanted.size} active`,
      );
    }
    return result;
  }
}
