// SPDX-License-Identifier: EUPL-1.2
//
// Privacy contract for public pages (spec §7): no cookies, no auth, no analytics.
// Nothing here may set a cookie: i18n browser detection runs without its cookie,
// and OIDC code (oidc-client-ts) is only loaded by client-rendered /admin pages,
// which keep tokens in memory.

/** Enabled UI locales; English is mandatory and the content fallback (spec §5, §7). */
const locales = [{ code: 'en', language: 'en', name: 'English', file: 'en.json' }];

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxtjs/i18n'],
  devtools: { enabled: false },
  // Self-hosted, bundled styles of the public portal (no external CSS or fonts).
  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // NUXT_API_INTERNAL_BASE: server-only origin used during SSR (e.g. http://api:3000
    // inside Docker, where the public host would resolve to the web container itself).
    // Empty means "use public.apiBase".
    apiInternalBase: '',
    // Content-Security-Policy of every HTML response (server/plugins/csp.ts, spec §10).
    csp: {
      // NUXT_CSP_MODE: enforce | report-only | off.
      mode: 'enforce',
      // NUXT_CSP_REPORT_URI: optional violation report endpoint (absolute URL or path).
      reportUri: '',
    },
    // NUXT_BRANDING_DIR: directory of the deployment's branding images (header
    // image, ...), served at /branding/<name> (server/middleware/branding.ts).
    // Empty: feature off, every /branding/* request answers 404.
    brandingDir: '',
    public: {
      // NUXT_PUBLIC_ALLIANCE_NAME: shown in the public portal (e.g. "Aurora").
      allianceName: 'the alliance',
      // NUXT_PUBLIC_HERO_IMAGE: optional header image of the home page; a path on
      // the portal origin (e.g. /branding/hero.png) or an absolute https URL.
      heroImage: '',
      // NUXT_PUBLIC_HERO_IMAGE_ALT: its text alternative; empty = decorative (alt="").
      heroImageAlt: '',
      // NUXT_PUBLIC_LOGO_IMAGE: optional alliance logo in the site header, in place
      // of the text brand (alt = allianceName); a path or an absolute https URL.
      logoImage: '',
      // NUXT_PUBLIC_API_BASE: origin serving /api/public, /api/admin and /oeapi/v5.
      apiBase: 'http://localhost:3000',
      // NUXT_PUBLIC_OIDC_AUTHORITY: https://{auth-host}/realms/oecp
      oidcAuthority: '',
      oidcClientId: 'oecp-admin',
      // Paths on the portal origin; must match the redirect URIs and
      // post-logout redirect URIs of client `oecp-admin` (identity/keycloak).
      oidcRedirectPath: '/en/admin/callback',
      // Silent session restore (hidden iframe, prompt=none); covered by the
      // `/en/admin/*` redirect URI pattern of `oecp-admin`.
      oidcSilentRedirectPath: '/en/admin/silent-callback',
      oidcPostLogoutPath: '/en',
      oidcHomePath: '/en/admin',
    },
  },

  // Public catalogue is server-rendered; the admin dashboard is client-only.
  routeRules: {
    '/admin/**': { ssr: false },
    ...Object.fromEntries(locales.map((l) => [`/${l.code}/admin/**`, { ssr: false }])),
  },

  i18n: {
    strategy: 'prefix',
    defaultLocale: 'en',
    locales,
    detectBrowserLanguage: {
      // `/` redirects by Accept-Language; no language cookie.
      useCookie: false,
      redirectOn: 'root',
      fallbackLocale: 'en',
    },
  },

  typescript: {
    strict: true,
  },
});
