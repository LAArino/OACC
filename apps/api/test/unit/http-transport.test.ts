// SPDX-License-Identifier: EUPL-1.2
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeHttpTransport, TransportError } from '../../src/ingestion/oeapi/http-transport.js';

describe('nodeHttpTransport', () => {
  let server: Server;
  let port: number;
  const seen: IncomingMessage[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req);
      if (req.url?.startsWith('/big')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('x'.repeat(2048));
        return;
      }
      if (req.url?.startsWith('/declared')) {
        res.writeHead(200, { 'content-length': '999999' });
        res.end();
        return;
      }
      if (req.url?.startsWith('/slow')) return; // never answers
      res.writeHead(200, { 'content-type': 'application/json', 'x-multi': ['a', 'b'] });
      res.end(JSON.stringify({ host: req.headers.host, accept: req.headers.accept }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const request = (path: string, maxBodyBytes = 1024, signal = AbortSignal.timeout(5000)) =>
    nodeHttpTransport({
      // The hostname does not resolve: only the pinned address is used.
      url: new URL(`http://partner.invalid:${port}${path}`),
      address: '127.0.0.1',
      family: 4,
      headers: { accept: 'application/json' },
      signal,
      maxBodyBytes,
    });

  it('connects to the pinned address and keeps the hostname in Host', async () => {
    const response = await request('/ok');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.toString())).toEqual({
      host: `partner.invalid:${port}`,
      accept: 'application/json',
    });
    expect(response.headers['x-multi']).toBe('a, b');
  });

  it('enforces the body limit while streaming and on Content-Length', async () => {
    await expect(request('/big')).rejects.toMatchObject({ kind: 'body_too_large' });
    await expect(request('/declared')).rejects.toBeInstanceOf(TransportError);
    await expect(request('/big', 4096)).resolves.toMatchObject({ status: 200 });
  });

  it('reports timeouts and aborts', async () => {
    await expect(request('/slow', 1024, AbortSignal.timeout(100))).rejects.toMatchObject({
      kind: 'timeout',
    });
    const controller = new AbortController();
    const pending = request('/slow', 1024, controller.signal);
    controller.abort(new Error('shutdown'));
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('reports connection failures as network errors', async () => {
    await expect(
      nodeHttpTransport({
        url: new URL('http://partner.invalid:1/'),
        address: '127.0.0.1',
        family: 4,
        headers: {},
        signal: AbortSignal.timeout(5000),
        maxBodyBytes: 1024,
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});
