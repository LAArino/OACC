// SPDX-License-Identifier: EUPL-1.2
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractInvitation,
  extractInvitationToken,
  IDP_ALIAS_PATTERN,
  invitationMismatchReason,
  isIdpAlias,
  LAST_IDP_KEY,
  PENDING_INVITATION_IDP_KEY,
  PENDING_INVITATION_KEY,
  parkInvitation,
  parkInvitationToken,
  recallIdpAlias,
  rememberIdpAlias,
  takeParkedInvitation,
  takeParkedInvitationToken,
} from '../app/utils/invitation';

const TOKEN = 'A'.repeat(20) + '_-' + 'b9'.repeat(10) + 'z'; // 43 base64url characters

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe('extractInvitationToken', () => {
  it('reads the token from the fragment', () => {
    expect(TOKEN).toHaveLength(43);
    expect(extractInvitationToken(`#token=${TOKEN}`)).toBe(TOKEN);
  });

  it('accepts a fragment without the leading #', () => {
    expect(extractInvitationToken(`token=${TOKEN}`)).toBe(TOKEN);
  });

  it('ignores other fragment parameters', () => {
    expect(extractInvitationToken(`#foo=bar&token=${TOKEN}&x=1`)).toBe(TOKEN);
  });

  it.each(['', '#', '#token=', '#other=1', `#token=${TOKEN}x`, '#token=short', '#token=a+b/c'])(
    'returns null for %j',
    (hash) => {
      expect(extractInvitationToken(hash)).toBeNull();
    },
  );
});

describe('parked invitation token', () => {
  it('is stored under one key and removed when taken', () => {
    const storage = new MemoryStorage();
    parkInvitationToken(storage, TOKEN);
    expect(storage.length).toBe(1);
    expect(storage.getItem(PENDING_INVITATION_KEY)).toBe(TOKEN);
    expect(takeParkedInvitationToken(storage)).toBe(TOKEN);
    expect(storage.length).toBe(0);
    expect(takeParkedInvitationToken(storage)).toBeNull();
  });

  it('discards a malformed parked value', () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_INVITATION_KEY, 'not-a-token');
    expect(takeParkedInvitationToken(storage)).toBeNull();
    expect(storage.length).toBe(0);
  });
});

describe('extractInvitation (token and IdP alias)', () => {
  it('reads the optional idp next to the token', () => {
    expect(extractInvitation(`#token=${TOKEN}&idp=uibk`)).toEqual({ token: TOKEN, idp: 'uibk' });
    expect(extractInvitation(`#idp=vu-amsterdam&token=${TOKEN}`)).toEqual({
      token: TOKEN,
      idp: 'vu-amsterdam',
    });
    expect(extractInvitation(`#token=${TOKEN}`)).toEqual({ token: TOKEN, idp: null });
  });

  it.each(['x'.repeat(101), '-uibk', '.uibk', 'local', 'LOCAL', '../evil', 'a b', 'uni/bk', ''])(
    'drops a malformed alias %j but keeps the token',
    (idp) => {
      expect(extractInvitation(`#token=${TOKEN}&idp=${encodeURIComponent(idp)}`)).toEqual({
        token: TOKEN,
        idp: null,
      });
    },
  );

  it('needs a well-formed token', () => {
    expect(extractInvitation('#idp=uibk')).toBeNull();
    expect(extractInvitation('#token=short&idp=uibk')).toBeNull();
  });

  it.each([
    ['uibk', true],
    ['vu-amsterdam', true],
    ['uni.bk', true],
    ['uni_bk', true],
    ['ab', true],
    ['x'.repeat(100), true],
    ['x'.repeat(101), false],
    ['-ab', false],
    ['local', false],
    ['Local', false],
    ['a b', false],
    [null, false],
    [42, false],
  ])('isIdpAlias(%j) = %j', (value, expected) => {
    expect(isIdpAlias(value)).toBe(expected);
  });
});

