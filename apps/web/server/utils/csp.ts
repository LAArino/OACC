// SPDX-License-Identifier: EUPL-1.2
// Content-Security-Policy of the portal (spec §10): a strict, nonce-based policy
// built per HTML response by `server/plugins/csp.ts`. Pure functions, unit-tested
// in `test/csp.test.ts`.
//
// Scripts: only elements carrying the per-response nonce run; `'strict-dynamic'`
// extends that trust to what they load (Nuxt's entry imports its chunks, the CSV
// validator worker, `import()` of oidc-client-ts). Host allowlists and `'self'`
// are deliberately absent from `script-src`: CSP3 browsers ignore them next to
// `'strict-dynamic'`, and Nuxt 4 needs import maps, so every browser that runs
// the app supports CSP3. `application/ld+json` and `application/json` scripts
// are data blocks: browsers never execute them, so CSP does not apply to them
// (they get the nonce anyway, as every head script does).

/** `NUXT_CSP_MODE`: `enforce` (default), `report-only` or `off`. */
export const CSP_MODES = ['enforce', 'report-only', 'off'] as const;
export type CspMode = (typeof CSP_MODES)[number];

/** Name of the `Reporting-Endpoints` group the policy reports to (`report-to`). */
export const CSP_REPORT_GROUP = 'csp-endpoint';

/** 16 random bytes (128 bits), base64: 22 characters and `==`. */
const NONCE_RE = /^[A-Za-z0-9+/]{22}==$/;

/** A fresh 128-bit nonce, base64-encoded, from the platform CSPRNG. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function isValidNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_RE.test(value);
}

/**
 * Parses `NUXT_CSP_MODE`. Empty means the default, `enforce`; an unknown value
 * also enforces (fail closed) and is reported by `isKnownCspMode`.
 */
export function parseCspMode(value: unknown): CspMode {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isKnownCspMode(mode) ? mode : 'enforce';
}

export function isKnownCspMode(value: unknown): value is CspMode {
  return typeof value === 'string' && (CSP_MODES as readonly string[]).includes(value);
}

/** The response header for `mode`, or null when the policy is off. */
export function cspHeaderName(mode: CspMode): string | null {
  if (mode === 'enforce') return 'Content-Security-Policy';
  if (mode === 'report-only') return 'Content-Security-Policy-Report-Only';
  return null;
}

