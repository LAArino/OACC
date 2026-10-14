// SPDX-License-Identifier: EUPL-1.2
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { type Db, KYSELY } from '../db/db.module.js';

/**
 * `secret_ref` values (spec §6.2.2, §10 Security): `db:<uuid>` points at a row of
 * `secrets` (MVP); `openbao:<path>` is reserved for the v1 OpenBao provider.
 */
export const SECRET_REF_PATTERN = /^(db:[0-9a-f-]{36}|openbao:[A-Za-z0-9/_-]+)$/;

/** Master key version used for new ciphertexts; rotation (re-encryption) is not implemented yet. */
export const CURRENT_KEY_VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

export interface SecretsOptions {
  /** Returns the master keys by version; called lazily so a missing key fails only on use. */
  masterKeys: () => ReadonlyMap<number, Buffer>;
  currentKeyVersion?: number;
}

export const SECRETS_OPTIONS = Symbol('SECRETS_OPTIONS');

/** Reads `OECP_MASTER_KEY_FILE`: base64 of exactly 32 random bytes (`openssl rand -base64 32`). */
export function readMasterKeyFile(path: string): Buffer {
  let text: string;
  try {
    text = readFileSync(path, 'utf8').trim();
  } catch (error) {
    throw new SecretError(`Master key file ${path} cannot be read: ${(error as Error).message}`);
  }
  return parseMasterKey(text);
}

export function parseMasterKey(base64: string): Buffer {
  const trimmed = base64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new SecretError('Master key is not base64');
  }
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SecretError(`Master key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

/**
 * Additional authenticated data: binds a ciphertext to its row and purpose, so a
 * ciphertext copied into another row (or relabelled) no longer decrypts.
 */
function aad(id: string, purpose: string, keyVersion: number): Buffer {
  return Buffer.from(`oecp-secret-v1\u0000${id}\u0000${purpose}\u0000${keyVersion}`, 'utf8');
}

/**
 * Application-level AES-256-GCM encryption of partner credentials in the
 * `secrets` table. Plaintexts are never logged and never returned by the API.
 */
@Injectable()
export class SecretsService {
  private readonly currentKeyVersion: number;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    @Inject(SECRETS_OPTIONS) private readonly options: SecretsOptions,
  ) {
    this.currentKeyVersion = options.currentKeyVersion ?? CURRENT_KEY_VERSION;
  }

  /** Encrypts and stores a new secret; returns its `db:<uuid>` reference. */
  async store(purpose: string, plaintext: string, db: Db = this.db): Promise<string> {
    const id = randomUUID();
    const row = this.encrypt(id, purpose, plaintext);
    await db.insertInto('secrets').values(row).execute();
    return `db:${id}`;
  }

  /** Replaces the plaintext of an existing `db:` secret in place (same reference). */
  async replace(ref: string, plaintext: string, db: Db = this.db): Promise<void> {
    const id = this.dbId(ref);
    const current = await db
      .selectFrom('secrets')
      .select(['purpose'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!current) throw new SecretError(`Secret ${ref} does not exist`);
    const { nonce, ciphertext, key_version } = this.encrypt(id, current.purpose, plaintext);
    await db
      .updateTable('secrets')
      .set({ nonce, ciphertext, key_version })
      .where('id', '=', id)
      .execute();
  }

  /** Decrypts a secret. Throws {@link SecretError} if it is missing or does not authenticate. */
  async reveal(ref: string, db: Db = this.db): Promise<string> {
    const id = this.dbId(ref);
    const row = await db
      .selectFrom('secrets')
      .select(['id', 'purpose', 'key_version', 'nonce', 'ciphertext'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new SecretError(`Secret ${ref} does not exist`);
    const key = this.key(row.key_version);
    if (row.nonce.length !== NONCE_BYTES || row.ciphertext.length < TAG_BYTES) {
      throw new SecretError(`Secret ${ref} is malformed`);
    }
    const body = row.ciphertext.subarray(0, row.ciphertext.length - TAG_BYTES);
    const tag = row.ciphertext.subarray(row.ciphertext.length - TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, row.nonce, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad(row.id, row.purpose, row.key_version));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretError(`Secret ${ref} cannot be decrypted (wrong master key or tampered row)`);
    }
  }

  /** Deletes a `db:` secret (credentials are destroyed, not soft-deleted). */
  async delete(ref: string, db: Db = this.db): Promise<void> {
    await db.deleteFrom('secrets').where('id', '=', this.dbId(ref)).execute();
  }

  private encrypt(id: string, purpose: string, plaintext: string) {
    const keyVersion = this.currentKeyVersion;
    const key = this.key(keyVersion);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(id, purpose, keyVersion));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      id,
      purpose,
      key_version: keyVersion,
      nonce,
      ciphertext: Buffer.concat([body, cipher.getAuthTag()]),
    };
  }

  private key(version: number): Buffer {
    let keys: ReadonlyMap<number, Buffer>;
    try {
      keys = this.options.masterKeys();
    } catch (error) {
      if (error instanceof SecretError) throw error;
      throw new SecretError(`Master key unavailable: ${(error as Error).message}`);
    }
    const key = keys.get(version);
    if (!key) throw new SecretError(`Master key version ${version} is not available`);
    return key;
  }

  private dbId(ref: string): string {
    if (ref.startsWith('openbao:')) {
      throw new SecretError('openbao: secret references are not supported before v1');
    }
    const match = /^db:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(ref);
    if (!match?.[1]) throw new SecretError('Invalid secret reference');
    return match[1];
  }
}
