// SPDX-License-Identifier: EUPL-1.2
/**
 * Self-signed RSA X.509 certificates built at test time (Node can parse but not
 * issue certificates): a minimal DER encoder for a v3 TBSCertificate without
 * extensions, signed with sha256WithRSAEncryption.
 */
import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign,
} from 'node:crypto';

const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, ...content: Buffer[]): Buffer => {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...c: Buffer[]) => tlv(0x30, ...c);
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [a! * 40 + b!];
  for (const n of rest) {
    const chunk: number[] = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const integer = (bytes: Buffer): Buffer =>
  tlv(0x02, bytes[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const time = (d: Date): Buffer => {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  const year = d.getUTCFullYear();
  return year >= 1950 && year < 2050
    ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`))
    : tlv(0x18, Buffer.from(`${iso}Z`));
};
const name = (cn: string) =>
  seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
/** Positive, minimally encoded (DER rejects a redundant leading zero byte). */
const serialNumber = (): Buffer => {
  const bytes = randomBytes(12);
  bytes[0] = (bytes[0]! & 0x7f) | 0x01;
  return bytes;
};
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));

export interface TestCertificate {
  privateKey: KeyObject;
  /** PEM private key (PKCS#8). */
  keyPem: string;
  /** PEM certificate. */
  pem: string;
  /** Base64 DER, as in ds:X509Certificate and Keycloak's `signingCertificate`. */
  der: string;
}

export function createTestCertificate(
  cn: string,
  notBefore: Date,
  notAfter: Date,
  key?: KeyObject,
): TestCertificate {
  const privateKey = key ?? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const publicDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(serialNumber()),
    SHA256_RSA,
    name(cn),
    seq(time(notBefore), time(notAfter)),
    name(cn),
    publicDer,
  );
  const signature = sign('sha256', tbs, privateKey);
  const cert = seq(tbs, SHA256_RSA, tlv(0x03, Buffer.from([0]), signature));
  const der = cert.toString('base64');
  return {
    privateKey,
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    pem: `-----BEGIN CERTIFICATE-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`,
    der,
  };
}

const DAY = 24 * 60 * 60 * 1000;
/** A date `days` from now (negative = past). */
export const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY);
