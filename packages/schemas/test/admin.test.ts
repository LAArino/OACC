// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  acceptInvitationRequest,
  createInvitationRequest,
  INVITATION_DEFAULT_TTL_HOURS,
} from '../src/index.js';

describe('admin API schemas', () => {
  it('accepts only 43-character base64url invitation tokens', () => {
    expect(acceptInvitationRequest.safeParse({ token: 'A'.repeat(43) }).success).toBe(true);
    expect(acceptInvitationRequest.safeParse({ token: 'A'.repeat(44) }).success).toBe(false);
    expect(acceptInvitationRequest.safeParse({ token: `${'A'.repeat(42)}=` }).success).toBe(false);
    expect(acceptInvitationRequest.safeParse({ token: 'A'.repeat(43), x: 1 }).success).toBe(false);
  });

  it('normalizes invitation e-mails and defaults to 7 days', () => {
    const parsed = createInvitationRequest.parse({
      email: 'Admin@URV.cat',
      role: 'partner_admin',
      organization_id: '0b8f6c1e-6a3d-4c55-9a43-0f3d3c2b9a10',
    });
    expect(parsed).toEqual({
      email: 'admin@urv.cat',
      role: 'partner_admin',
      organization_id: '0b8f6c1e-6a3d-4c55-9a43-0f3d3c2b9a10',
      ttl_hours: INVITATION_DEFAULT_TTL_HOURS,
    });
    expect(INVITATION_DEFAULT_TTL_HOURS).toBe(168);
  });

  it('rejects unknown roles and TTLs beyond 7 days', () => {
    const base = { email: 'a@b.eu', organization_id: '0b8f6c1e-6a3d-4c55-9a43-0f3d3c2b9a10' };
    expect(createInvitationRequest.safeParse({ ...base, role: 'superuser' }).success).toBe(false);
    expect(
      createInvitationRequest.safeParse({ ...base, role: 'partner_admin', ttl_hours: 169 }).success,
    ).toBe(false);
  });
});
