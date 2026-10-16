// SPDX-License-Identifier: EUPL-1.2
// Self-hosted OpenAPI viewer: /api/{public,admin}/v1/docs and the vendored Redoc
// bundle under /api/docs-assets/ (static/openapi/).
import 'reflect-metadata';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import {
  buildApiDocs,
  DOCS_ASSET_CACHE,
  DOCS_STATIC_DIR,
  REDOC_FILE,
  REDOC_SHA256,
  REDOC_VERSION,
  redocScriptUrl,
} from '../../src/openapi/docs.js';
import { OpenApiModule } from '../../src/openapi/openapi.module.js';

const APIS = ['public', 'admin'] as const;
const ASSET = `/api/docs-assets/${REDOC_VERSION}/${REDOC_FILE}`;

describe('OpenAPI viewer', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OpenApiModule],
      providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(APIS)('GET /api/%s/v1/docs: HTML page rendering the API document', async (api) => {
    const response = await request(app.getHttpServer()).get(`/api/${api}/v1/docs`).expect(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
    expect(response.headers['set-cookie']).toBeUndefined();
    const html = response.text;
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(`<redoc spec-url="/api/${api}/v1/openapi.json"`);
    // The bundle is the only script, from the API origin; no inline script.
    expect(html.match(/<script\b[^>]*>/g)).toEqual([`<script src="${ASSET}">`]);
    expect(html).toContain('<script src="/api/docs-assets/2.5.4/redoc.standalone.js"></script>');
    expect(html).not.toMatch(/https?:\/\//);
    // System fonts only (Redoc's defaults name Roboto and Montserrat).
    expect(html).toContain('system-ui');
    expect(html.indexOf('<redoc ')).toBeLessThan(html.indexOf('<script '));
  });

  it('GET the bundle: immutable, ETag, the Redocly CDN logo replaced', async () => {
    const response = await request(app.getHttpServer())
      .get(ASSET)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(response.headers['cache-control']).toBe(DOCS_ASSET_CACHE);
    const body = (response.body as Buffer).toString('utf8');
    const upstream = readFileSync(new URL(REDOC_FILE, DOCS_STATIC_DIR), 'utf8');
    // The upstream file with one change: the Redocly logo URL.
    expect(body).toBe(upstream.replace('"https://cdn.redoc.ly/redoc/logo-mini.svg"', '"data:,"'));
    expect(body).not.toContain('cdn.redoc.ly');
    const etag = response.headers['etag'] as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    await request(app.getHttpServer()).get(ASSET).set('If-None-Match', etag).expect(304);
    const head = await request(app.getHttpServer()).head(ASSET).expect(200);
    expect(head.headers['etag']).toBe(etag);
  });

  it.each([
    `/api/docs-assets/${REDOC_VERSION}/redoc.js`,
    `/api/docs-assets/${REDOC_VERSION}/redoc.standalone.js.map`,
    `/api/docs-assets/${REDOC_VERSION}/LICENSE`,
    `/api/docs-assets/${REDOC_VERSION}/README.md`,
    `/api/docs-assets/0.0.0/${REDOC_FILE}`,
    `/api/docs-assets/${REDOC_VERSION}/..%2F..%2Fpackage.json`,
    `/api/docs-assets/${REDOC_VERSION}/`,
    `/api/docs-assets/${REDOC_VERSION}`,
    '/api/docs-assets/',
  ])('GET %s: 404, no other file and no listing', async (path) => {
    const response = await request(app.getHttpServer()).get(path).expect(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.headers['cache-control']).toBeUndefined();
  });

  it('the README of the vendored bundle records the version and SHA-256 checked at start-up', () => {
    const readme = readFileSync(new URL('README.md', DOCS_STATIC_DIR), 'utf8');
    expect(readme).toContain(`| Version | ${REDOC_VERSION} `);
    expect(readme).toContain(`| SHA-256 | \`${REDOC_SHA256}\``);
    expect(redocScriptUrl()).toBe(ASSET);
  });

  it('refuses to start with a bundle other than the pinned one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oecp-redoc-'));
    try {
      cpSync(new URL(REDOC_FILE, DOCS_STATIC_DIR), join(dir, REDOC_FILE));
      const staticDir = pathToFileURL(`${dir}/`);
      expect(buildApiDocs(staticDir).assets.size).toBe(1);
      writeFileSync(join(dir, REDOC_FILE), '/* other */', { flag: 'a' });
      expect(() => buildApiDocs(staticDir)).toThrow(/SHA-256/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
