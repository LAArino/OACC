// SPDX-License-Identifier: EUPL-1.2
// CSV image_url fetches (decision 27): SSRF guard, limits and the worker job.
import type { CourseImageFetchJob } from '@oecp/schemas';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  type HttpTransport,
  type PinnedRequest,
  type Resolver,
  TransportError,
} from '../../src/ingestion/oeapi/http-transport.js';
import { CourseImageFetchService } from '../../src/media/course-image-fetch.service.js';
import type { CourseImageService } from '../../src/media/course-image.service.js';
import { fetchImage, ImageFetchError } from '../../src/media/image-fetcher.js';
import { configStub } from '../support/config-stub.js';
import { createFakeDb, insertedValues } from '../support/fake-kysely.js';

const PUBLIC: Record<string, string[]> = {
  'img.example.org': ['93.184.216.34'],
  'cdn.example.net': ['2606:4700::6810:84e5'],
};

const resolver =
  (extra: Record<string, string[]> = {}): Resolver =>
  async (host) => {
    const list = { ...PUBLIC, ...extra }[host];
    if (!list) throw new Error('ENOTFOUND');
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };

type Reply = { status: number; headers?: Record<string, string>; body?: Buffer } | Error;

/** Transport answering by URL; records every request. */
function transport(replies: Record<string, Reply>) {
  const requests: PinnedRequest[] = [];
  const fn: HttpTransport = async (req) => {
    requests.push(req);
    const reply = replies[req.url.href];
    if (!reply) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    if (reply instanceof Error) throw reply;
    return {
      status: reply.status,
      headers: reply.headers ?? {},
      body: reply.body ?? Buffer.alloc(0),
    };
  };
  return { fn, requests };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImageFetchError);
    return (error as Error).message;
  }
  throw new Error('fetched');
}

const IMAGE = Buffer.from('image bytes');