/** Origin (`https://host[:port]`) of an http(s) URL, else undefined. */
export function httpOrigin(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `NUXT_CSP_REPORT_URI`: an absolute http(s) URL or an absolute path on the portal
 * origin. Anything else (relative paths, other schemes, characters that would
 * break the header) is ignored, so a typo cannot corrupt the policy.
 */
export function normalizeReportUri(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const uri = value.trim();
  if (!uri || /[\s;,"'\\]/.test(uri) || [...uri].some((c) => c.charCodeAt(0) < 0x20)) {
    return undefined;
  }
  if (uri.startsWith('/')) return uri.startsWith('//') ? undefined : uri;
  return httpOrigin(uri) ? new URL(uri).href : undefined;
}

export interface CspPolicyOptions {
  /** Per-response nonce from `createNonce()`. */
  nonce: string;
  /** Origin of the OIDC authority (NUXT_PUBLIC_OIDC_AUTHORITY): token XHR, silent-renew iframe, sign-in. */
  authOrigin?: string;
  /** Origin of the API (NUXT_PUBLIC_API_BASE) when it is not the portal's own. */
  apiOrigin?: string;
  /** Normalized report endpoint (`normalizeReportUri`). */
  reportUri?: string;
  /** Production over HTTPS only: a plain-HTTP origin (local preview) would break. */
  upgradeInsecureRequests?: boolean;
}

/** The policy string (one header value) for one HTML response. */
export function buildCspPolicy(options: CspPolicyOptions): string {
  if (!isValidNonce(options.nonce)) throw new Error('CSP nonce must be 16 random bytes in base64');
  const nonce = `'nonce-${options.nonce}'`;
  const { authOrigin, apiOrigin } = options;
  const directives: Array<[string, Array<string | undefined>]> = [
    ['default-src', ["'self'"]],
    ['script-src', [nonce, "'strict-dynamic'"]],
    ['style-src', ["'self'", nonce]],
    // `https:` for images only: partner logos may be hosted by the partners (v1).
    ['img-src', ["'self'", 'data:', 'https:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", apiOrigin, authOrigin]],
    // oidc-client-ts points the hidden silent-renew iframe at the authorize
    // endpoint of the auth host, which redirects back to /{locale}/admin/silent-callback.
    ['frame-src', ["'self'", authOrigin]],
    // The CSV validator is a same-origin module worker (Vite emits it as a file).
    ['worker-src', ["'self'"]],
    ['form-action', ["'self'", authOrigin]],
    // Same as Traefik's X-Frame-Options: SAMEORIGIN (the silent-callback iframe).
    ['frame-ancestors', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
  ];
  if (options.upgradeInsecureRequests) directives.push(['upgrade-insecure-requests', []]);
  if (options.reportUri) {
    directives.push(['report-uri', [options.reportUri]]);
    directives.push(['report-to', [CSP_REPORT_GROUP]]);
  }
  return directives
    .map(([name, sources]) => {
      const unique = [...new Set(sources.filter((s): s is string => !!s))];
      return [name, ...unique].join(' ');
    })
    .join('; ');
}

/**
 * Headers to set on an HTML response: the policy under the header of `mode`, plus
 * `Reporting-Endpoints` when a report URI is configured. Empty when `mode` is off.
 */
export function cspResponseHeaders(
  mode: CspMode,
  options: CspPolicyOptions,
): Record<string, string> {
  const name = cspHeaderName(mode);
  if (!name) return {};
  const headers: Record<string, string> = { [name]: buildCspPolicy(options) };
  if (options.reportUri)
    headers['Reporting-Endpoints'] = `${CSP_REPORT_GROUP}="${options.reportUri}"`;
  return headers;
}

const NONCE_ATTR_RE = /\snonce(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?(?=[\s/>]|$)/gi;
const NONCE_TAGS = new Set(['script', 'style', 'link']);
/** Elements whose content the HTML parser reads as text, not markup. */
const RAW_TEXT_TAGS = new Set([
  'script',
  'style',
  'title',
  'textarea',
  'noscript',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
]);

/** Index of the `>` closing the start tag that begins at `from`, skipping quoted values. */
function startTagEnd(html: string, from: number): number {
  let quote = '';
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

/**
 * Adds `nonce="…"` to every `<script>`, `<style>` and `<link>` start tag of an HTML
 * fragment, replacing a nonce already there. It reads the fragment like a tokenizer
 * does: attribute values, comments and the text content of raw-text elements
 * (script, style, title, textarea, noscript…) are skipped, so text that only looks
 * like a tag never gets a nonce.
 *
 * Apply it only to markup the server generates (Nuxt's and unhead's head and body
 * tags), never to the rendered page body: a nonce added there would also bless
 * any markup injected through content.
 */
export function addNonceToTags(html: string, nonce: string): string {
  if (!isValidNonce(nonce)) throw new Error('CSP nonce must be 16 random bytes in base64');
  const lower = html.toLowerCase();
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (lower.startsWith('<!--', lt)) {
      const end = lower.indexOf('-->', lt + 4);
      const stop = end === -1 ? html.length : end + 3;
      out += html.slice(lt, stop);
      i = stop;
      continue;
    }
    const name = /^<([a-z][a-z0-9-]*)/.exec(lower.slice(lt, lt + 32))?.[1];
    if (!name) {
      // End tag, doctype or a stray `<`.
      out += '<';
      i = lt + 1;
      continue;
    }
    const nameEnd = lt + 1 + name.length;
    const end = startTagEnd(html, nameEnd);
    if (end === -1) {
      // Truncated tag: leave the rest untouched.
      out += html.slice(lt);
      break;
    }
    if (NONCE_TAGS.has(name)) {
      const attrs = html.slice(nameEnd, end).replace(NONCE_ATTR_RE, '');
      out += `${html.slice(lt, nameEnd)} nonce="${nonce}"${attrs}>`;
    } else {
      out += html.slice(lt, end + 1);
    }
    i = end + 1;
    if (RAW_TEXT_TAGS.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      const stop = close === -1 ? html.length : close;
      out += html.slice(i, stop);
      i = stop;
    }
  }
  return out;
}
