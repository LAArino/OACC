// SPDX-License-Identifier: EUPL-1.2
// `/robots.txt` and `/sitemap.xml` on the portal origin. Implemented as
// middleware (not `server/routes`) so that Nitro does not generate typed
// internal routes, which would change the `$fetch` typings of the app.
// `robots.txt` is dynamic because its `Sitemap:` line must be an absolute URL on
// the deployment's own host; the sitemap itself is proxied from the API.
// Neither response carries cookies.
import { robotsTxt, SITEMAP_UPSTREAM_PATH } from '../utils/seo-files';

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0];
  if (path !== '/robots.txt' && path !== '/sitemap.xml') return;
  if (event.method !== 'GET' && event.method !== 'HEAD') return;
  const config = useRuntimeConfig(event);

  if (path === '/robots.txt') {
    const i18nBase = (config.public.i18n as { baseUrl?: string } | undefined)?.baseUrl;
    const origin =
      i18nBase || getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin;
    setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
    setResponseHeader(event, 'cache-control', 'public, max-age=3600');
    return robotsTxt(origin);
  }

  const base = (config.apiInternalBase || config.public.apiBase).replace(/\/$/, '');
  try {
    const body = await $fetch<string>(`${base}${SITEMAP_UPSTREAM_PATH}`, {
      responseType: 'text',
      headers: { accept: 'application/xml' },
      timeout: 10_000,
    });
    setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8');
    setResponseHeader(event, 'cache-control', 'public, max-age=300');
    return body;
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Sitemap temporarily unavailable' });
  }
});
