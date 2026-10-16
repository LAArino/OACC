// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/** Small helpers: TOTP (RFC 6238), secret files, page text, JWT claims. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { STATE_DIR } from './config';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A file of the state directory for a test account (password, TOTP seed, last OTP period). */
export function stateFile(account: string, kind: 'password' | 'totp' | 'totp-period'): string {
  const slug = account.replace(/[^a-z0-9]/gi, '_');
  return path.join(STATE_DIR, kind === 'totp-period' ? `totp-period-${slug}` : `${slug}.${kind}`);
}

/** Removes the state files of a test account (after its Keycloak user is deleted). */
export function forgetAccount(account: string): void {
  for (const kind of ['password', 'totp', 'totp-period'] as const) {
    fs.rmSync(stateFile(account, kind), { force: true });
  }
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of input.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

/** RFC 6238 TOTP as the realm's policy: HmacSHA1, 6 digits, 30 s. */
export function totp(secret: string, t = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/**
 * A TOTP code of a 30 s period not used before for this account: Keycloak
 * refuses a code reused within its period, also across processes, so the last
 * period per account is kept in the state directory. Also avoids the last 3 s
 * of a period (the code could expire in flight).
 */
export async function freshTotp(account: string, secret: string): Promise<string> {
  const file = stateFile(account, 'totp-period');
  let last = -1;
  try {
    last = Number(fs.readFileSync(file, 'utf8'));
  } catch {
    // first code for this account
  }
  if (Math.floor(Date.now() / 30000) <= last || 30000 - (Date.now() % 30000) < 3000) {
    await sleep(30000 - (Date.now() % 30000) + 500);
  }
  fs.writeFileSync(file, String(Math.floor(Date.now() / 30000)));
  return totp(secret);
}

/** Writes a secret file readable by the current user only, without a trailing newline. */
export function writeSecret(file: string, value: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, value, { mode: 0o600 });
}

export const readSecret = (file: string) => fs.readFileSync(file, 'utf8').trim();

/** A random password that satisfies the realm password policy. */
export const randomPassword = () => `E2e-${crypto.randomBytes(18).toString('base64url')}-9a`;

/** Visible text of the page, whitespace collapsed. */
export const bodyText = async (page: Page) =>
  (await page.innerText('body')).replace(/\s+/g, ' ').trim();

export interface AccessTokenClaims {
  iss: string;
  sub: string;
  acr?: string;
  idp?: string;
  org_id?: string;
  roles?: string[];
  email?: string;
  schac_home_organization?: string | string[];
  exp: number;
  iat: number;
}

/** The payload of a JWT (never logged; tests assert on single claims). */
export const decodeJwt = (jwt: string): AccessTokenClaims =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
