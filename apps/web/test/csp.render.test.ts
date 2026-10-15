// SPDX-License-Identifier: EUPL-1.2
// End to end through a production build: every HTML response carries a
// Content-Security-Policy with a fresh nonce, and every script, style and link tag
// the server renders carries that nonce (server/plugins/csp.ts). The public API is
// answered by the catalogue fixture server (test/fixtures/server.mjs).
import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetch, setup } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE_PORT = 3917;
const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;
const AUTH_ORIGIN = 'https://auth.example.eu';
const COURSE_ID = '6f1d2c3b-0000-4000-8000-000000000001';

let fixture: ChildProcess | undefined;

beforeAll(async () => {
  fixture = spawn(
    process.execPath,
    [fileURLToPath(new URL('./fixtures/server.mjs', import.meta.url))],
    { env: { ...process.env, FIXTURE_PORT: String(FIXTURE_PORT) }, stdio: 'ignore' },
  );
  for (let i = 0; i < 50; i++) {
    const up = await globalThis
      .fetch(`${FIXTURE_ORIGIN}/api/public/v1/reference`)
      .then((r) => r.ok)
      .catch(() => false);
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('catalogue fixture server did not start');
});

afterAll(() => {
  fixture?.kill();
});

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  server: true,
  build: true,
  setupTimeout: 300_000,
  env: {
    NUXT_PUBLIC_API_BASE: FIXTURE_ORIGIN,
    NUXT_PUBLIC_OIDC_AUTHORITY: `${AUTH_ORIGIN}/realms/oecp`,
  },
});

interface Page {
  policy: string;
  nonce: string;
  html: string;
}

async function page(path: string): Promise<Page> {
  const response = await fetch(path, { headers: { accept: 'text/html' } });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/^text\/html/);
  const policy = response.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/]{22}==)'/.exec(policy)?.[1] ?? '';
  expect(nonce, `nonce in the policy of ${path}`).not.toBe('');
  return { policy, nonce, html: await response.text() };
}

/** Start tags of `name` in a document (the test pages have no such text in content). */
function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
}

function expectAllNonced({ html, nonce }: Page) {
  const scripts = tags(html, 'script');
  expect(scripts.length).toBeGreaterThan(2);
  for (const tag of [...scripts, ...tags(html, 'style'), ...tags(html, 'link')]) {
    expect(tag).toContain(` nonce="${nonce}"`);
  }
  // Exactly one nonce per document: no stale or foreign value.
  const nonces = new Set([...html.matchAll(/ nonce="([^"]*)"/g)].map((m) => m[1]));
  expect([...nonces]).toEqual([nonce]);
}

describe('Content-Security-Policy on rendered pages', () => {
  it('sends the strict policy on the home page', async () => {
    const home = await page('/en');
    expect(home.policy).toBe(
      [
        "default-src 'self'",
        `script-src 'nonce-${home.nonce}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${home.nonce}'`,
        "img-src 'self' data: https:",
        "font-src 'self'",
        `connect-src 'self' ${FIXTURE_ORIGIN} ${AUTH_ORIGIN}`,
        `frame-src 'self' ${AUTH_ORIGIN}`,
        "worker-src 'self'",
        `form-action 'self' ${AUTH_ORIGIN}`,
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join('; '),
    );
    expectAllNonced(home);
    // Nuxt's import map, entry module and config script all run under the nonce.
    expect(home.html).toMatch(new RegExp(`<script nonce="[^"]+" type="importmap">`));
    expect(home.html).toMatch(/<script nonce="[^"]+" type="module" src="\/_nuxt\//);
  });

  it('draws a fresh nonce for every response', async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 3; i++) nonces.add((await page('/en/courses')).nonce);
    expect(nonces.size).toBe(3);
  });

  it('puts the nonce on the course page scripts, JSON-LD included', async () => {
    const course = await page(`/en/courses/${COURSE_ID}`);
    expectAllNonced(course);
    expect(course.html).toContain(`<script nonce="${course.nonce}" type="application/ld+json"`);
  });

  it('covers the client-rendered admin shell and the silent-callback page', async () => {
    expectAllNonced(await page('/en/admin'));
    expectAllNonced(await page('/en/admin/silent-callback'));
  });

  it('sends no policy on non-HTML responses', async () => {
    const robots = await fetch('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.headers.get('content-security-policy')).toBeNull();
  });
});