describe('fetchImage', () => {
  it('fetches over https from a public address pinned for the connection', async () => {
    const t = transport({ 'https://img.example.org/c1.jpg': { status: 200, body: IMAGE } });
    const body = await fetchImage('https://img.example.org/c1.jpg', {
      transport: t.fn,
      resolve: resolver(),
    });
    expect(body.equals(IMAGE)).toBe(true);
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0]).toMatchObject({
      address: '93.184.216.34',
      family: 4,
      maxBodyBytes: 5 * 1024 * 1024,
    });
    expect(t.requests[0]!.headers['accept']).toContain('image/webp');
  });

  it.each([
    ['http://img.example.org/c1.jpg', 'Only https'],
    ['https://img.example.org:8443/c1.jpg', 'Port 8443'],
    ['https://user:secret@img.example.org/c1.jpg', 'credentials'],
    ['not a url', 'Invalid URL'],
  ])('refuses %s before connecting', async (url, message) => {
    const t = transport({});
    expect(await failure(fetchImage(url, { transport: t.fn, resolve: resolver() }))).toContain(
      message,
    );
    expect(t.requests).toHaveLength(0);
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.9', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'link-local'],
    ['100.64.0.1', 'cgnat'],
    ['::1', 'loopback'],
    ['fd00::1', 'ula'],
    ['fe80::1', 'link-local'],
    ['::ffff:10.0.0.1', 'private'],
  ])('refuses a host resolving to %s (%s)', async (address, cls) => {
    const t = transport({});
    const message = await failure(
      fetchImage('https://evil.example.org/x.png', {
        transport: t.fn,
        resolve: resolver({ 'evil.example.org': [address] }),
      }),
    );
    expect(message).toContain(cls);
    expect(message).not.toContain(address);
    expect(t.requests).toHaveLength(0);
  });

  it('refuses IP literals in private ranges and mixed DNS answers', async () => {
    const t = transport({});
    await failure(fetchImage('https://127.0.0.1/x.png', { transport: t.fn, resolve: resolver() }));
    await failure(fetchImage('https://[::1]/x.png', { transport: t.fn, resolve: resolver() }));
    await failure(
      fetchImage('https://mixed.example.org/x.png', {
        transport: t.fn,
        resolve: resolver({ 'mixed.example.org': ['93.184.216.34', '10.0.0.5'] }),
      }),
    );
    expect(t.requests).toHaveLength(0);
  });

  it('admits private addresses with allowInsecure (development), never http', async () => {
    const t = transport({ 'https://mock.local/x.png': { status: 200, body: IMAGE } });
    const resolve = resolver({ 'mock.local': ['172.18.0.5'] });
    await expect(
      fetchImage('https://mock.local/x.png', { transport: t.fn, resolve, allowInsecure: true }),
    ).resolves.toBeInstanceOf(Buffer);
    await failure(
      fetchImage('http://mock.local/x.png', { transport: t.fn, resolve, allowInsecure: true }),
    );
    // Link-local (cloud metadata) stays refused.
    await failure(
      fetchImage('https://meta.local/x.png', {
        transport: t.fn,
        resolve: resolver({ 'meta.local': ['169.254.169.254'] }),
        allowInsecure: true,
      }),
    );
  });

  it('follows up to 3 https redirects, re-checking every host', async () => {
    const t = transport({
      'https://img.example.org/a': { status: 301, headers: { location: '/b' } },
      'https://img.example.org/b': {
        status: 302,
        headers: { location: 'https://cdn.example.net/c' },
      },
      'https://cdn.example.net/c': { status: 307, headers: { location: '/d' } },
      'https://cdn.example.net/d': { status: 200, body: IMAGE },
    });
    const body = await fetchImage('https://img.example.org/a', {
      transport: t.fn,
      resolve: resolver(),
    });
    expect(body.equals(IMAGE)).toBe(true);
    expect(t.requests.map((r) => [r.url.href, r.address])).toEqual([
      ['https://img.example.org/a', '93.184.216.34'],
      ['https://img.example.org/b', '93.184.216.34'],
      ['https://cdn.example.net/c', '2606:4700::6810:84e5'],
      ['https://cdn.example.net/d', '2606:4700::6810:84e5'],
    ]);
  });

  it('refuses a fourth redirect, a redirect to http and a redirect to a private host', async () => {
    const loop = transport({
      'https://img.example.org/1': { status: 302, headers: { location: '/2' } },
      'https://img.example.org/2': { status: 302, headers: { location: '/3' } },
      'https://img.example.org/3': { status: 302, headers: { location: '/4' } },
      'https://img.example.org/4': { status: 302, headers: { location: '/5' } },
    });
    expect(
      await failure(
        fetchImage('https://img.example.org/1', { transport: loop.fn, resolve: resolver() }),
      ),
    ).toContain('more than 3 redirects');
    const downgrade = transport({
      'https://img.example.org/1': {
        status: 301,
        headers: { location: 'http://img.example.org/1' },
      },
    });
    expect(
      await failure(
        fetchImage('https://img.example.org/1', { transport: downgrade.fn, resolve: resolver() }),
      ),
    ).toContain('non-https');
    const inward = transport({
      'https://img.example.org/1': {
        status: 302,
        headers: { location: 'https://internal.example.org/admin' },
      },
    });
    await failure(
      fetchImage('https://img.example.org/1', {
        transport: inward.fn,
        resolve: resolver({ 'internal.example.org': ['10.0.0.8'] }),
      }),
    );
    expect(inward.requests).toHaveLength(1);
  });

  it('reports size limits, timeouts, HTTP errors and empty bodies', async () => {
    const t = transport({
      'https://img.example.org/big': new TransportError('body_too_large', 'too big'),
      'https://img.example.org/slow': new TransportError('timeout', 'timeout'),
      'https://img.example.org/gone': { status: 410 },
      'https://img.example.org/empty': { status: 200 },
    });
    const options = { transport: t.fn, resolve: resolver() };
    expect(await failure(fetchImage('https://img.example.org/big', options))).toContain(
      'larger than 5242880 bytes',
    );
    expect(await failure(fetchImage('https://img.example.org/slow', options))).toContain('20 s');
    expect(await failure(fetchImage('https://img.example.org/gone', options))).toContain(
      'HTTP 410',
    );
    expect(await failure(fetchImage('https://img.example.org/empty', options))).toContain('empty');
  });

  it('never shows the query string (it may carry a token)', async () => {
    const t = transport({});
    const message = await failure(
      fetchImage('https://img.example.org/x.png?token=s3cr3t', {
        transport: t.fn,
        resolve: resolver(),
      }),
    );
    expect(message).not.toContain('s3cr3t');
  });
});

