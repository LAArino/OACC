// SPDX-License-Identifier: EUPL-1.2
// Content-Security-Policy builder and nonce injection (server/utils/csp.ts).
import { describe, expect, it } from 'vitest';
import {
  addNonceToTags,
  buildCspPolicy,
  createNonce,
  cspHeaderName,
  cspResponseHeaders,
  httpOrigin,
  isKnownCspMode,
  isValidNonce,
  normalizeReportUri,
  parseCspMode,
} from '../server/utils/csp';

const NONCE = 'AAECAwQFBgcICQoLDA0ODw=='; // bytes 0..15
const AUTH = 'https://auth.example.eu';
const API = 'https://api.example.eu';

/** Directive name -> sources of a policy string. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((d) => {
      const [name, ...sources] = d.split(' ');
      return [name!, sources];
    }),
  );
}

describe('createNonce', () => {
  it('returns 128 random bits in base64', () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
    expect(isValidNonce(nonce)).toBe(true);
  });

  it('is fresh on every call', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => createNonce()));
    expect(nonces.size).toBe(200);
  });

  it('rejects malformed nonces', () => {
    for (const bad of [
      '',
      'abc',
      `${NONCE}x`,
      "AAECAwQFBgcICQoLDA0OD'==",
      'AAECAwQFBgcICQoLDA0ODw',
      42,
    ]) {
      expect(isValidNonce(bad)).toBe(false);
    }
  });
});

describe('modes', () => {
  it('parses NUXT_CSP_MODE with enforce as default and for unknown values', () => {
    expect(parseCspMode(undefined)).toBe('enforce');
    expect(parseCspMode('')).toBe('enforce');
    expect(parseCspMode(' Report-Only ')).toBe('report-only');
    expect(parseCspMode('off')).toBe('off');
    expect(parseCspMode('enforce')).toBe('enforce');
    expect(parseCspMode('disabled')).toBe('enforce');
    expect(isKnownCspMode('disabled')).toBe(false);
    expect(isKnownCspMode('report-only')).toBe(true);
  });

  it('maps modes to headers', () => {
    expect(cspHeaderName('enforce')).toBe('Content-Security-Policy');
    expect(cspHeaderName('report-only')).toBe('Content-Security-Policy-Report-Only');
    expect(cspHeaderName('off')).toBeNull();
  });

  it('sets the header of the mode, and nothing when off', () => {
    const options = { nonce: NONCE, authOrigin: AUTH };
    expect(Object.keys(cspResponseHeaders('enforce', options))).toEqual([
      'Content-Security-Policy',
    ]);
    expect(Object.keys(cspResponseHeaders('report-only', options))).toEqual([
      'Content-Security-Policy-Report-Only',
    ]);
    expect(cspResponseHeaders('off', options)).toEqual({});
  });
});

describe('buildCspPolicy', () => {
  it('builds the strict policy', () => {
    expect(buildCspPolicy({ nonce: NONCE, authOrigin: AUTH })).toBe(
      [
        "default-src 'self'",
        `script-src 'nonce-${NONCE}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${NONCE}'`,
        "img-src 'self' data: https:",
        "font-src 'self'",
        `connect-src 'self' ${AUTH}`,
        `frame-src 'self' ${AUTH}`,
        "worker-src 'self'",
        `form-action 'self' ${AUTH}`,
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join('; '),
    );
  });

  it('never allows inline or eval code', () => {
    const policy = buildCspPolicy({ nonce: NONCE, authOrigin: AUTH, apiOrigin: API });
    expect(policy).not.toMatch(/unsafe-(inline|eval|hashes)/);
    const scriptSrc = directives(policy).get('script-src');
    expect(scriptSrc).toEqual([`'nonce-${NONCE}'`, "'strict-dynamic'"]);
  });

  it('adds the API origin to connect-src only', () => {
    const d = directives(buildCspPolicy({ nonce: NONCE, authOrigin: AUTH, apiOrigin: API }));
    expect(d.get('connect-src')).toEqual(["'self'", API, AUTH]);
    expect(d.get('frame-src')).toEqual(["'self'", AUTH]);
    expect(d.get('form-action')).toEqual(["'self'", AUTH]);
  });

  it('lists an origin once', () => {
    const d = directives(buildCspPolicy({ nonce: NONCE, authOrigin: AUTH, apiOrigin: AUTH }));
    expect(d.get('connect-src')).toEqual(["'self'", AUTH]);
  });

  it('works without an auth origin (OIDC not configured)', () => {
    const d = directives(buildCspPolicy({ nonce: NONCE }));
    expect(d.get('connect-src')).toEqual(["'self'"]);
    expect(d.get('frame-src')).toEqual(["'self'"]);
  });

  it('adds upgrade-insecure-requests on request', () => {
    expect(buildCspPolicy({ nonce: NONCE })).not.toContain('upgrade-insecure-requests');
    const policy = buildCspPolicy({ nonce: NONCE, upgradeInsecureRequests: true });
    expect(policy.split('; ')).toContain('upgrade-insecure-requests');
  });

  it('reports to the configured endpoint', () => {
    const reportUri = 'https://reports.example.eu/csp';
    const headers = cspResponseHeaders('report-only', { nonce: NONCE, reportUri });
    const d = directives(headers['Content-Security-Policy-Report-Only']!);
    expect(d.get('report-uri')).toEqual([reportUri]);
    expect(d.get('report-to')).toEqual(['csp-endpoint']);
    expect(headers['Reporting-Endpoints']).toBe(`csp-endpoint="${reportUri}"`);
    expect(cspResponseHeaders('enforce', { nonce: NONCE })['Reporting-Endpoints']).toBeUndefined();
  });

  it('refuses an invalid nonce', () => {
    expect(() => buildCspPolicy({ nonce: "x' 'unsafe-inline" })).toThrow();
  });
});

describe('origins and report URI', () => {
  it('keeps only http(s) origins', () => {
    expect(httpOrigin('https://auth.example.eu/realms/oecp')).toBe(AUTH);
    expect(httpOrigin('http://localhost:8080/realms/oecp')).toBe('http://localhost:8080');
    expect(httpOrigin('https://auth.example.eu:8443/x?y')).toBe('https://auth.example.eu:8443');
    for (const bad of ['', '   ', 'auth.example.eu', 'javascript:alert(1)', 'data:,x', undefined]) {
      expect(httpOrigin(bad)).toBeUndefined();
    }
  });

  it('accepts absolute URLs and paths as report URI', () => {
    expect(normalizeReportUri('https://reports.example.eu/csp')).toBe(
      'https://reports.example.eu/csp',
    );
    expect(normalizeReportUri(' /api/csp-reports ')).toBe('/api/csp-reports');
    for (const bad of [
      '',
      'csp',
      '//evil.example/csp',
      'javascript:alert(1)',
      "https://x.eu/a; script-src 'unsafe-inline'",
      'https://x.eu/a b',
      'https://x.eu/"a',
      '/a,b',
      undefined,
    ]) {
      expect(normalizeReportUri(bad)).toBeUndefined();
    }
  });
});

describe('addNonceToTags', () => {
  const n = `nonce="${NONCE}"`;

  it('adds the nonce to script, style and link tags', () => {
    const html =
      '<meta charset="utf-8"><script type="importmap">{"imports":{}}</script>' +
      '<style>.a{color:red}</style><link rel="modulepreload" href="/_nuxt/a.js">' +
      '<link rel="stylesheet" href="/_nuxt/a.css"/><script type="module" src="/_nuxt/a.js"></script>';
    expect(addNonceToTags(html, NONCE)).toBe(
      `<meta charset="utf-8"><script ${n} type="importmap">{"imports":{}}</script>` +
        `<style ${n}>.a{color:red}</style><link ${n} rel="modulepreload" href="/_nuxt/a.js">` +
        `<link ${n} rel="stylesheet" href="/_nuxt/a.css"/><script ${n} type="module" src="/_nuxt/a.js"></script>`,
    );
  });

  it('replaces an existing nonce', () => {
    expect(addNonceToTags('<script nonce="old" src="/a.js"></script>', NONCE)).toBe(
      `<script ${n} src="/a.js"></script>`,
    );
    expect(addNonceToTags("<SCRIPT NONCE='old'>x()</SCRIPT>", NONCE)).toBe(
      `<SCRIPT ${n}>x()</SCRIPT>`,
    );
  });

  it('leaves raw text, comments and attribute values alone', () => {
    const json = '{"d":"<script>alert(1)</script>"}'; // not escaped on purpose
    const html =
      `<script type="application/ld+json">${json.replace('</script>', '<\\/script>')}</script>` +
      '<!-- <script>x</script> --><meta content="<script>"><noscript-x></noscript-x>' +
      "<title>a <script>b</script></title><noscript><style>.x{}</style></noscript><p title='<link>'>";
    const out = addNonceToTags(html, NONCE);
    expect(out.match(/nonce=/g)).toHaveLength(1);
    expect(out).toContain('<!-- <script>x</script> -->');
    expect(out).toContain('<meta content="<script>">');
    expect(out).toContain('<title>a <script>b</script></title>');
    expect(out).toContain('<noscript><style>.x{}</style></noscript>');
    expect(out).toContain("<p title='<link>'>");
  });

  it('handles quoted > inside a tag and truncated input', () => {
    expect(addNonceToTags('<link title="a>b" href="/x">', NONCE)).toBe(
      `<link ${n} title="a>b" href="/x">`,
    );
    expect(addNonceToTags('<script src="/a.js"', NONCE)).toBe('<script src="/a.js"');
  });

  it('does not touch other elements', () => {
    const html = '<scripts></scripts><linkage></linkage><div data-nonce="x"><stylesheet>';
    expect(addNonceToTags(html, NONCE)).toBe(html);
  });
});
