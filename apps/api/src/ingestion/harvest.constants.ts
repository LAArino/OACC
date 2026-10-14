// SPDX-License-Identifier: EUPL-1.2
import { z } from 'zod';

export const HARVEST_QUEUE = 'harvest';
export const HARVEST_JOB = 'harvest';

export const harvestJobData = z.object({
  organizationId: z.uuid(),
  trigger: z.enum(['schedule', 'manual']),
  /** JWT `sub` for "Sync now", absent for scheduled runs. */
  triggeredBy: z.string().optional(),
});
export type HarvestJobData = z.infer<typeof harvestJobData>;

/**
 * One run per partner at a time (spec §3). BullMQ rejects custom ids containing
 * ':', so the spec's `harvest:{organization_id}` is spelled with a dash.
 */
export const harvestJobId = (organizationId: string): string => `harvest-${organizationId}`;