describe('IdP alias pattern', () => {
  it('is the API rule exported by @oecp/schemas', async () => {
    const shared = await import('@oecp/schemas');
    expect(IDP_ALIAS_PATTERN).toBe(shared.IDP_ALIAS_PATTERN);
  });
});

describe('parked invitation with IdP alias', () => {
  it('keeps the alias with the token for the login round-trip and clears both', () => {
    const storage = new MemoryStorage();
    parkInvitation(storage, { token: TOKEN, idp: 'uibk' });
    expect(storage.getItem(PENDING_INVITATION_IDP_KEY)).toBe('uibk');
    expect(takeParkedInvitation(storage)).toEqual({ token: TOKEN, idp: 'uibk' });
    expect(storage.length).toBe(0);
    expect(takeParkedInvitation(storage)).toBeNull();
  });

  it('parks no alias for local accounts and forgets a stale one', () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_INVITATION_IDP_KEY, 'stale');
    parkInvitation(storage, { token: TOKEN, idp: null });
    expect(storage.getItem(PENDING_INVITATION_IDP_KEY)).toBeNull();
    expect(takeParkedInvitation(storage)).toEqual({ token: TOKEN, idp: null });
  });

  it('discards a tampered alias', () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_INVITATION_KEY, TOKEN);
    storage.setItem(PENDING_INVITATION_IDP_KEY, 'https://evil.example');
    expect(takeParkedInvitation(storage)).toEqual({ token: TOKEN, idp: null });
    expect(storage.length).toBe(0);
  });
});

describe('remembered IdP alias (localStorage convenience)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores and recalls a valid alias only', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    expect(recallIdpAlias()).toBeNull();
    rememberIdpAlias('uibk');
    expect(storage.getItem(LAST_IDP_KEY)).toBe('uibk');
    expect(recallIdpAlias()).toBe('uibk');
    rememberIdpAlias('NOT VALID');
    expect(recallIdpAlias()).toBe('uibk');
    storage.setItem(LAST_IDP_KEY, '<script>');
    expect(recallIdpAlias()).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    vi.stubGlobal('window', { localStorage: blocked });
    expect(() => rememberIdpAlias('uibk')).not.toThrow();
    expect(recallIdpAlias()).toBeNull();
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('SecurityError');
      },
    });
    expect(recallIdpAlias()).toBeNull();
    expect(() => rememberIdpAlias('uibk')).not.toThrow();
  });
});

describe('invitationMismatchReason', () => {
  const mismatch = (problem: unknown) => ({ codes: ['oecp.invitation.mismatch'], problem });

  it('reads the top-level reason, then the matching errors[] item', () => {
    expect(invitationMismatchReason(mismatch({ reason: 'email' }))).toBe('email');
    expect(invitationMismatchReason(mismatch({ reason: 'idp' }))).toBe('idp');
    expect(invitationMismatchReason(mismatch({ reason: 'home_organization' }))).toBe(
      'home_organization',
    );
    expect(invitationMismatchReason(mismatch({ reason: 'organization' }))).toBe('organization');
    expect(
      invitationMismatchReason(
        mismatch({
          errors: [
            { code: 'oecp.other', reason: 'email' },
            { code: 'oecp.invitation.mismatch', reason: 'idp' },
          ],
        }),
      ),
    ).toBe('idp');
  });

  it('is null for other errors and for missing or unknown reasons', () => {
    expect(
      invitationMismatchReason({
        codes: ['oecp.invitation.expired'],
        problem: { reason: 'email' },
      }),
    ).toBeNull();
    expect(invitationMismatchReason(mismatch(undefined))).toBeNull();
    expect(invitationMismatchReason(mismatch({}))).toBeNull();
    expect(invitationMismatchReason(mismatch({ reason: 'EMAIL' }))).toBeNull();
    expect(invitationMismatchReason(mismatch({ reason: 42, errors: 'x' }))).toBeNull();
  });
});
