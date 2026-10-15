// SPDX-License-Identifier: EUPL-1.2
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  IDP_METADATA_REFRESH_JOB,
  LEGACY_IDP_METADATA_REFRESH_QUEUE,
  LEGACY_IDP_METADATA_REFRESH_SCHEDULER_ID,
  STARTUP_CACHE_REUSE_MS,
} from '../identity/metadata-refresh/idp-metadata-refresh.constants.js';
import {
  IDP_METADATA_SETTINGS,
  type IdpMetadataSettings,
} from '../identity/metadata-refresh/idp-metadata-refresh.settings.js';
import {
  HISTORY_PARTITIONS_JOB,
  IDP_METADATA_STARTUP_DELAY_MS,
  MAINTENANCE_QUEUE,
  MAINTENANCE_SCHEDULES,
  maintenanceSchedulerId,
  startupJobId,
} from './maintenance.constants.js';
import { MaintenanceQueue } from './maintenance.queue.js';

/**
 * Registers the daily maintenance jobs (idempotent; Valkey state is rebuildable)
 * and queues the start-up runs: `history-partitions` at once, so that a worker
 * that was down at the turn of a month never leaves the history without its
 * partition, and `idp-metadata-refresh` a minute later (when configured and
 * `OECP_IDP_METADATA_REFRESH_ON_START` is true), so certificates reset by a
 * keycloak-config-cli re-import are restored quickly (spec §4). Also removes the
 * schedule of the queue `idp-metadata-refresh` used before 0.4.
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly producer: MaintenanceQueue,
    @Inject(IDP_METADATA_SETTINGS) private readonly idpSettings: IdpMetadataSettings,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const { job, pattern } of MAINTENANCE_SCHEDULES) {
      try {
        await this.queue.upsertJobScheduler(
          maintenanceSchedulerId(job),
          { pattern, tz: 'UTC' },
          {
            name: job,
            data: { trigger: 'schedule' },
            opts: { removeOnComplete: true, removeOnFail: 20 },
          },
        );
      } catch (error) {
        this.logger.error(error, `Maintenance job ${job} could not be scheduled`);
      }
    }
    try {
      await this.producer.request(
        HISTORY_PARTITIONS_JOB,
        { trigger: 'startup' },
        startupJobId(HISTORY_PARTITIONS_JOB),
      );
    } catch (error) {
      this.logger.error(error, 'Start-up run of history-partitions could not be queued');
    }
    if (this.idpSettings.url && this.idpSettings.refreshOnStart) {
      try {
        await this.producer.request(
          IDP_METADATA_REFRESH_JOB,
          { trigger: 'startup', reuseCacheMaxAgeMs: STARTUP_CACHE_REUSE_MS },
          startupJobId(IDP_METADATA_REFRESH_JOB),
          { delayMs: IDP_METADATA_STARTUP_DELAY_MS },
        );
      } catch (error) {
        this.logger.error(error, 'Start-up run of idp-metadata-refresh could not be queued');
      }
    }
    await this.removeLegacyIdpQueue();
  }

  /**
   * Before 0.4 the daily IdP metadata refresh had its own queue; its job
   * scheduler would otherwise stay in Valkey with nobody processing it.
   */
  private async removeLegacyIdpQueue(): Promise<void> {
    const legacy = new Queue(LEGACY_IDP_METADATA_REFRESH_QUEUE, {
      connection: this.queue.opts.connection,
      ...(this.queue.opts.prefix ? { prefix: this.queue.opts.prefix } : {}),
    });
    try {
      const removed = await legacy.removeJobScheduler(LEGACY_IDP_METADATA_REFRESH_SCHEDULER_ID);
      if (removed) {
        await legacy.obliterate({ force: true });
        this.logger.log(
          `Removed the pre-0.4 queue ${LEGACY_IDP_METADATA_REFRESH_QUEUE}; ` +
            'idp-metadata-refresh now runs on the maintenance queue',
        );
      }
    } catch (error) {
      this.logger.warn(`Legacy queue ${LEGACY_IDP_METADATA_REFRESH_QUEUE} not removed: ${error}`);
    } finally {
      await legacy.close().catch(() => undefined);
    }
  }
}
