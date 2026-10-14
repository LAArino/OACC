// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
// Minimal RFC 6238 TOTP (SHA-1, 6 digits, 30 s) with base32 secret, no deps.
const nodeCrypto = require('node:crypto');
function base32Decode(s) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '', out = [];
  for (const c of s) bits += a.indexOf(c).toString(2).padStart(5, '0');
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, { digits = 6, period = 30, algo = 'sha1', t = Date.now() } = {}) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / period)));
  const h = nodeCrypto.createHmac(algo, key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0');
  return code;
}
module.exports = { totp, base32Decode };
if (require.main === module) {
  // self-test vector from RFC 6238 (SHA1, 8 digits) adapted: just print a code for a known secret
  console.log(totp('JBSWY3DPEHPK3PXP'));
}
