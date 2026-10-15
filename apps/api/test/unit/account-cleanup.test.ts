// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  type AccountEvidence,
  decideAccountDeletion,
  isServiceAccount,
} from '../../src/maintenance/account-cleanup.js';
import {
  MAINTENANCE_SCHEDULES,
  ON_DEMAND_JOBS,
} from '../../src/maintenance/maintenance.constants.js';

const d = (iso: string) => new Date(iso);
const cutoff = d('2027-06-01T05:15:00Z');
const base: AccountEvidence = {
  lastRemovalAt: d('2027-03-01T00:00:00Z'),
  lastGrantAt: null,
  roles: [],
  serviceAccount: false,
  organizationAttribute: false,
  createdAt: d('2026-01-01T00:00:00Z'),
  lastActivityAt: null,
  lastLoginAt: null,
  pendingInvitation: false,
};
const decide = (patch: Partial<AccountEvidence>) =>
  decideAccountDeletion({ ...base, ...patch }, cutoff);

describe('account cleanup decision (spec §2.2, §10)', () => {
  it('deletes a role-less account removed before the cutoff with no later sign of life', () => {
    expect(decide({})).toEqual({ delete: true });
    expect(decide({ lastActivityAt: d('2027-05-31T00:00:00Z') })).toEqual({ delete: true });
    expect(decide({ lastGrantAt: d('2026-12-01T00:00:00Z') })).toEqual({ delete: true });
  });

  it('keeps accounts that hold a role, are service accounts or still carry oecp_org_id', () => {
    expect(decide({ roles: ['partner_admin'] })).toEqual({ delete: false, reason: 'has_role' });
    expect(decide({ serviceAccount: true })).toEqual({ delete: false, reason: 'service_account' });
    expect(decide({ organizationAttribute: true })).toEqual({
      delete: false,
      reason: 'organization_attribute',
    });
  });

  it('keeps accounts granted a role after the removal', () => {
    expect(decide({ lastGrantAt: d('2027-03-02T00:00:00Z') })).toEqual({
      delete: false,
      reason: 'granted_after_removal',
    });
  });

  it('keeps accounts created within the period or without a creation date', () => {
    expect(decide({ createdAt: cutoff })).toEqual({ delete: false, reason: 'recent_creation' });
    expect(decide({ createdAt: null })).toEqual({ delete: false, reason: 'no_creation_date' });
    expect(decide({ createdAt: new Date(Number.NaN) })).toEqual({
      delete: false,
      reason: 'no_creation_date',
    });
  });

  it('keeps accounts used on or after the cutoff or invited again', () => {
    expect(decide({ lastActivityAt: cutoff })).toEqual({
      delete: false,
      reason: 'recent_activity',
    });
    expect(decide({ lastLoginAt: d('2028-01-01T00:00:00Z') })).toEqual({
      delete: false,
      reason: 'recent_login',
    });
    expect(decide({ pendingInvitation: true })).toEqual({
      delete: false,
      reason: 'pending_invitation',
    });
  });

  it('recognises service-account users', () => {
    expect(isServiceAccount({ username: 'service-account-oecp-backend' })).toBe(true);
    expect(isServiceAccount({ username: 'x', serviceAccountClientId: 'oecp-backend' })).toBe(true);
    expect(isServiceAccount({ username: 'ana@urv.cat' })).toBe(false);
    expect(isServiceAccount({})).toBe(false);
  });

  it('runs daily at 05:15 UTC, after dormancy, and on demand', () => {
    expect(MAINTENANCE_SCHEDULES).toContainEqual({ job: 'account-cleanup', pattern: '15 5 * * *' });
    expect(ON_DEMAND_JOBS).toContain('account-cleanup');
  });
});
