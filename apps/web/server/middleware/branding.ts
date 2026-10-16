// SPDX-License-Identifier: EUPL-1.2
// `/branding/<name>`: image files of the deployment's branding directory
// (`NUXT_BRANDING_DIR`, e.g. the alliance's header image). Implemented as
// middleware (not `server/routes`) so that Nitro does not generate typed
// internal routes, which would change the `$fetch` typings of the app (see
// `seo-files.ts`). Name rule, content types and path containment live in
// `server/utils/branding.ts`. GET and HEAD only; no cookies.
// `/branding/index.json` lists the servable files (`{"files": [...]}`), read from
// the directory at most once a minute, so that pages can show optional files
// (partner logos `partner-<slug>.svg`) without probing for them.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BRANDING_INDEX_NAME,
  BRANDING_INDEX_TTL_MS,
  BRANDING_PREFIX,
  type BrandingDirEntry,
  type BrandingIndex,
  brandingContentType,
  brandingEtag,
  createBrandingIndex,
  etagMatches,
  resolveBrandingFile,
} from '../utils/branding';

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not Found' });

/** Entries of `dir`; a symbolic link counts as a file when it points to one (as served). */
async function readBrandingDir(dir: string): Promise<BrandingDirEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return Promise.all(
    entries.map(async (e) => ({
      name: e.name,
      isFile: e.isSymbolicLink()
        ? await stat(join(dir, e.name)).then(
            (s) => s.isFile(),
            () => false,
          )
        : e.isFile(),
    })),
  );
}

const brandingIndex = createBrandingIndex(readBrandingDir);

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!;
  if (!path.startsWith(BRANDING_PREFIX)) return;
  if (event.method !== 'GET' && event.method !== 'HEAD') return;
  const config = useRuntimeConfig(event);

  const name = path.slice(BRANDING_PREFIX.length);
  if (name === BRANDING_INDEX_NAME) {
    const files = await brandingIndex.list(config.brandingDir);
    if (!files) throw notFound();
    const body = JSON.stringify({ files } satisfies BrandingIndex);
    setResponseHeaders(event, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': `public, max-age=${BRANDING_INDEX_TTL_MS / 1000}`,
      'x-content-type-options': 'nosniff',
    });
    return event.method === 'HEAD' ? send(event) : body;
  }
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
