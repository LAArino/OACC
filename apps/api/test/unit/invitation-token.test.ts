// SPDX-License-Identifier: EUPL-1.2
import { createHash } from 'node:crypto';
import { invitationToken } from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildInvitationLink,
  generateInvitationToken,
  hashInvitationToken,
} from '../../src/admin/invitations/invitation-token.js';

describe('invitation tokens', () => {
  it('generates 256-bit base64url tokens accepted by the request schema', () => {
    const { token } = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(invitationToken.safeParse(token).success).toBe(true);
  });

  it('returns the SHA-256 of the token as the stored form', () => {
    const { token, sha256 } = generateInvitationToken();
    expect(sha256).toHaveLength(32);
    expect(sha256.equals(createHash('sha256').update(token).digest())).toBe(true);
    expect(hashInvitationToken(token).equals(sha256)).toBe(true);
    expect(sha256.toString('base64url')).not.toBe(token);
  });

  it('never repeats tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInvitationToken().token));
    expect(tokens.size).toBe(200);
  });

  it('carries the token in the URL fragment of the acceptance page', () => {
    const link = buildInvitationLink('https://campus.example.org/', 'abc_-123');
    expect(link).toBe('https://campus.example.org/en/admin/accept#token=abc_-123');
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.hash).toBe('#token=abc_-123');
  });

  it('adds the IdP alias of a brokered organization to the fragment', () => {
    const link = buildInvitationLink('https://campus.example.org', 'abc_-123', {
      idpAlias: 'uibk',
    });
    expect(link).toBe('https://campus.example.org/en/admin/accept#token=abc_-123&idp=uibk');
    const fragment = new URLSearchParams(new URL(link).hash.slice(1));
    expect(fragment.get('token')).toBe('abc_-123');
    expect(fragment.get('idp')).toBe('uibk');
    for (const idpAlias of [null, 'local', 'Not Valid']) {
      expect(buildInvitationLink('https://c.example', 't', { idpAlias })).toBe(
        'https://c.example/en/admin/accept#token=t',
      );
    }
  });
});
