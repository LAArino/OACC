// SPDX-License-Identifier: EUPL-1.2
/**
 * Self-hosted OpenAPI viewer of `/api/public/v1` and `/api/admin/v1`: an HTML page
 * per API that loads the vendored Redoc standalone bundle (`static/openapi/`, see
 * its README) from `/api/docs-assets/<version>/` and points it at the API's
 * `openapi.json`. No inline script, no third-party origin: Traefik serves these
 * routes with the `security-headers-api-docs` CSP (`script-src 'self'`).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { API_BASE, type ApiName } from './operations.js';

/** Upstream version of the vendored bundle (npm `redoc`); also the asset path segment. */
export const REDOC_VERSION = '2.5.4';
/** SHA-256 of `static/openapi/redoc.standalone.js` as published in `redoc@2.5.4`. */
export const REDOC_SHA256 = 'dcaf76612bc4a3fbcc923a8966dee2f6146a5f32e5ce1b6f02dd60cbbf89500b';
export const REDOC_FILE = 'redoc.standalone.js';
/** Prefix of the viewer's static files. */
export const DOCS_ASSETS_BASE = '/api/docs-assets';
/** The asset URLs carry the bundle version: they never change. */
export const DOCS_ASSET_CACHE = 'public, max-age=31536000, immutable';

/**
 * Redoc 2 renders "API docs by Redocly" with a logo from its CDN, with no option
 * to turn it off. The served copy points the image at an empty `data:` URL
 * instead: the image fails to load, Redoc hides it, and nothing is requested
 * from a third party (the CSP would block it and report a violation).
 */
const REDOCLY_LOGO_URL = '"https://cdn.redoc.ly/redoc/logo-mini.svg"';
const REDOCLY_LOGO_REPLACEMENT = '"data:,"';

/** Redoc options (`<redoc>` attributes); `theme` is JSON. System fonts: no web font is loaded. */
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const THEME = {
  typography: {
    fontFamily: SANS,
    headings: { fontFamily: SANS },
    code: { fontFamily: MONO },
  },
};

const TITLES: Readonly<Record<ApiName, string>> = {
  public: 'OECP public API v1',
  admin: 'OECP admin API v1',
};

export interface DocsAsset {
  body: Buffer;
  contentType: string;
  etag: string;
}

export interface ApiDocs {
  /** HTML page per API. */
  pages: Readonly<Record<ApiName, string>>;
  /** Static files by `<version>/<file>`. */
  assets: ReadonlyMap<string, DocsAsset>;
}

/** Directory of the vendored bundle (src/openapi and dist/openapi alike). */
export const DOCS_STATIC_DIR = new URL('../../static/openapi/', import.meta.url);

/** Reads and checks the vendored bundle and renders the two pages (once, at start-up). */
export function buildApiDocs(staticDir: URL = DOCS_STATIC_DIR): ApiDocs {
  const upstream = readFileSync(new URL(REDOC_FILE, staticDir));
  const sha256 = createHash('sha256').update(upstream).digest('hex');
  if (sha256 !== REDOC_SHA256) {
    throw new Error(
      `static/openapi/${REDOC_FILE}: SHA-256 ${sha256}, expected ${REDOC_SHA256} (redoc@${REDOC_VERSION})`,
    );
  }
  const source = upstream.toString('utf8');
  const occurrences = source.split(REDOCLY_LOGO_URL).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `static/openapi/${REDOC_FILE}: expected one Redocly logo URL, found ${occurrences}`,
    );
  }
  const body = Buffer.from(source.replace(REDOCLY_LOGO_URL, REDOCLY_LOGO_REPLACEMENT), 'utf8');
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
  const assets = new Map<string, DocsAsset>([
    [
      `${REDOC_VERSION}/${REDOC_FILE}`,
      { body, contentType: 'text/javascript; charset=utf-8', etag },
    ],
  ]);
  return { pages: { public: page('public'), admin: page('admin') }, assets };
}

/** URL of the bundle as referenced by the pages. */
export const redocScriptUrl = (): string => `${DOCS_ASSETS_BASE}/${REDOC_VERSION}/${REDOC_FILE}`;

function page(api: ApiName): string {
  const specUrl = escapeHtml(`${API_BASE[api]}/openapi.json`);
  const attributes: Record<string, string> = {
    'spec-url': `${API_BASE[api]}/openapi.json`,
    'required-props-first': 'true',
    'expand-responses': '200,201,202',
    theme: JSON.stringify(THEME),
  };
  const redoc = Object.entries(attributes)
    .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
    .join(' ');
  // <redoc> before the script: the bundle renders into it as soon as it runs.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(TITLES[api])}</title>
<style>body { margin: 0; }</style>
</head>
<body>
<noscript>This page renders the OpenAPI document <a href="${specUrl}">${specUrl}</a> and needs JavaScript.</noscript>
<redoc ${redoc}></redoc>
<script src="${escapeHtml(redocScriptUrl())}"></script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
