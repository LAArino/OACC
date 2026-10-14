// SPDX-License-Identifier: EUPL-1.2
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseMasterKey,
  readMasterKeyFile,
  SecretError,
  SecretsService,
} from '../../src/secrets/secrets.service.js';
import { createFakeDb, insertedValues, type RecordedQuery } from '../support/fake-kysely.js';

interface Row {
  id: string;
  purpose: string;
  key_version: number;
  nonce: Buffer;
  ciphertext: Buffer;
}

function keyFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'oecp-key-'));
  const file = join(dir, 'oecp_master_key');
  writeFileSync(file, contents, { mode: 0o600 });
  return file;
}

describe('SecretsService', () => {
  const key = randomBytes(32);
  const file = keyFile(`${key.toString('base64')}\n`);
  let rows: Map<string, Row>;

  function respond(q: RecordedQuery): unknown[] | undefined {
    if (q.sql.startsWith('insert into "secrets"')) {
      const v = insertedValues(q) as unknown as Row;
      rows.set(v.id, v);
      return [];
    }
    if (q.sql.startsWith('select')) {
      const row = rows.get(q.parameters[0] as string);
      return row ? [row] : [];
    }
    if (q.sql.startsWith('update "secrets"')) {
      const [nonce, ciphertext, keyVersion, id] = q.parameters as [Buffer, Buffer, number, string];
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, nonce, ciphertext, key_version: keyVersion });
      return [];
    }
    if (q.sql.startsWith('delete from "secrets"')) {
      rows.delete(q.parameters[0] as string);
      return [];
    }
    return undefined;
  }

  const service = (keys = () => new Map([[1, readMasterKeyFile(file)]])) =>
    new SecretsService(createFakeDb(respond).db, { masterKeys: keys });

  beforeEach(() => {
    rows = new Map();
  });

  it('stores AES-256-GCM ciphertext and reveals it with the master key', async () => {
    const secrets = service();
    const ref = await secrets.store('partner-integration:x', 'oecp:oecp-mock-secret');
    expect(ref).toMatch(/^db:[0-9a-f-]{36}$/);
    const row = [...rows.values()][0]!;
    expect(row.key_version).toBe(1);
    expect(row.nonce).toHaveLength(12);
    expect(row.ciphertext.toString('utf8')).not.toContain('oecp-mock-secret');
    expect(row.ciphertext).toHaveLength('oecp:oecp-mock-secret'.length + 16);
    await expect(secrets.reveal(ref)).resolves.toBe('oecp:oecp-mock-secret');
  });

  it('uses a fresh nonce per encryption', async () => {
    const secrets = service();
    const a = await secrets.store('p', 'same');
    const b = await secrets.store('p', 'same');
    const [ra, rb] = [rows.get(a.slice(3))!, rows.get(b.slice(3))!];
    expect(ra.nonce.equals(rb.nonce)).toBe(false);
    expect(ra.ciphertext.equals(rb.ciphertext)).toBe(false);
  });

  it('replaces in place and deletes', async () => {
    const secrets = service();
    const ref = await secrets.store('p', 'old');
    await secrets.replace(ref, 'new');
    await expect(secrets.reveal(ref)).resolves.toBe('new');
    await secrets.delete(ref);
    await expect(secrets.reveal(ref)).rejects.toBeInstanceOf(SecretError);
  });

  it('refuses a wrong master key, tampering and swapped rows', async () => {
    const secrets = service();
    const ref = await secrets.store('p', 'value');
    const other = service(() => new Map([[1, randomBytes(32)]]));
    await expect(other.reveal(ref)).rejects.toThrow(/cannot be decrypted/);

    const row = rows.get(ref.slice(3))!;
    const tampered = Buffer.from(row.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    rows.set(row.id, { ...row, ciphertext: tampered });
    await expect(secrets.reveal(ref)).rejects.toBeInstanceOf(SecretError);

    // A ciphertext moved to another row (or purpose) no longer authenticates.
    const a = await secrets.store('p', 'a');
    const b = await secrets.store('p', 'b');
    const rowA = rows.get(a.slice(3))!;
    const rowB = rows.get(b.slice(3))!;
    rows.set(rowB.id, { ...rowB, nonce: rowA.nonce, ciphertext: rowA.ciphertext });
    await expect(secrets.reveal(b)).rejects.toBeInstanceOf(SecretError);
    rows.set(rowA.id, { ...rowA, purpose: 'other' });
    await expect(secrets.reveal(a)).rejects.toBeInstanceOf(SecretError);
  });

  it('refuses unknown key versions, invalid and openbao references', async () => {
    const secrets = service();
    const ref = await secrets.store('p', 'v');
    rows.set(ref.slice(3), { ...rows.get(ref.slice(3))!, key_version: 2 });
    await expect(secrets.reveal(ref)).rejects.toThrow(/version 2/);
    await expect(secrets.reveal('openbao:kv/oecp/uibk')).rejects.toThrow(/openbao/);
    await expect(secrets.reveal('db:not-a-uuid')).rejects.toThrow(/Invalid secret reference/);
    await expect(secrets.reveal('db:00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      /does not exist/,
    );
  });

  it('reads the master key file: base64 of exactly 32 bytes', () => {
    expect(readMasterKeyFile(file).equals(key)).toBe(true);
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => parseMasterKey('not base64 !')).toThrow(/base64/);
    expect(() => readMasterKeyFile(join(tmpdir(), 'missing-oecp-key'))).toThrow(SecretError);
  });

  it('fails on use, not at construction, when the key is unavailable', async () => {
    const secrets = service(() => readMasterKeyFile(join(tmpdir(), 'missing-oecp-key')) as never);
    await expect(secrets.store('p', 'v')).rejects.toBeInstanceOf(SecretError);
  });
});
