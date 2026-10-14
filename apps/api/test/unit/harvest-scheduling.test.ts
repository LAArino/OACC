// SPDX-License-Identifier: EUPL-1.2
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { HarvestJobData, HarvestTickData } from '../../src/ingestion/harvest.constants.js';
import { HarvestQueue } from '../../src/ingestion/harvest.queue.js';
import { HarvestScheduleProcessor } from '../../src/ingestion/harvest-schedule.processor.js';
import { HarvestScheduler } from '../../src/ingestion/harvest.scheduler.js';
import type { OeapiClientFactory } from '../../src/ingestion/oeapi/oeapi-client.factory.js';
import { createFakeDb } from '../support/fake-kysely.js';

const ORG_A = '0a000000-0000-4000-8000-00000000000a';
const ORG_B = '0a000000-0000-4000-8000-00000000000b';
const ORG_C = '0a000000-0000-4000-8000-00000000000c';

beforeAll(() => Logger.overrideLogger(false));

function fakeJob(state: string, data: Partial<HarvestJobData> = {}) {
  return { getState: vi.fn(async () => state), remove: vi.fn(async () => undefined), data };
}

describe('HarvestQueue', () => {
  function queue(existing?: ReturnType<typeof fakeJob>) {
    const q = {
      getJob: vi.fn(async () => existing),
      add: vi.fn(async (_name: string, data: HarvestJobData) => ({ data })),
    };
    return { q, harvests: new HarvestQueue(q as unknown as Queue<HarvestJobData>) };
  }

  it('adds the job under harvest-{organization_id}', async () => {
    const { q, harvests } = queue();
    await expect(
      harvests.request({ organizationId: ORG_A, trigger: 'manual', triggeredBy: 'sub' }),
    ).resolves.toBe('queued');
    expect(q.add).toHaveBeenCalledWith(
      'harvest',
      expect.objectContaining({ organizationId: ORG_A, trigger: 'manual', triggeredBy: 'sub' }),
      expect.objectContaining({
        jobId: `harvest-${ORG_A}`,
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });

  it.each(['waiting', 'active', 'delayed', 'prioritized'])('keeps a %s run', async (state) => {
    const { q, harvests } = queue(fakeJob(state));
    await expect(harvests.request({ organizationId: ORG_A, trigger: 'schedule' })).resolves.toBe(
      'already_queued',
    );
    expect(q.add).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed'])('replaces a %s job holding the id', async (state) => {
    const job = fakeJob(state);
    const { q, harvests } = queue(job);
    await expect(harvests.request({ organizationId: ORG_A, trigger: 'schedule' })).resolves.toBe(
      'queued',
    );
    expect(job.remove).toHaveBeenCalled();
    expect(q.add).toHaveBeenCalled();
  });

  it('detects a concurrent producer that won the race', async () => {
    const q = {
      getJob: vi.fn(async () => undefined),
      add: vi.fn(async () => ({ data: { requestId: 'someone-else' } })),
    };
    const harvests = new HarvestQueue(q as unknown as Queue<HarvestJobData>);
    await expect(harvests.request({ organizationId: ORG_A, trigger: 'schedule' })).resolves.toBe(
      'already_queued',
    );
  });

  it('a scheduler tick enqueues a deduplicated scheduled harvest', async () => {
    const harvests = { request: vi.fn(async () => 'queued' as const) };
    const processor = new HarvestScheduleProcessor(harvests as unknown as HarvestQueue);
    await processor.process({ data: { organizationId: ORG_A } } as never);
    expect(harvests.request).toHaveBeenCalledWith({ organizationId: ORG_A, trigger: 'schedule' });
  });
});

describe('HarvestScheduler', () => {
  const row = (organizationId: string, patch: Record<string, unknown> = {}) => ({
    organization_id: organizationId,
    access_mode: 'direct',
    base_url: 'https://oeapi.example.org/v5',
    approved_host: 'oeapi.example.org',
    surfeduhub_endpoint_id: null,
    schedule_cron: '0 3 * * *',
    schedule_timezone: 'Europe/Vienna',
    ...patch,
  });

  it('keeps one job scheduler per harvestable partner and removes the others', async () => {
    const fake = createFakeDb((q) =>
      q.sql.includes('from "partner_integrations"')
        ? [
            row(ORG_A),
            row(ORG_B, { schedule_cron: '30 2 * * 1-5', schedule_timezone: 'Atlantic/Reykjavik' }),
            row(ORG_C, { approved_host: null }),
          ]
        : undefined,
    );
    const queue = {
      getJobSchedulers: vi.fn(async () => [
        { key: `harvest-schedule-${ORG_A}`, pattern: '0 3 * * *', tz: 'Europe/Vienna' },
        { key: `harvest-schedule-${ORG_B}`, pattern: '0 3 * * *', tz: 'Europe/Brussels' },
        { key: `harvest-schedule-${ORG_C}`, pattern: '0 3 * * *', tz: 'Europe/Brussels' },
        { key: 'something-else', pattern: '* * * * *' },
      ]),
      upsertJobScheduler: vi.fn(async () => ({})),
      removeJobScheduler: vi.fn(async () => true),
    };
    const clients = {
      settings: {
        allowInsecure: false,
        gatewayUrl: 'https://gateway.surfeduhub.nl',
        surfeduhubSecretRef: undefined,
      },
    } as unknown as OeapiClientFactory;
    const scheduler = new HarvestScheduler(
      queue as unknown as Queue<HarvestTickData>,
      fake.db,
      clients,
    );
    const result = await scheduler.sync();
    expect(result.scheduled).toEqual([ORG_B]);
    expect(result.removed).toEqual([ORG_C]);
    expect(result.skipped).toEqual([
      { organizationId: ORG_C, reason: 'host oeapi.example.org awaits alliance_admin approval' },
    ]);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      `harvest-schedule-${ORG_B}`,
      { pattern: '30 2 * * 1-5', tz: 'Atlantic/Reykjavik' },
      expect.objectContaining({ name: 'harvest-tick', data: { organizationId: ORG_B } }),
    );
    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
    const [select] = fake.queries;
    expect(select?.sql).toContain('"pi"."enabled" = $1');
    expect(select?.sql).toContain('"pi"."authoritative_channel" = $2');
    expect(select?.parameters).toEqual([true, 'oeapi']);
  });
});
