// SPDX-License-Identifier: EUPL-1.2
import { createHash } from 'node:crypto';

/**
 * RFC 8785 JSON Canonicalization Scheme for JSON-compatible values: object members
 * sorted by UTF-16 code units, no whitespace, ECMAScript number and string
 * serialisation (which RFC 8785 adopts). Members whose value is `undefined` are
 * omitted, as `JSON.stringify` does; non-finite numbers, bigints, functions and
 * symbols are rejected.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      const withJson = value as { toJSON?: () => unknown };
      if (typeof withJson.toJSON === 'function') return canonicalize(withJson.toJSON());
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const members = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
      return `{${members.join(',')}}`;
    }
    default:
      throw new TypeError(`JCS: unsupported ${typeof value}`);
  }
}

/** SHA-256 of the RFC 8785 serialisation (spec §6.1 `content_hash`). */
export function jcsSha256(value: unknown): Buffer {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest();
}
