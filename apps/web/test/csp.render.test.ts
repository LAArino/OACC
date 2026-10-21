// SPDX-License-Identifier: EUPL-1.2
// End to end through a production build: every HTML response carries a
// Content-Security-Policy with a fresh nonce, and every script, style and link tag
// the server renders carries that nonce (server/plugins/csp.ts). The public API is
// answered by the catalogue fixture server (test/fixtures/server.mjs).
// The same build also serves the deployment branding files (/branding/<name>,
// server/middleware/branding.ts) from a temporary directory.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch, setup } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE_PORT = 3917;
const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;
const AUTH_ORIGIN = 'https://auth.example.eu';
const COURSE_ID = '6f1d2c3b-0000-4000-8000-000000000001';

let fixture: ChildProcess | undefined;

// Branding directory: a stand-in "image" (the middleware never inspects content),
// the logo of partner `urv` (slug of the fixture courses), a hidden file, a file
// of another type and a sub-directory that must not be served or listed.
const BRANDING_DIR = mkdtempSync(join(tmpdir(), 'oecp-branding-'));
const HERO_BYTES = 'stand-in image bytes';
writeFileSync(join(BRANDING_DIR, 'hero.png'), HERO_BYTES);
writeFileSync(join(BRANDING_DIR, 'partner-urv.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
// The privacy notice (English only); the accessibility statement is left out on purpose.
const PRIVACY_MD = '# Privacy notice of the test alliance\n\n- Data: none\n\n<script>x</script>\n';
writeFileSync(join(BRANDING_DIR, 'privacy.en.md'), PRIVACY_MD);
writeFileSync(join(BRANDING_DIR, '.secret.png'), 'hidden');
writeFileSync(join(BRANDING_DIR, 'notes.txt'), 'not an image');
mkdirSync(join(BRANDING_DIR, 'dir.png'));

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
  rmSync(BRANDING_DIR, { recursive: true, force: true });
});

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  server: true,
  build: true,
  setupTimeout: 300_000,
  env: {
    NUXT_PUBLIC_API_BASE: FIXTURE_ORIGIN,
    NUXT_PUBLIC_OIDC_AUTHORITY: `${AUTH_ORIGIN}/realms/oecp`,
    NUXT_BRANDING_DIR: BRANDING_DIR,
    NUXT_PUBLIC_HERO_IMAGE: '/branding/hero.png',
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

describe('branding files', () => {
  it('renders the configured header image on the home page', async () => {
    const home = await page('/en');
    expect(home.html).toMatch(
      /<div class="branding-banner"[^>]*><img src="\/branding\/hero\.png" alt=""/,
    );
    // Same origin: allowed by the unchanged img-src.
    expect(home.policy).toContain("img-src 'self' data: https:");
  });

  it('serves a file of the branding directory with caching headers and no cookie', async () => {
    const response = await fetch('/branding/hero.png');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HERO_BYTES);
    const headers = response.headers;
    expect(headers.get('content-type')).toBe('image/png');
    expect(headers.get('content-length')).toBe(String(HERO_BYTES.length));
    expect(headers.get('cache-control')).toBe('public, max-age=86400');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('last-modified')).toMatch(/ GMT$/);
    expect(headers.get('etag')).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(headers.get('set-cookie')).toBeNull();

    const head = await fetch('/branding/hero.png', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(HERO_BYTES.length));
    expect(await head.text()).toBe('');

    const cached = await fetch('/branding/hero.png', {
      headers: { 'if-none-match': headers.get('etag')! },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  });

  it('lists the servable files at /branding/index.json, cached one minute, no cookie', async () => {
    const response = await fetch('/branding/index.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({
      files: ['hero.png', 'partner-urv.svg', 'privacy.en.md'],
    });
  });

  it("shows the partner's logo next to its name on the course list and the course page", async () => {
    const list = await page('/en/courses');
    const logos = tags(list.html, 'img').filter((t) => t.includes('course-card__logo'));
    // One of the three fixture cards is a course of `urv`; Amsterdam and Vienna have no logo.
    expect(logos).toHaveLength(1);
    for (const tag of logos) {
      expect(tag).toContain('src="/branding/partner-urv.svg"');
      expect(tag).toContain('alt=""');
    }
    const course = await page(`/en/courses/${COURSE_ID}`);
    expect(course.html).toMatch(
      /<img[^>]*class="course__logo"[^>]*src="\/branding\/partner-urv\.svg"/,
    );
  });

  it("links and serves the portal's own favicon", async () => {
    const home = await page('/en');
    expect(tags(home.html, 'link').find((t) => t.includes('rel="icon"'))).toMatch(
      /href="\/favicon\.svg"/,
    );
    const icon = await fetch('/favicon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toMatch(/^image\/svg\+xml/);
    expect(await icon.text()).toContain('<svg');
  });

  it('answers 404 to missing, hidden, invalid and non-file names', async () => {
    for (const path of [
      '/branding/missing.png',
      '/branding/.secret.png',
      '/branding/Hero.png',
      '/branding/hero.txt',
      '/branding/dir.png',
      '/branding/..%2Fpackage.json',
      '/branding/%2e%2e/nuxt.config.ts',
    ]) {
      const response = await fetch(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type'), path).not.toMatch(/^image\//);
    }
  });
});

describe('legal pages', () => {
  it('serves the Markdown text with its content type and the same caching rules', async () => {
    const response = await fetch('/branding/privacy.en.md');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe(PRIVACY_MD);
    expect((await fetch('/branding/privacy.html')).status).toBe(404);
    expect((await fetch('/branding/accessibility.en.md')).status).toBe(404);
  });

  it('server-renders the privacy notice with status 200, nonced scripts and the escaped raw HTML', async () => {
    const privacy = await page('/en/privacy');
    expectAllNonced(privacy);
    expect(privacy.html).toContain('<title>Privacy notice of the test alliance</title>');
    expect(privacy.html).toMatch(
      /<article class="legal"[^>]*><h1>Privacy notice of the test alliance<\/h1>/,
    );
    expect(privacy.html).toContain('<li>Data: none</li>');
    expect(privacy.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    // The footer links the page whose English text exists, and only that one.
    expect(privacy.html).toMatch(/<nav[^>]*aria-label="Legal"[^>]*>/);
    expect(privacy.html).toContain('href="/en/privacy"');
    expect(privacy.html).not.toContain('href="/en/accessibility"');
  });

  it('answers 404 with the "not published" message while the text does not exist', async () => {
    const response = await fetch('/en/accessibility', { headers: { accept: 'text/html' } });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-security-policy')).toContain('nonce-');
    const html = await response.text();
    expect(html).toContain('This text has not been published yet.');
    expect(html).toContain('<h1>Accessibility statement</h1>');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });
});
