// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  extractInvitationToken,
  PENDING_INVITATION_KEY,
  parkInvitationToken,
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
