// SPDX-License-Identifier: EUPL-1.2
import { createServer, type IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  clientAddressHash,
  customProps,
  serializeRequest,
  serializeResponse,
} from '../../src/logging/logger.module.js';

const ADDRESS = '203.0.113.7';
const salt = Buffer.alloc(32, 1);

/** Runs one request through pino-http with the OECP options; returns the log lines. */
async function logged(
  logClientAddresses: boolean,
  headers: Record<string, string>,
  path = '/api/public/v1/courses?q=ml',
  admin?: { sub: string },
): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  const middleware = pinoHttp({
    logger: pino({ level: 'info' }, stream),
    serializers: { req: serializeRequest, res: serializeResponse },
    customProps: customProps(logClientAddresses, salt),
  });
  const server = createServer((req, res) => {
    middleware(req, res);
    if (admin) Object.assign(req, { admin });
    res.end('ok');
  });
  await request(server).get(path).set(headers).expect(200);
  return lines;
}

const HEADERS = {
  'X-Forwarded-For': `${ADDRESS}, 10.0.0.2`,
  'X-Real-IP': ADDRESS,
  'User-Agent': 'Mozilla/5.0 (test)',
  Authorization: 'Bearer secret-token',
  Cookie: 'session=secret',
};

describe('request logging (spec §10, GDPR minimisation)', () => {
  it('logs no address, user agent or credential of public requests by default', async () => {
    const [line] = await logged(false, HEADERS);
    const text = JSON.stringify(line);
    expect(line).toMatchObject({
      req: { method: 'GET', url: '/api/public/v1/courses?q=ml' },
      res: { statusCode: 200 },
    });
    for (const secret of [ADDRESS, 'Mozilla', 'secret-token', 'session=secret', '127.0.0.1']) {
      expect(text).not.toContain(secret);
    }
    expect(line).not.toHaveProperty('client');
    expect(line).not.toHaveProperty('sub');
    expect(Object.keys(line?.['req'] as object).sort()).toEqual(['id', 'method', 'url']);
  });

  it('adds a salted hash of the client address only when enabled, never the address', async () => {
    const [line] = await logged(true, HEADERS);
    const expected = clientAddressHash(
      { headers: { 'x-forwarded-for': ADDRESS }, socket: {} } as unknown as IncomingMessage,
      salt,
    );
    expect(line?.['client']).toBe(expected);
    expect(String(line?.['client'])).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(line)).not.toContain(ADDRESS);
  });

  it('adds the sub of authenticated admin requests', async () => {
    const [line] = await logged(false, HEADERS, '/api/admin/v1/me', { sub: 'admin-sub-1' });
    expect(line?.['sub']).toBe('admin-sub-1');
  });

  it('hashes with the salt: other salt, other value; falls back to the socket address', () => {
    const req = (forwarded?: string) =>
      ({
        headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
        socket: { remoteAddress: '198.51.100.1' },
      }) as unknown as IncomingMessage;
    expect(clientAddressHash(req(ADDRESS), salt)).not.toBe(
      clientAddressHash(req(ADDRESS), Buffer.alloc(32, 2)),
    );
    expect(clientAddressHash(req(), salt)).toBe(clientAddressHash(req('198.51.100.1'), salt));
  });
});
