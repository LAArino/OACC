// SPDX-License-Identifier: EUPL-1.2
// Deployment branding (header image, logos): files of the directory named by
// `NUXT_BRANDING_DIR`, served at `/branding/<name>` by
// `server/middleware/branding.ts`. The alliance provides these files and holds
// their rights; they are deployment configuration, never repository content.
// Pure functions, unit-tested in `test/branding.test.ts`.
import path from 'node:path';

/** URL prefix of the branding files on the portal origin. */
export const BRANDING_PREFIX = '/branding/';

/** Image types a branding file may have, by (lower-case) file extension. */
export const BRANDING_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

/**
 * A single path segment: lower-case letters, digits, `.`, `_`, `-`, not starting
 * with a dot (no hidden files), at most 100 characters. No `/`, `\`, `%` or other
 * characters, so the name is never URL-decoded or split.
 */
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** Content type of a valid branding file name; `undefined` for any other name. */
export function brandingContentType(name: string): string | undefined {
  if (!NAME_RE.test(name) || name.includes('..')) return undefined;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return undefined;
  return BRANDING_CONTENT_TYPES[name.slice(dot + 1)];
}

/** Whether `name` may be served from the branding directory. */
export function isBrandingFileName(name: string): boolean {
  return brandingContentType(name) !== undefined;
}

/** Whether `file` lies strictly inside directory `dir` (lexically, after resolving). */
export function isPathInside(dir: string, file: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Absolute path of branding file `name` in `dir`, or `undefined` when the
 * feature is off (`dir` empty), the name is not allowed, or the joined path
 * leaves the directory (defence in depth: the name rule already excludes that).
 */
export function resolveBrandingFile(dir: string, name: string): string | undefined {
  if (!dir || !isBrandingFileName(name)) return undefined;
  const file = path.join(dir, name);
  return isPathInside(dir, file) ? path.resolve(file) : undefined;
}

/** Weak entity tag of a file version, from its size and modification time. */
export function brandingEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

/** Whether an `If-None-Match` header matches `etag` (weak comparison, RFC 9110 §13.1.2). */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  const wanted = opaque(etag);
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === wanted);
}

// --- Index of the branding directory -------------------------------------------

/** Name of the listing of the branding directory: `/branding/index.json`. */
export const BRANDING_INDEX_NAME = 'index.json';

/** How long a listing of the directory is reused before it is read again. */
export const BRANDING_INDEX_TTL_MS = 60_000;

/** A directory entry as far as the index cares: its name and whether it is a file. */
export interface BrandingDirEntry {
  name: string;
  isFile: boolean;
}

/** Body of `/branding/index.json`: the servable file names, sorted. */
export interface BrandingIndex {
  files: string[];
}

/** Servable file names among `entries` (the name rule, regular files only), sorted. */
export function brandingIndexFiles(entries: readonly BrandingDirEntry[]): string[] {
  return entries
    .filter((e) => e.isFile && isBrandingFileName(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Cached listing of the branding directory: `list(dir)` reads the directory
 * (through `readDir`) at most once per `ttlMs` and directory; concurrent calls
 * share one read. `undefined` when the feature is off (`dir` empty); an
 * unreadable directory lists no files (and is retried after `ttlMs`).
 */
export function createBrandingIndex(
  readDir: (dir: string) => Promise<BrandingDirEntry[]>,
  options: { ttlMs?: number; now?: () => number } = {},
) {
  const ttlMs = options.ttlMs ?? BRANDING_INDEX_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; files: Promise<string[]> }>();
  return {
    list(dir: string): Promise<string[]> | undefined {
      if (!dir) return undefined;
      const hit = cache.get(dir);
      if (hit && now() - hit.at < ttlMs) return hit.files;
      const files = readDir(dir).then(brandingIndexFiles, () => []);
      cache.set(dir, { at: now(), files });
      return files;
    },
  };
}
