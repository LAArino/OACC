// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  type AdminAccount,
  decideDormancy,
  planRevocations,
} from '../../src/maintenance/dormancy.js';
import { maintenanceOptions } from '../../src/maintenance/maintenance.constants.js';
import {
  addMonths,
  boundLiteral,
  historyPartition,
  parseHistoryPartitionName,
  partitionsToDrop,
  partitionsToEnsure,
  subtractMonths,
} from '../../src/maintenance/months.js';
import { retentionCutoffs } from '../../src/maintenance/retention.service.js';

const d = (iso: string) => new Date(iso);
const DAY = 86_400_000;

describe('history partition names and ranges', () => {
  it('names partitions like migration 0001, with UTC month bounds', () => {
    const p = historyPartition({ year: 2026, month: 11 });
    expect(p.name).toBe('ext_metadata_history_2026_11');
    expect(p.from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(boundLiteral(p.from)).toBe("'2026-11-01 00:00:00+00'");
    expect(historyPartition({ year: 2026, month: 12 }).to.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('ensures the current month and the next three, across a year boundary', () => {
    expect(partitionsToEnsure(d('2026-11-30T23:59:59Z'), 3).map((p) => p.name)).toEqual([
      'ext_metadata_history_2026_11',
      'ext_metadata_history_2026_12',
      'ext_metadata_history_2027_01',
      'ext_metadata_history_2027_02',
    ]);
    // The month is taken in UTC: 00:30 in Madrid on 1 December is still November.
    expect(partitionsToEnsure(d('2026-11-30T23:30:00Z'), 0)[0]?.name).toBe(
      'ext_metadata_history_2026_11',
    );
  });

  it('parses only managed partition names', () => {
    expect(parseHistoryPartitionName('ext_metadata_history_2027_02')?.from.toISOString()).toBe(
      '2027-02-01T00:00:00.000Z',
    );
    expect(parseHistoryPartitionName('ext_metadata_history_default')).toBeUndefined();
    expect(parseHistoryPartitionName('ext_metadata_history_2027_13')).toBeUndefined();
    expect(parseHistoryPartitionName('ext_metadata_history_2027_00')).toBeUndefined();
    expect(parseHistoryPartitionName('other_2027_01')).toBeUndefined();
  });

  it('adds and subtracts calendar months', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2027, month: 1 }, -13)).toEqual({ year: 2025, month: 12 });
    expect(subtractMonths(d('2027-03-31T10:20:30.400Z'), 1).toISOString()).toBe(
      '2027-02-28T10:20:30.400Z',
    );
    expect(subtractMonths(d('2028-03-31T00:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(subtractMonths(d('2027-01-15T00:00:00Z'), 12).toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
  });

  it('drops a partition only when its whole month is older than the retention', () => {
    const names = [
      'ext_metadata_history_default',
      'ext_metadata_history_2025_10',
      'ext_metadata_history_2025_11',
      'ext_metadata_history_2025_12',
      'ext_metadata_history_2026_11',
    ];
    // 12 months before 2026-12-01T00:00Z is 2025-12-01: November 2025 ends exactly then.
    expect(partitionsToDrop(names, d('2026-12-01T00:00:00Z'), 12).map((p) => p.name)).toEqual([
      'ext_metadata_history_2025_10',
      'ext_metadata_history_2025_11',
    ]);
    expect(partitionsToDrop(names, d('2026-11-30T23:59:59Z'), 12).map((p) => p.name)).toEqual([
      'ext_metadata_history_2025_10',
    ]);
    expect(partitionsToDrop(names, d('2026-12-01T00:00:00Z'), 24)).toEqual([]);
    // The default partition is never a candidate, whatever the retention.
    expect(partitionsToDrop(names, d('2040-01-01T00:00:00Z'), 1).map((p) => p.name)).not.toContain(
      'ext_metadata_history_default',
    );
  });
});

describe('retention cut-offs (spec §10)', () => {
  it('derives every cut-off from the configured months', () => {
    const options = maintenanceOptions({
      OECP_RETENTION_HISTORY_MONTHS: 12,
      OECP_RETENTION_SYNC_ERRORS_MONTHS: 12,
      OECP_RETENTION_SYNC_RUNS_MONTHS: 24,
      OECP_RETENTION_AUDIT_MONTHS: 36,
      OECP_RETENTION_SOFT_DELETED_MONTHS: 12,
      OECP_DORMANCY_DAYS: 180,
      OECP_DORMANCY_DRY_RUN: true,
      OECP_ACCOUNT_DELETE_MONTHS: 12,
      OECP_ACCOUNT_CLEANUP_DRY_RUN: true,
    });
    const cut = retentionCutoffs(d('2029-05-31T04:45:00Z'), options);
    expect(cut.sync_errors.toISOString()).toBe('2028-05-31T04:45:00.000Z');
    expect(cut.sync_runs.toISOString()).toBe('2027-05-31T04:45:00.000Z');
    expect(cut.audit_log.toISOString()).toBe('2026-05-31T04:45:00.000Z');
    expect(cut.admin_invitations.toISOString()).toBe('2028-05-31T04:45:00.000Z');
    expect(cut.maintenance_runs.toISOString()).toBe('2028-05-31T04:45:00.000Z');
    expect(cut.admin_activity.toISOString()).toBe('2028-05-31T04:45:00.000Z');

    const custom = retentionCutoffs(d('2029-05-31T04:45:00Z'), {
      ...options,
      syncErrorsRetentionMonths: 3,
      auditRetentionMonths: 120,
    });
    expect(custom.sync_errors.toISOString()).toBe('2029-02-28T04:45:00.000Z');
    expect(custom.audit_log.toISOString()).toBe('2019-05-31T04:45:00.000Z');
  });
});

describe('dormancy decision (spec §2.2)', () => {
  const now = d('2027-12-01T05:00:00Z');
  const tracking = d('2026-10-15T00:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const evidence = (patch: Partial<Parameters<typeof decideDormancy>[0]>) => ({
    lastSeenAt: null,
    lastLoginAt: null,
    createdAt: ago(1000),
    trackingSince: tracking,
    ...patch,
  });

  it('is dormant after more than 180 days without activity', () => {
    const decision = decideDormancy(evidence({ lastSeenAt: ago(181) }), now, 180);
    expect(decision).toMatchObject({ dormant: true, basis: 'api_activity', inactiveDays: 181 });
  });

  it('keeps exactly 180 days, and any more recent evidence', () => {
    expect(decideDormancy(evidence({ lastSeenAt: ago(180) }), now, 180).dormant).toBe(false);
    const login = decideDormancy(
      evidence({ lastSeenAt: ago(400), lastLoginAt: ago(10) }),
      now,
      180,
    );
    expect(login).toMatchObject({ dormant: false, reason: 'active', basis: 'keycloak_login' });
  });

  it('never revokes an account created less than 180 days ago', () => {
    const decision = decideDormancy(evidence({ createdAt: ago(179) }), now, 180);
    expect(decision).toMatchObject({ dormant: false, basis: 'account_created' });
  });

  it('never counts inactivity from before the start of activity tracking', () => {
    const early = d('2027-03-01T00:00:00Z'); // 136 days after tracking started
    expect(decideDormancy(evidence({}), early, 180)).toMatchObject({
      dormant: false,
      basis: 'tracking_start',
    });
    expect(decideDormancy(evidence({}), now, 180)).toMatchObject({
      dormant: true,
      basis: 'tracking_start',
    });
  });

  it('decides nothing without a creation date', () => {
    expect(decideDormancy(evidence({ createdAt: null }), now, 180)).toMatchObject({
      dormant: false,
      reason: 'no_evidence',
    });
  });

  it('honours a configured threshold', () => {
    expect(decideDormancy(evidence({ lastSeenAt: ago(91) }), now, 90).dormant).toBe(true);
    expect(decideDormancy(evidence({ lastSeenAt: ago(91) }), now, 180).dormant).toBe(false);
  });
});

describe('revocation plan', () => {
  const now = d('2027-12-01T05:00:00Z');
  const account = (
    sub: string,
    roles: AdminAccount['roles'],
    idleDays: number | null,
  ): AdminAccount => ({
    sub,
    roles,
    decision:
      idleDays === null
        ? { dormant: false, reason: 'active', lastActivityAt: now, basis: 'api_activity' }
        : {
            dormant: true,
            lastActivityAt: new Date(now.getTime() - idleDays * DAY),
            basis: 'api_activity',
            inactiveDays: idleDays,
          },
  });

  it('revokes dormant partner admins, longest inactive first, and keeps active ones', () => {
    const plan = planRevocations([
      account('p1', ['partner_admin'], 200),
      account('p2', ['partner_admin'], null),
      account('p3', ['partner_admin'], 400),
      account('a1', ['alliance_admin'], null),
    ]);
    expect(plan.revoke.map((a) => a.sub)).toEqual(['p3', 'p1']);
    expect(plan.keptLastAllianceAdmin).toEqual([]);
  });

  it('never revokes the last alliance_admin: keeps the most recently active one', () => {
    const plan = planRevocations([
      account('a1', ['alliance_admin'], 300),
      account('a2', ['alliance_admin'], 200),
      account('a3', ['alliance_admin', 'partner_admin'], 500),
    ]);
    expect(plan.revoke.map((a) => a.sub)).toEqual(['a3', 'a1']);
    expect(plan.keptLastAllianceAdmin.map((a) => a.sub)).toEqual(['a2']);
  });

  it('revokes a dormant alliance_admin while an active one remains', () => {
    const plan = planRevocations([
      account('a1', ['alliance_admin'], 300),
      account('a2', ['alliance_admin'], null),
    ]);
    expect(plan.revoke.map((a) => a.sub)).toEqual(['a1']);
    expect(planRevocations([account('only', ['alliance_admin'], 900)]).revoke).toEqual([]);
  });
});
