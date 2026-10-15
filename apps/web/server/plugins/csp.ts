// SPDX-License-Identifier: EUPL-1.2
// Nonce-based Content-Security-Policy on every HTML response of the portal
// (spec §10). Traefik sets the other security headers (HSTS, nosniff,
// X-Frame-Options, referrer and permissions policies) but not this one: only the
// application knows the per-response nonce.
//
// For each rendered page (SSR catalogue, client-rendered /admin shell, error
// page) the `render:html` hook draws a fresh 128-bit nonce, adds it to the
// script, style and link tags that Nuxt and unhead generate (head, body
// prepend/append: entry module, import map, payload and config scripts, inlined
// component styles, JSON-LD) and sets the header. The rendered page body is left
// alone, so markup that reaches it through content can never carry the nonce.
// Non-HTML responses (assets, robots.txt, sitemap.xml) get no policy.
//
// Configuration (runtime, `runtimeConfig.csp`):
//   NUXT_CSP_MODE        enforce (default) | report-only | off
//   NUXT_CSP_REPORT_URI  optional report endpoint (`report-uri` + `report-to`);
//                        none exists yet, so violations only reach the console.
// Origins come from NUXT_PUBLIC_OIDC_AUTHORITY (connect, frame and form targets)
// and NUXT_PUBLIC_API_BASE (connect, when it is not the portal's own origin).
//
// Pages must stay uncached between requests (no `cache`/`isr`/`swr` route rules,
// no shared cache in front of HTML): a cached page would replay an old nonce.
// SSR streaming (`streaming` route rule) is not supported by this hook.
import {
  addNonceToTags,
  createNonce,
  cspResponseHeaders,
  httpOrigin,
  isKnownCspMode,
  normalizeReportUri,
  parseCspMode,
} from '../utils/csp';

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig();
  const csp = (config.csp ?? {}) as { mode?: string; reportUri?: string };
  const rawMode = (csp.mode ?? '').trim().toLowerCase();
  const mode = parseCspMode(rawMode);
  if (rawMode && !isKnownCspMode(rawMode)) {
    console.warn(`[csp] unknown NUXT_CSP_MODE "${rawMode}"; enforcing the policy`);
  }
  if (mode === 'off') {
    console.warn('[csp] NUXT_CSP_MODE=off: pages are served without a Content-Security-Policy');
    return;
  }
  const reportUri = normalizeReportUri(csp.reportUri);
  if (csp.reportUri && !reportUri) {
    console.warn('[csp] NUXT_CSP_REPORT_URI ignored: not an http(s) URL or absolute path');
  }
  const authOrigin = httpOrigin(config.public.oidcAuthority);
  const apiOrigin = httpOrigin(config.public.apiBase);

  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = createNonce();
    html.head = html.head.map((chunk) => addNonceToTags(chunk, nonce));
    html.bodyPrepend = html.bodyPrepend.map((chunk) => addNonceToTags(chunk, nonce));
    html.bodyAppend = html.bodyAppend.map((chunk) => addNonceToTags(chunk, nonce));
    // Vite's dev client reads the nonce from this tag for the styles it injects.
    if (import.meta.dev) html.head.unshift(`<meta property="csp-nonce" nonce="${nonce}">`);

    const request = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true });
    const headers = cspResponseHeaders(mode, {
      nonce,
      authOrigin,
      apiOrigin: apiOrigin === request.origin ? undefined : apiOrigin,
      reportUri,
      upgradeInsecureRequests: !import.meta.dev && request.protocol === 'https:',
    });
    for (const [name, value] of Object.entries(headers)) setResponseHeader(event, name, value);
  });
});
