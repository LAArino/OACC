// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  cronMaxGapMs,
  expandCronField,
  type HealthFacts,
  networkHealthOf,
} from '../../src/admin/network/network-health.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const harvest = (patch: Partial<HealthFacts> = {}): HealthFacts => ({
  authoritativeChannel: 'oeapi',
  enabled: true,
  blocked: false,
  lastFinished: { status: 'succeeded', is_complete: true, finished_at: ago(5) },
  hasWrites: false,
  scheduleCron: '0 3 * * *',
  now: NOW,
  ...patch,
});

describe('networkHealthOf, Channel A', () => {
  it('is ok when enabled and the latest harvest succeeded within twice the interval', () => {
    expect(networkHealthOf(harvest())).toBe('ok');
    expect(
      networkHealthOf(
        harvest({ lastFinished: { status: 'succeeded', is_complete: true, finished_at: ago(47) } }),
      ),
    ).toBe('ok');
  });

  it('treats a partial harvest with a complete listing as ok', () => {
    expect(
      networkHealthOf(
        harvest({ lastFinished: { status: 'partial', is_complete: true, finished_at: ago(2) } }),
      ),
    ).toBe('ok');
  });

  it('warns about incomplete, stale, missing or disabled harvests', () => {
    expect(
      networkHealthOf(
        harvest({ lastFinished: { status: 'partial', is_complete: false, finished_at: ago(2) } }),
      ),
    ).toBe('warning');
    expect(
      networkHealthOf(
        harvest({ lastFinished: { status: 'succeeded', is_complete: true, finished_at: ago(49) } }),
      ),
    ).toBe('warning');
    expect(networkHealthOf(harvest({ lastFinished: null }))).toBe('warning');
    expect(networkHealthOf(harvest({ enabled: false }))).toBe('warning');
    expect(networkHealthOf(harvest({ enabled: false, blocked: true }))).toBe('warning');
  });

  it('reports an error for a failed harvest or a blocked enabled integration', () => {
    expect(
      networkHealthOf(
        harvest({ lastFinished: { status: 'failed', is_complete: false, finished_at: ago(1) } }),
      ),
    ).toBe('error');
    expect(networkHealthOf(harvest({ blocked: true }))).toBe('error');
  });

  it('uses the longest gap of the schedule: weekly harvests are fresh for 14 days', () => {
    const weekly = (hours: number) =>
      harvest({
        scheduleCron: '0 3 * * MON',
        lastFinished: { status: 'succeeded', is_complete: true, finished_at: ago(hours) },
      });
    expect(networkHealthOf(weekly(13 * 24))).toBe('ok');
    expect(networkHealthOf(weekly(15 * 24))).toBe('warning');
  });
});

describe('networkHealthOf, CSV and form', () => {
  const other = (patch: Partial<HealthFacts> = {}) =>
    harvest({ authoritativeChannel: 'form', enabled: false, scheduleCron: null, ...patch });

  it('is unconfigured without uploads or form saves', () => {
    expect(networkHealthOf(other({ lastFinished: null, hasWrites: false }))).toBe('unconfigured');
  });

  it('is ok after writes and warns when the latest one failed', () => {
    expect(networkHealthOf(other({ hasWrites: true }))).toBe('ok');
    expect(
      networkHealthOf(
        other({
          authoritativeChannel: 'csv',
          hasWrites: true,
          lastFinished: { status: 'failed', is_complete: false, finished_at: ago(1) },
        }),
      ),
    ).toBe('warning');
  });
});

describe('cron gaps', () => {
  const from = new Date('2026-10-14T00:00:00Z');

  it.each([
    ['0 3 * * *', 24 * HOUR],
    ['*/15 * * * *', 0.25 * HOUR],
    ['0 */6 * * *', 6 * HOUR],
    ['30 2,14 * * *', 12 * HOUR],
    ['0 3 * * MON', 7 * 24 * HOUR],
    ['0 3 * * 1-5', 3 * 24 * HOUR],
    ['0 3 1 * *', 31 * 24 * HOUR],
    ['0 3 1 1 *', 365 * 24 * HOUR],
  ])('%s has a longest gap of %d ms', (cron, gap) => {
    expect(cronMaxGapMs(cron, from)).toBe(gap);
  });

  it('combines restricted day-of-month and day-of-week with OR', () => {
    // The 1st of the month or any Sunday: never more than 7 days apart.
    expect(cronMaxGapMs('0 0 1 * 0', from)).toBeLessThanOrEqual(7 * 24 * HOUR);
  });

  it('returns null for invalid expressions', () => {
    expect(cronMaxGapMs('not a cron', from)).toBeNull();
  });

  it('expands names, ranges, steps and Sunday as 7', () => {
    expect([...expandCronField('MON-FRI', 4)]).toEqual([1, 2, 3, 4, 5]);
    expect([...expandCronField('7', 4)]).toEqual([0]);
    expect([...expandCronField('10/20', 0)]).toEqual([10, 30, 50]);
    expect([...expandCronField('JAN,MAR', 3)]).toEqual([1, 3]);
  });
});
