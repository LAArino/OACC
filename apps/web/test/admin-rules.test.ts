// SPDX-License-Identifier: EUPL-1.2
// Pure rules of the admin console that mirror the API: delete blockers, status
// overrides (utils/adminRecordRules.ts) and the readers of maintenance runs
// (utils/maintenance.ts).
import { describe, expect, it } from 'vitest';
import { deleteBlocker, statusOverride } from '../app/utils/adminRecordRules';
import {
  detailValueText,
  humanizeKey,
  isKnownMaintenanceJob,
  isStructuredDetail,
  MAINTENANCE_JOBS,
  maintenanceJobKey,
  maintenanceStatusTone,
  runCandidates,
  runCounters,
  runDryRun,
  textExcerpt,
} from '../app/utils/maintenance';

describe('deleteBlocker', () => {
  const record = (o: Partial<Parameters<typeof deleteBlocker>[0]> = {}) => ({
    source_channel: 'form',
    status: 'draft',
    ...o,
  });

  it('mirrors the API: harvested, overrides mode, published, published offerings', () => {
    expect(deleteBlocker(record(), false)).toBeNull();
    expect(deleteBlocker(record({ status: 'withdrawn' }), false)).toBeNull();
    expect(deleteBlocker(record({ source_channel: 'oeapi' }), false)).toBe('harvested');
    expect(deleteBlocker(record({ source_channel: 'oeapi', status: 'published' }), true)).toBe(
      'harvested',
    );
    expect(deleteBlocker(record({ source_channel: 'csv' }), true)).toBe('overridesMode');
    expect(deleteBlocker(record({ status: 'published' }), false)).toBe('published');
    expect(
      deleteBlocker(record({ offerings: [{ status: 'draft' }, { status: 'published' }] }), false),
    ).toBe('publishedOfferings');
    expect(deleteBlocker(record({ offerings: [{ status: 'cancelled' }] }), false)).toBeNull();
  });
});

describe('statusOverride', () => {
  it('reports the partner status of an overridden status', () => {
    expect(
      statusOverride({
        overrides: { status: 'withdrawn' },
        source_values: { status: 'published' },
      }),
    ).toEqual({ source: 'published' });
    expect(statusOverride({ overrides: { status: 'withdrawn' }, source_values: {} })).toEqual({
      source: null,
    });
    expect(
      statusOverride({ overrides: { ects: 5 }, source_values: { status: 'draft' } }),
    ).toBeNull();
  });
});

describe('maintenance runs', () => {
  const base = { counters: {}, details: null };

  it('knows the on-demand jobs and their i18n keys', () => {
    expect(MAINTENANCE_JOBS).toContain('account-cleanup');
    expect(isKnownMaintenanceJob('dormancy')).toBe(true);
    expect(isKnownMaintenanceJob('unknown-job')).toBe(false);
    expect(maintenanceJobKey('idp-metadata-refresh')).toBe('idpMetadataRefresh');
    expect(maintenanceJobKey('retention')).toBe('retention');
  });

  it('maps statuses to badge tones', () => {
    expect(maintenanceStatusTone('succeeded')).toBe('ok');
    expect(maintenanceStatusTone('failed')).toBe('bad');
    expect(maintenanceStatusTone('skipped')).toBe('warn');
    expect(maintenanceStatusTone('running')).toBe('neutral');
  });

  it('reads dry_run, counters and candidates defensively', () => {
    expect(runDryRun({ details: { dry_run: true } })).toBe(true);
    expect(runDryRun({ details: { dry_run: 1 } })).toBeNull();
    expect(runDryRun({ details: null })).toBeNull();
    expect(runDryRun(undefined)).toBeNull();
    expect(runCounters({ counters: { a: 1, b: 0 } })).toEqual([
      ['a', 1],
      ['b', 0],
    ]);
    expect(runCandidates(base)).toBeNull();
    expect(runCandidates({ details: { candidates: 'x' } })).toBeNull();
    expect(
      runCandidates({
        details: {
          candidates: [
            null,
            { sub: 's', roles: 'partner_admin', last_seen_at: '2026-01-01T00:00:00Z' },
          ],
        },
      }),
    ).toEqual([
      {
        sub: 's',
        roles: ['partner_admin'],
        organizationId: null,
        lastActivityAt: '2026-01-01T00:00:00Z',
        inactiveDays: null,
        action: null,
        rolesRemovedAt: null,
        removalAction: null,
      },
    ]);
    // Days inactive are derived from the run start when the job does not send them.
    expect(
      runCandidates({
        started_at: '2026-10-15T05:15:00.000Z',
        details: {
          candidates: [
            {
              sub: 'gone',
              last_activity_at: '2026-10-05T05:15:00.000Z',
              last_role_removal_at: '2025-09-01T00:00:00.000Z',
              removal_action: 'admin.revoke',
            },
          ],
        },
      }),
    ).toEqual([
      {
        sub: 'gone',
        roles: [],
        organizationId: null,
        lastActivityAt: '2026-10-05T05:15:00.000Z',
        inactiveDays: 10,
        action: null,
        rolesRemovedAt: '2025-09-01T00:00:00.000Z',
        removalAction: 'admin.revoke',
      },
    ]);
  });

  it('formats keys, values and excerpts', () => {
    expect(humanizeKey('rows_moved')).toBe('rows moved');
    expect(detailValueText(['a', 2])).toBe('a, 2');
    expect(detailValueText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(detailValueText(null)).toBe('');
    expect(isStructuredDetail({ a: 1 })).toBe(true);
    expect(isStructuredDetail([{ a: 1 }])).toBe(true);
    expect(isStructuredDetail(['a'])).toBe(false);
    expect(isStructuredDetail('a')).toBe(false);
    expect(textExcerpt('short  text\n')).toBe('short text');
    expect(textExcerpt('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(textExcerpt(null)).toBe('');
  });
});
