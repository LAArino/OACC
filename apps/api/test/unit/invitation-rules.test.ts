// SPDX-License-Identifier: EUPL-1.2
import { invitation } from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import {
  type AcceptingIdentity,
  checkAcceptance,
  type InvitationOrganization,
  type InvitationState,
  invitationStatus,
  requiresSchacCheck,
  schacMatches,
} from '../../src/admin/invitations/invitation-rules.js';
import { toApiInvitation } from '../../src/admin/invitations/invitations.service.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const ORG = '0b8f6c1e-6a3d-4c55-9a43-0f3d3c2b9a10';

const pending: InvitationState = {
  email: 'admin@urv.cat',
  role: 'partner_admin',
  organization_id: ORG,
  expires_at: new Date('2026-10-20T12:00:00Z'),
  accepted_at: null,
  revoked_at: null,
};
const brokered: InvitationOrganization = {
  id: ORG,
  keycloak_idp_alias: 'urv',
  schac_home_organization: 'urv.cat',
  deleted_at: null,
};
const identity: AcceptingIdentity = {
  sub: 'kc-user',
  email: 'admin@urv.cat',
  idp: 'urv',
  roles: [],
  orgId: undefined,
};

describe('invitation state machine', () => {
  it.each([
    [{}, 'pending'],
    [{ accepted_at: NOW }, 'accepted'],
    [{ revoked_at: NOW }, 'revoked'],
    [{ expires_at: NOW }, 'expired'],
    [{ expires_at: new Date('2026-10-01T00:00:00Z'), revoked_at: NOW }, 'revoked'],
  ] as const)('%o is %s', (patch, status) => {
    expect(invitationStatus({ ...pending, ...patch }, NOW)).toBe(status);
  });
});

describe('checkAcceptance', () => {
  it('accepts a pending invitation for the matching identity', () => {
    expect(checkAcceptance(pending, brokered, identity, NOW)).toBeUndefined();
  });

  it('compares e-mail addresses case-insensitively', () => {
    expect(
      checkAcceptance(pending, brokered, { ...identity, email: 'Admin@URV.cat' }, NOW),
    ).toBeUndefined();
  });

  it.each([
    ['not_found', undefined, brokered, identity],
    ['revoked', { ...pending, revoked_at: NOW }, brokered, identity],
    ['accepted', { ...pending, accepted_at: NOW }, brokered, identity],
    ['expired', { ...pending, expires_at: new Date('2026-10-14T11:59:59Z') }, brokered, identity],
    ['organization_unavailable', pending, undefined, identity],
    ['organization_unavailable', pending, { ...brokered, deleted_at: NOW }, identity],
    ['email_mismatch', pending, brokered, { ...identity, email: 'other@urv.cat' }],
    ['email_mismatch', pending, brokered, { ...identity, email: undefined }],
    ['idp_mismatch', pending, brokered, { ...identity, idp: 'uibk' }],
    ['idp_mismatch', pending, brokered, { ...identity, idp: 'local' }],
    [
      'organization_conflict',
      pending,
      brokered,
      { ...identity, roles: ['partner_admin'], orgId: '2d9f6c1e-6a3d-4c55-9a43-0f3d3c2b9a12' },
    ],
  ] as const)('rejects with %s', (failure, invitation, organization, who) => {
    expect(checkAcceptance(invitation, organization, who, NOW)).toBe(failure);
  });

  it('requires idp "local" for organizations without an IdP alias', () => {
    const local = { ...brokered, keycloak_idp_alias: null };
    expect(checkAcceptance(pending, local, { ...identity, idp: 'local' }, NOW)).toBeUndefined();
    expect(checkAcceptance(pending, local, identity, NOW)).toBe('idp_mismatch');
  });

  it('lets an administrator of the same organization accept (e.g. a new role)', () => {
    const admin = { ...identity, roles: ['partner_admin'] as const, orgId: ORG };
    expect(checkAcceptance(pending, brokered, admin, NOW)).toBeUndefined();
  });
});

describe('schacHomeOrganization check', () => {
  it('applies only to brokered organizations with a value', () => {
    expect(requiresSchacCheck(brokered)).toBe(true);
    expect(requiresSchacCheck({ ...brokered, keycloak_idp_alias: null })).toBe(false);
    expect(requiresSchacCheck({ ...brokered, schac_home_organization: null })).toBe(false);
  });

  it('matches any asserted value, case-insensitively', () => {
    expect(schacMatches('urv.cat', ['URV.cat'])).toBe(true);
    expect(schacMatches('urv.cat', ['example.org', 'urv.cat'])).toBe(true);
    expect(schacMatches('urv.cat', ['urv.es'])).toBe(false);
    expect(schacMatches('urv.cat', [])).toBe(false);
  });
});

describe('toApiInvitation', () => {
  const row = {
    id: '7d1f6c1e-6a3d-4c55-9a43-0f3d3c2b9a99',
    email: 'admin@urv.cat',
    role: 'partner_admin' as const,
    organization_id: ORG,
    token_sha256: Buffer.alloc(32),
    invited_by: 'kc-alliance',
    expires_at: new Date('2026-10-20T12:00:00Z'),
    accepted_at: null,
    accepted_sub: null,
    revoked_at: null,
    created_at: new Date('2026-10-13T12:00:00Z'),
  };

  it.each([
    [{}, NOW, 'pending'],
    [{}, new Date('2026-10-21T00:00:00Z'), 'expired'],
    [{ revoked_at: NOW }, NOW, 'revoked'],
    [{ accepted_at: NOW, accepted_sub: 'kc-user' }, new Date('2026-12-01T00:00:00Z'), 'accepted'],
  ] as const)('derives the status of %o at %s as %s', (patch, now, status) => {
    const api = invitation.parse(toApiInvitation({ ...row, ...patch }, now));
    expect(api.status).toBe(status);
    expect(api).not.toHaveProperty('token_sha256');
    expect(Object.keys(api).sort()).toEqual(
      [
        'accepted_at',
        'accepted_sub',
        'created_at',
        'email',
        'expires_at',
        'id',
        'invited_by',
        'organization_id',
        'revoked_at',
        'role',
        'status',
      ].sort(),
    );
  });
});
