// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it, vi } from 'vitest';
import {
  type HttpTransport,
  type PinnedRequest,
  TransportError,
  type TransportResponse,
} from '../../src/ingestion/oeapi/http-transport.js';
import { classifyAddress, isAllowedAddress } from '../../src/ingestion/oeapi/net-guard.js';
import {
  type OeapiClientConfig,
  type OeapiClientDeps,
  OeapiError,
  OeapiV5Client,
  parseRetryAfter,
} from '../../src/ingestion/oeapi/oeapi-v5.client.js';
import { TokenBucket } from '../../src/ingestion/oeapi/rate-limiter.js';
import {
  createFakeOeapi,
  MOCK_BASE_URL,
  MOCK_HOST,
  MOCK_PASSWORD,
  MOCK_USER,
  PUBLIC_ADDRESS,
} from '../support/fake-oeapi.js';

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): TransportResponse => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: Buffer.from(JSON.stringify(body)),
});

const config = (patch: Partial<OeapiClientConfig> = {}): OeapiClientConfig => ({
  baseUrl: MOCK_BASE_URL,
  allowedHost: MOCK_HOST,
  auth: { scheme: 'basic', username: MOCK_USER, password: MOCK_PASSWORD },
  consumer: 'eduxchange',
  pageSize: 2,
  maxRequestsPerSecond: 1000,
  allowInsecure: false,
  ...patch,
});

function scripted(responses: (TransportResponse | Error)[]) {
  const requests: PinnedRequest[] = [];
  const transport: HttpTransport = async (request) => {
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return { transport, requests };
}

const sleeps: number[] = [];
const deps = (patch: OeapiClientDeps = {}): OeapiClientDeps => ({
  resolve: async () => [{ address: PUBLIC_ADDRESS, family: 4 }],
  sleep: async (ms) => void sleeps.push(ms),
  random: () => 0.5,
  ...patch,
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OeapiError) return error.code;
    throw error;
  }
  return 'resolved';
}

