// SPDX-License-Identifier: EUPL-1.2
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';

/** One GET to an already validated address; the hostname is kept for Host, SNI and certificates. */
export interface PinnedRequest {
  url: URL;
  /** IP address the connection must use (DNS pinned by the caller). */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
  maxBodyBytes: number;
}

export interface TransportResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  body: Buffer;
}

export type TransportErrorKind = 'network' | 'timeout' | 'aborted' | 'body_too_large';

export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export type HttpTransport = (request: PinnedRequest) => Promise<TransportResponse>;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** All A/AAAA records, in resolver order. */
export const systemResolver: Resolver = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/**
 * node:http(s) GET whose socket connects only to the pinned address: the custom
 * `lookup` answers every resolution with it, so no second DNS query can steer the
 * connection elsewhere (DNS rebinding). Certificates are still verified against
 * the URL's hostname. The body is buffered up to `maxBodyBytes`.
 */
export const nodeHttpTransport: HttpTransport = (request) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const { url, address, family, headers, signal, maxBodyBytes } = request;
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    };
    const client = url.protocol === 'https:' ? https : http;
    let settled = false;
    const fail = (error: TransportError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = client.request(
      url,
      {
        method: 'GET',
        headers,
        lookup,
        signal,
        agent: false,
        servername: url.protocol === 'https:' ? url.hostname.replace(/^\[|\]$/g, '') : undefined,
      },
      (res) => {
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBodyBytes) {
          res.destroy();
          fail(new TransportError('body_too_large', `Declared body of ${declared} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBodyBytes) {
            res.destroy();
            fail(new TransportError('body_too_large', `Body exceeds ${maxBodyBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', (error) => fail(toTransportError(error, signal)));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const out: Record<string, string | undefined> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on('error', (error) => fail(toTransportError(error, signal)));
    req.end();
  });

function toTransportError(error: Error, signal: AbortSignal): TransportError {
  if (signal.aborted) {
    const reason: unknown = signal.reason;
    const timedOut = reason instanceof Error && reason.name === 'TimeoutError';
    return new TransportError(timedOut ? 'timeout' : 'aborted', error.message);
  }
  return new TransportError('network', error.message);
}