describe('CourseImageFetchService', () => {
  const COURSE = '0c000000-0000-4000-8000-000000000001';
  const RUN = '0d000000-0000-4000-8000-000000000002';
  const job: CourseImageFetchJob = {
    courseId: COURSE,
    syncRunId: RUN,
    extId: 'AUR-1',
    row: 3,
    url: 'https://img.example.org/c1.png',
    alt: { en: 'Students in a lab' },
    decorative: false,
    credit: 'Photo: A. Example',
  };

  async function service(
    replies: Record<string, Reply>,
    current: { image_source_url: string | null; deleted_at: Date | null } | null = {
      image_source_url: null,
      deleted_at: null,
    },
  ) {
    const fake = createFakeDb((q) =>
      /^select .* from "courses"/.test(q.sql) && current ? [current] : [],
    );
    const set = vi.fn(async () => ({}) as never);
    const images = { set } as unknown as CourseImageService;
    const svc = new CourseImageFetchService(
      fake.db,
      images,
      configStub({ OECP_ALLOW_INSECURE_PARTNER_HTTP: false }),
      { transport: transport(replies).fn, resolve: resolver() },
    );
    return { svc, set, fake };
  }

  it('stores the fetched image with the row metadata, by system:csv', async () => {
    const body = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#123' },
    })
      .png()
      .toBuffer();
    const { svc, set } = await service({ [job.url]: { status: 200, body } });
    expect(await svc.run(job)).toBe('set');
    expect(set).toHaveBeenCalledTimes(1);
    const [courseId, image, meta, actor, audit] = set.mock.calls[0] as unknown as [
      string,
      { width: number; height: number; key: string },
      unknown,
      unknown,
      unknown,
    ];
    expect(courseId).toBe(COURSE);
    expect(image).toMatchObject({ width: 900, height: 600 });
    expect(meta).toEqual({
      alt: { en: 'Students in a lab' },
      decorative: false,
      credit: 'Photo: A. Example',
      sourceUrl: job.url,
    });
    expect(actor).toEqual({ sub: 'system:csv', orgId: null });
    expect(audit).toEqual({ channel: 'csv', sync_run_id: RUN });
  });

  it('does nothing when the course already has an image from this URL, or is deleted', async () => {
    const same = await service({}, { image_source_url: job.url, deleted_at: null });
    expect(await same.svc.run(job)).toBe('unchanged');
    const deleted = await service({}, { image_source_url: null, deleted_at: new Date() });
    expect(await deleted.svc.run(job)).toBe('skipped');
    const gone = await service({}, null);
    expect(await gone.svc.run(job)).toBe('skipped');
    expect(same.set).not.toHaveBeenCalled();
  });

  it.each([
    ['an unreachable URL', { status: 404 } as Reply, 'HTTP 404'],
    [
      'content that is not an image',
      { status: 200, body: Buffer.from('<html>') } as Reply,
      'oecp.media.unsupported_type',
    ],
  ])(
    'records a warning on the upload run for %s; the course is unchanged',
    async (_n, reply, detail) => {
      const { svc, set, fake } = await service({ [job.url]: reply });
      expect(await svc.run(job)).toBe('failed');
      expect(set).not.toHaveBeenCalled();
      const insert = fake.queries.find((q) => q.sql.startsWith('insert into "sync_errors"'));
      expect(insert).toBeDefined();
      const values = insertedValues(insert!);
      expect(values).toMatchObject({
        sync_run_id: RUN,
        severity: 'warning',
        code: 'oecp.media.fetch_failed',
        entity_type: 'course',
        ext_id: 'AUR-1',
        file: 'courses',
        row_number: 3,
        column_name: 'image_url',
      });
      expect(String(values['message'])).toContain(detail);
    },
  );

  it('records a refused private address as a warning too', async () => {
    const fake = createFakeDb((q) =>
      /^select .* from "courses"/.test(q.sql) ? [{ image_source_url: null, deleted_at: null }] : [],
    );
    const svc = new CourseImageFetchService(
      fake.db,
      { set: vi.fn() } as unknown as CourseImageService,
      configStub({ OECP_ALLOW_INSECURE_PARTNER_HTTP: false }),
      { transport: transport({}).fn, resolve: resolver({ 'img.example.org': ['10.0.0.1'] }) },
    );
    expect(await svc.run(job)).toBe('failed');
    expect(fake.queries.some((q) => q.sql.startsWith('insert into "sync_errors"'))).toBe(true);
  });
});
