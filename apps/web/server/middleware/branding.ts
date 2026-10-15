// SPDX-License-Identifier: EUPL-1.2
// `/branding/<name>`: image files of the deployment's branding directory
// (`NUXT_BRANDING_DIR`, e.g. the alliance's header image). Implemented as
// middleware (not `server/routes`) so that Nitro does not generate typed
// internal routes, which would change the `$fetch` typings of the app (see
// `seo-files.ts`). Name rule, content types and path containment live in
// `server/utils/branding.ts`. GET and HEAD only; no cookies.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  BRANDING_PREFIX,
  brandingContentType,
  brandingEtag,
  etagMatches,
  resolveBrandingFile,
} from '../utils/branding';

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not Found' });

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!;
  if (!path.startsWith(BRANDING_PREFIX)) return;
  if (event.method !== 'GET' && event.method !== 'HEAD') return;
  const config = useRuntimeConfig(event);

  const name = path.slice(BRANDING_PREFIX.length);
  const file = resolveBrandingFile(config.brandingDir, name);
  if (!file) throw notFound();
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) throw notFound();

  const etag = brandingEtag(info.size, info.mtimeMs);
  setResponseHeaders(event, {
    'cache-control': 'public, max-age=86400',
    'last-modified': info.mtime.toUTCString(),
    etag,
    'x-content-type-options': 'nosniff',
    // Opened directly (not as <img>), an SVG must not run scripts on the portal origin.
    'content-security-policy':
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  });
  if (etagMatches(getRequestHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304);
    return send(event);
  }
  setResponseHeaders(event, {
    'content-type': brandingContentType(name)!,
    'content-length': info.size,
  });
  if (event.method === 'HEAD') return send(event);
  return sendStream(event, createReadStream(file));
});