describe('net guard (spec §6.2.6)', () => {
  it.each([
    ['93.184.216.34', 'public'],
    ['2a00:1450:4001:80b::200e', 'public'],
    ['127.0.0.1', 'loopback'],
    ['::1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.20.0.5', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'cgnat'],
    ['fd00::1', 'ula'],
    ['169.254.169.254', 'link_local'],
    ['fe80::1', 'link_local'],
    ['224.0.0.1', 'multicast'],
    ['ff02::1', 'multicast'],
    ['0.0.0.0', 'unspecified'],
    ['::', 'unspecified'],
    ['255.255.255.255', 'reserved'],
    ['192.0.2.10', 'reserved'],
    ['2001:db8::1', 'reserved'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:7f00:1', 'loopback'],
    ['64:ff9b::a9fe:a9fe', 'link_local'],
    ['2002:c0a8:0101::1', 'private'],
    ['not-an-ip', 'invalid'],
  ])('%s is %s', (address, cls) => {
    expect(classifyAddress(address)).toBe(cls);
  });

  it('relaxes only loopback, private, CGNAT and ULA under the insecure flag', () => {
    for (const a of ['127.0.0.1', '10.0.0.1', '172.18.0.3', '100.64.1.1', 'fd12::1']) {
      expect(isAllowedAddress(a, false), a).toBe(false);
      expect(isAllowedAddress(a, true), a).toBe(true);
    }
    for (const a of ['169.254.169.254', 'fe80::1', '224.0.0.1', '0.0.0.0', '240.0.0.1']) {
      expect(isAllowedAddress(a, true), a).toBe(false);
    }
    expect(isAllowedAddress(PUBLIC_ADDRESS, false)).toBe(true);
  });
});

describe('OeapiV5Client', () => {
  it('sends Accept, Basic auth and consumer on every request, pinned to the resolved address', async () => {
    const fake = createFakeOeapi();
    const client = new OeapiV5Client(
      config(),
      deps({ transport: fake.transport, resolve: fake.resolve }),
    );
    const { body } = await client.getJson('/');
    expect(body).toMatchObject({ contactEmail: 'oeapi@uibk.example' });
    const [request] = fake.requests;
    expect(request?.url.href).toBe(`${MOCK_BASE_URL}/?consumer=eduxchange`);
    expect(request?.address).toBe(PUBLIC_ADDRESS);
    expect(request?.headers['accept']).toBe('application/json');
    expect(request?.headers['authorization']).toBe(
      `Basic ${Buffer.from('oecp:oecp-mock-secret').toString('base64')}`,
    );
    expect(request?.maxBodyBytes).toBe(20 * 1024 * 1024);
  });

  it('pages with pageNumber until hasNextPage is false', async () => {
    const fake = createFakeOeapi();
    const client = new OeapiV5Client(
      config(),
      deps({ transport: fake.transport, resolve: fake.resolve }),
    );
    const ids: string[] = [];
    for await (const page of client.pages('/courses')) {
      for (const item of page.envelope.items) ids.push((item as { courseId: string }).courseId);
    }
    expect(ids).toHaveLength(7);
    expect(fake.requests.map((r) => r.url.searchParams.get('pageNumber'))).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(fake.requests.every((r) => r.url.searchParams.get('pageSize') === '2')).toBe(true);
    expect(fake.requests.every((r) => r.url.searchParams.get('consumer') === 'eduxchange')).toBe(
      true,
    );
  });

  it('stops at the page cap', async () => {
    const endless: HttpTransport = async (r) =>
      json({
        pageSize: 1,
        pageNumber: Number(r.url.searchParams.get('pageNumber')),
        hasPreviousPage: false,
        hasNextPage: true,
        items: [{}],
      });
    const client = new OeapiV5Client(config(), deps({ transport: endless, maxPages: 3 }));
    let pages = 0;
    const iterate = async () => {
      for await (const _ of client.pages('/courses')) pages += 1;
    };
    expect(await codeOf(iterate())).toBe('oecp.oeapi.page_cap_reached');
    expect(pages).toBe(3);
  });

  it('refuses malformed envelopes and non-JSON bodies', async () => {
    const bad = scripted([json({ items: [] })]);
    const client = new OeapiV5Client(config(), deps({ transport: bad.transport }));
    const iterate = async () => {
      for await (const _ of client.pages('/courses')) void _;
    };
    expect(await codeOf(iterate())).toBe('oecp.oeapi.invalid_payload');
    const html = scripted([{ status: 200, headers: {}, body: Buffer.from('<html>') }]);
    expect(
      await codeOf(new OeapiV5Client(config(), deps({ transport: html.transport })).getJson('/')),
    ).toBe('oecp.oeapi.invalid_payload');
  });

  it('retries 429 and 5xx with exponential backoff, honouring Retry-After', async () => {
    sleeps.length = 0;
    const s = scripted([
      json({}, 503),
      json({}, 429, { 'retry-after': '7' }),
      json({}, 500),
      json({ ok: true }),
    ]);
    const client = new OeapiV5Client(config(), deps({ transport: s.transport }));
    await expect(client.getJson('/')).resolves.toMatchObject({ body: { ok: true } });
    // attempt 0: 1000 * 2^0 → [500, 1000], random 0.5 → 750; Retry-After 7 s; attempt 2 → 3000.
    expect(sleeps).toEqual([750, 7000, 3000]);
  });

  it('gives up after 5 retries', async () => {
    const s = scripted(Array.from({ length: 6 }, () => json({}, 502)));
    const client = new OeapiV5Client(config(), deps({ transport: s.transport }));
    const error = await client.getJson('/').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OeapiError);
    expect(error).toMatchObject({ code: 'oecp.oeapi.http_error', status: 502 });
    expect(s.requests).toHaveLength(6);
  });

  it('retries network errors and reports an unreachable endpoint', async () => {
    const s = scripted(
      Array.from({ length: 6 }, () => new TransportError('network', 'ECONNREFUSED')),
    );
    const client = new OeapiV5Client(config(), deps({ transport: s.transport }));
    expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.unreachable');
    expect(s.requests).toHaveLength(6);
  });

  it('maps 401/403 to unauthorized without retrying, other 4xx to http_error', async () => {
    const s = scripted([json({}, 401), json({}, 404)]);
    const client = new OeapiV5Client(config(), deps({ transport: s.transport }));
    expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.unauthorized');
    expect(await codeOf(client.getJson('/x'))).toBe('oecp.oeapi.http_error');
    expect(s.requests).toHaveLength(2);
  });

  it('times out after 30 s per request (retried)', async () => {
    const s = scripted(Array.from({ length: 6 }, () => new TransportError('timeout', 'aborted')));
    const client = new OeapiV5Client(config(), deps({ transport: s.transport }));
    expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.timeout');
    expect(s.requests).toHaveLength(6);
    const timeoutSignal = vi.spyOn(AbortSignal, 'timeout');
    const once = scripted([json({})]);
    await new OeapiV5Client(config(), deps({ transport: once.transport })).getJson('/');
    expect(timeoutSignal).toHaveBeenCalledWith(30_000);
    timeoutSignal.mockRestore();
  });

  it('reports bodies over 20 MB', async () => {
    const s = scripted([new TransportError('body_too_large', 'too big')]);
    const client = new OeapiV5Client(config(), deps({ transport: s.transport }));
    expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.body_too_large');
  });

  describe('SSRF protection', () => {
    it('refuses http and non-443 ports unless the insecure flag is set', async () => {
      const s = scripted([json({}), json({})]);
      for (const baseUrl of ['http://oeapi.uibk.example', 'https://oeapi.uibk.example:8443']) {
        const host = new URL(baseUrl).host;
        const client = new OeapiV5Client(
          config({ baseUrl, allowedHost: host }),
          deps({ transport: s.transport }),
        );
        expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.insecure_url');
      }
      expect(s.requests).toHaveLength(0);
      const dev = new OeapiV5Client(
        config({
          baseUrl: 'http://oeapi-mock:8090',
          allowedHost: 'oeapi-mock:8090',
          allowInsecure: true,
        }),
        deps({
          transport: s.transport,
          resolve: async () => [{ address: '172.18.0.7', family: 4 }],
        }),
      );
      await expect(dev.getJson('/')).resolves.toBeDefined();
      expect(s.requests[0]?.address).toBe('172.18.0.7');
    });

    it('requires the approved host', async () => {
      const s = scripted([json({})]);
      const unapproved = new OeapiV5Client(
        config({ allowedHost: null }),
        deps({ transport: s.transport }),
      );
      expect(await codeOf(unapproved.getJson('/'))).toBe('oecp.oeapi.host_not_approved');
      const other = new OeapiV5Client(
        config({ allowedHost: 'other.example' }),
        deps({ transport: s.transport }),
      );
      expect(await codeOf(other.getJson('/'))).toBe('oecp.oeapi.host_not_approved');
      expect(s.requests).toHaveLength(0);
    });

    it('refuses hosts resolving to non-public addresses, even partly', async () => {
      const s = scripted([json({})]);
      for (const addresses of [
        [{ address: '10.0.0.5', family: 4 as const }],
        [{ address: '169.254.169.254', family: 4 as const }],
        [
          { address: PUBLIC_ADDRESS, family: 4 as const },
          { address: '127.0.0.1', family: 4 as const },
        ],
      ]) {
        const client = new OeapiV5Client(
          config(),
          deps({ transport: s.transport, resolve: async () => addresses }),
        );
        expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.address_refused');
      }
      const metadata = new OeapiV5Client(
        config({ allowInsecure: true }),
        deps({
          transport: s.transport,
          resolve: async () => [{ address: '169.254.169.254', family: 4 }],
        }),
      );
      expect(await codeOf(metadata.getJson('/'))).toBe('oecp.oeapi.address_refused');
      expect(s.requests).toHaveLength(0);
    });

    it('refuses IP-literal URLs in private ranges', async () => {
      const s = scripted([json({})]);
      const client = new OeapiV5Client(
        config({ baseUrl: 'https://10.0.0.1/v5', allowedHost: '10.0.0.1' }),
        deps({ transport: s.transport }),
      );
      expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.address_refused');
    });

    it('resolves DNS for every request (no cached rebinding)', async () => {
      const resolve = vi
        .fn()
        .mockResolvedValueOnce([{ address: PUBLIC_ADDRESS, family: 4 }])
        .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
      const s = scripted([json({}), json({})]);
      const client = new OeapiV5Client(config(), deps({ transport: s.transport, resolve }));
      await client.getJson('/');
      expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.address_refused');
      expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('follows at most 3 redirects within the same origin', async () => {
      const redirect = (location: string) => ({
        status: 302,
        headers: { location },
        body: Buffer.alloc(0),
      });
      const ok = scripted([redirect('/oeapi/v5/a'), redirect('b'), json({ done: true })]);
      const client = new OeapiV5Client(config(), deps({ transport: ok.transport }));
      await expect(client.getJson('/')).resolves.toMatchObject({ body: { done: true } });
      expect(ok.requests.map((r) => r.url.pathname)).toEqual([
        '/oeapi/v5/',
        '/oeapi/v5/a',
        '/oeapi/v5/b',
      ]);
      expect(ok.requests.every((r) => r.url.searchParams.get('consumer') === 'eduxchange')).toBe(
        true,
      );

      const loop = scripted(Array.from({ length: 5 }, () => redirect('/oeapi/v5/again')));
      expect(
        await codeOf(new OeapiV5Client(config(), deps({ transport: loop.transport })).getJson('/')),
      ).toBe('oecp.oeapi.redirect_refused');
      expect(loop.requests).toHaveLength(4);

      for (const location of [
        'https://evil.example/oeapi',
        `http://${MOCK_HOST}/oeapi/v5`,
        `https://${MOCK_HOST}:8443/oeapi/v5`,
      ]) {
        const s = scripted([redirect(location)]);
        expect(
          await codeOf(new OeapiV5Client(config(), deps({ transport: s.transport })).getJson('/')),
          location,
        ).toBe('oecp.oeapi.redirect_refused');
      }
    });
  });

  it('builds bearer, api-key and SURFeduhub headers', async () => {
    const s = scripted([json({}), json({}), json({})]);
    await new OeapiV5Client(
      config({ auth: { scheme: 'bearer', token: 't0k' } }),
      deps({ transport: s.transport }),
    ).getJson('/');
    await new OeapiV5Client(
      config({ auth: { scheme: 'api_key_header', headerName: 'X-Api-Key', value: 'k3y' } }),
      deps({ transport: s.transport }),
    ).getJson('/');
    await new OeapiV5Client(
      config({
        baseUrl: 'https://gateway.surfeduhub.nl',
        allowedHost: 'gateway.surfeduhub.nl',
        headers: { 'X-Route': 'endpoint=uibk.ac.at' },
      }),
      deps({ transport: s.transport }),
    ).getJson('/courses', { pageSize: 1 });
    expect(s.requests[0]?.headers['authorization']).toBe('Bearer t0k');
    expect(s.requests[1]?.headers['X-Api-Key']).toBe('k3y');
    expect(s.requests[1]?.headers['authorization']).toBeUndefined();
    expect(s.requests[2]?.headers['X-Route']).toBe('endpoint=uibk.ac.at');
    expect(s.requests[2]?.url.href).toBe(
      'https://gateway.surfeduhub.nl/courses?pageSize=1&consumer=eduxchange',
    );
  });

  it('refuses credentials with control characters (header injection)', () => {
    expect(
      () =>
        new OeapiV5Client(config({ auth: { scheme: 'bearer', token: 'a\r\nX-Evil: 1' } }), deps()),
    ).toThrow(OeapiError);
  });

  it('stops when the run is aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('2 h'));
    const s = scripted([json({})]);
    const client = new OeapiV5Client(
      config({ signal: controller.signal }),
      deps({ transport: s.transport }),
    );
    expect(await codeOf(client.getJson('/'))).toBe('oecp.oeapi.run_timeout');
    expect(s.requests).toHaveLength(0);
  });
});

describe('Retry-After and token bucket', () => {
  it('parses delay-seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Wed, 14 Oct 2026 12:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
  });

  it('limits requests to the configured rate', async () => {
    let clock = 0;
    const waits: number[] = [];
    const bucket = new TokenBucket(
      2,
      () => clock,
      async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    );
    for (let i = 0; i < 5; i += 1) await bucket.acquire();
    // Capacity 2 → two immediate tokens, then one every 500 ms.
    expect(waits).toEqual([500, 500, 500]);
    expect(clock).toBe(1500);
  });

  it('handles fractional rates', async () => {
    let clock = 0;
    const bucket = new TokenBucket(
      0.5,
      () => clock,
      async (ms) => {
        clock += ms;
      },
    );
    await bucket.acquire();
    await bucket.acquire();
    expect(clock).toBe(2000);
  });
});
