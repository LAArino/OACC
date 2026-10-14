// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { canonicalize, jcsSha256 } from '../../src/ingestion/jcs.js';

describe('RFC 8785 canonicalization', () => {
  it('sorts members by UTF-16 code units and drops whitespace', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}',
    );
    // RFC 8785 §3.2.3 example ordering: "\r" < "1" < "\u0080" < "ö" < "€" < "😀" < "ﬂ"
    const keys = { '€': 0, '\r': 0, דּ: 0, '1': 0, '😀': 0, '\u0080': 0, ö: 0 };
    const order = ['\r', '1', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33'];
    expect(canonicalize(keys)).toBe(`{${order.map((k) => `${JSON.stringify(k)}:0`).join(',')}}`);
  });

  it('serialises numbers like ECMAScript', () => {
    expect(canonicalize([7.5, 1e21, 1e-7, -0, 0.1 + 0.2, 100])).toBe(
      '[7.5,1e+21,1e-7,0,0.30000000000000004,100]',
    );
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(1n)).toThrow();
  });

  it('escapes strings minimally and omits undefined members', () => {
    expect(canonicalize({ s: '\u0000\n"é€', u: undefined })).toBe('{"s":"\\u0000\\n\\"é€"}');
  });

  it('hashes key order independently', () => {
    expect(jcsSha256({ a: 1, b: 2 }).equals(jcsSha256({ b: 2, a: 1 }))).toBe(true);
    expect(jcsSha256({ a: 1 }).equals(jcsSha256({ a: 2 }))).toBe(false);
    expect(jcsSha256({})).toHaveLength(32);
  });
});
