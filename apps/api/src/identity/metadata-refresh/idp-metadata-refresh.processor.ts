// SPDX-License-Identifier: EUPL-1.2
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  IDP_METADATA_REFRESH_JOB,
  IDP_METADATA_REFRESH_QUEUE,
} from './idp-metadata-refresh.constants.js';
import {
  type IdpMetadataRefreshJobData,
  queueIdpMetadataRefreshAtStartup,
  registerIdpMetadataRefreshJob,
} from './idp-metadata-refresh.schedule.js';
import { IdpMetadataRefreshService, outcomeFailed } from './idp-metadata-refresh.service.js';
import {
  IDP_METADATA_SETTINGS,
  type IdpMetadataSettings,
} from './idp-metadata-refresh.settings.js';

/**
 * Runs `idp-metadata-refresh` jobs. A run with any failed alias, or without a
 * usable aggregate, fails the job (the "metadata-refresh failure" alert, spec §10).
 */
@Processor(IDP_METADATA_REFRESH_QUEUE, { concurrency: 1, lockDuration: 10 * 60_000 })
export class IdpMetadataRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(IdpMetadataRefreshProcessor.name);

  constructor(private readonly refresh: IdpMetadataRefreshService) {
    super();
  }

  async process(job: Job<IdpMetadataRefreshJobData>): Promise<unknown> {
    if (job.name !== IDP_METADATA_REFRESH_JOB) {
      this.logger.warn(`Unknown job ${job.name} on queue ${IDP_METADATA_REFRESH_QUEUE}`);
      return null;
    }
    const outcome = await this.refresh.runOnce({
      reuseCacheMaxAgeMs:
        typeof job.data?.reuseCacheMaxAgeMs === 'number' ? job.data.reuseCacheMaxAgeMs : undefined,
    });
    const counts = Object.fromEntries(
      ['updated', 'unchanged', 'skipped', 'failed'].map((s) => [
        s,
        outcome.results.filter((r) => r.status === s).map((r) => r.alias),
      ]),
    );
    if (outcomeFailed(outcome)) {
      const failed = outcome.results
        .filter((r) => r.status === 'failed')
        .map((r) => `${r.alias}: ${r.error}`);
      throw new Error(
        `idp-metadata-refresh failed: ${outcome.aggregateError ?? failed.join('; ')}`,
      );
    }
    return { status: outcome.status, source: outcome.aggregate?.kind ?? null, ...counts };
  }
}

/** Registers the daily schedule and the optional start-up run when the worker boots. */
@Injectable()
export class IdpMetadataRefreshScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IdpMetadataRefreshScheduler.name);

  constructor(
    @InjectQueue(IDP_METADATA_REFRESH_QUEUE) private readonly queue: Queue,
    @Inject(IDP_METADATA_SETTINGS) private readonly settings: IdpMetadataSettings,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await registerIdpMetadataRefreshJob(this.queue);
      if (this.settings.url && this.settings.refreshOnStart) {
        await queueIdpMetadataRefreshAtStartup(this.queue);
      }
    } catch (error) {
      this.logger.error(error, 'IdP metadata refresh could not be scheduled');
    }
  }
}
