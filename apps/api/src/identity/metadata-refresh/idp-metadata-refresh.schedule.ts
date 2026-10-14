// SPDX-License-Identifier: EUPL-1.2
import type { Queue } from 'bullmq';
import {
  IDP_METADATA_REFRESH_CRON,
  IDP_METADATA_REFRESH_JOB,
  IDP_METADATA_REFRESH_SCHEDULER_ID,
  IDP_METADATA_REFRESH_STARTUP_JOB_ID,
  STARTUP_CACHE_REUSE_MS,
} from './idp-metadata-refresh.constants.js';

/** Data of an `idp-metadata-refresh` job; empty for the daily run. */
export interface IdpMetadataRefreshJobData {
  /** Reuse a cached aggregate younger than this (start-up run). */
  reuseCacheMaxAgeMs?: number;
}

/**
 * Registers (idempotently) the daily `idp-metadata-refresh` job, 04:15 UTC, as the
 * BullMQ job scheduler `idp-metadata-refresh` on `queue`. Valkey state is
 * rebuildable: call it at every worker start.
 */
export async function registerIdpMetadataRefreshJob(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    IDP_METADATA_REFRESH_SCHEDULER_ID,
    { pattern: IDP_METADATA_REFRESH_CRON, tz: 'UTC' },
    {
      name: IDP_METADATA_REFRESH_JOB,
      data: {} satisfies IdpMetadataRefreshJobData,
      opts: { attempts: 1, removeOnComplete: 10, removeOnFail: 50 },
    },
  );
}

/**
 * Queues one run shortly after start-up (reusing an aggregate cached within 24 h),
 * so certificates reset by a keycloak-config-cli re-import are restored quickly.
 * A run already waiting under the same job id is kept.
 */
export async function queueIdpMetadataRefreshAtStartup(
  queue: Queue,
  delayMs = 60_000,
): Promise<void> {
  const existing = await queue.getJob(IDP_METADATA_REFRESH_STARTUP_JOB_ID);
  if (existing) {
    const state = await existing.getState();
    if (state !== 'completed' && state !== 'failed' && state !== 'unknown') return;
    await existing.remove().catch(() => undefined);
  }
  await queue.add(
    IDP_METADATA_REFRESH_JOB,
    { reuseCacheMaxAgeMs: STARTUP_CACHE_REUSE_MS } satisfies IdpMetadataRefreshJobData,
    {
      jobId: IDP_METADATA_REFRESH_STARTUP_JOB_ID,
      delay: delayMs,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );
}
