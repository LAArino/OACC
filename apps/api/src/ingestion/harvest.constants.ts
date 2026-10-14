// SPDX-License-Identifier: EUPL-1.2
import { z } from 'zod';

export const HARVEST_QUEUE = 'harvest';
export const HARVEST_JOB = 'harvest';

/** Repeatable "tick" jobs, one job scheduler per partner; each tick enqueues a harvest. */
export const HARVEST_SCHEDULE_QUEUE = 'harvest-schedule';
export const HARVEST_SCHEDULE_JOB = 'harvest-tick';

export const harvestJobData = z.object({
  organizationId: z.uuid(),
  trigger: z.enum(['schedule', 'manual']),
  /** JWT `sub` for "Sync now", absent for scheduled runs. */
  triggeredBy: z.string().optional(),
  /** Queued `sync_runs` row created by "Sync now". */
  syncRunId: z.uuid().optional(),
  /** Set by HarvestQueue to detect whether `add` created the job or found an existing one. */
  requestId: z.string().optional(),
});
export type HarvestJobData = z.infer<typeof harvestJobData>;

export const harvestTickData = z.object({ organizationId: z.uuid() });
export type HarvestTickData = z.infer<typeof harvestTickData>;

/**
 * One run per partner at a time (spec §3). BullMQ rejects custom ids containing
 * ':', so the spec's `harvest:{organization_id}` is spelled with a dash.
 */
export const harvestJobId = (organizationId: string): string => `harvest-${organizationId}`;

/** Job scheduler id of a partner's daily harvest. */
export const harvestSchedulerId = (organizationId: string): string =>
  `harvest-schedule-${organizationId}`;
