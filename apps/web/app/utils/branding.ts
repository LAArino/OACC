// SPDX-License-Identifier: EUPL-1.2
// Client-side helpers of the deployment branding: the favicon link and the
// partner logos found in the index of the branding directory
// (`/branding/index.json`, server/middleware/branding.ts).

/** The portal's own favicon (public/favicon.svg), used when none is configured. */
export const DEFAULT_FAVICON = '/favicon.svg';

/** Icon types by (lower-case) file extension. */
const ICON_TYPES: Readonly<Record<string, string>> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

/** Media type of an icon path or URL by its extension (query and fragment ignored). */
export function faviconType(src: string): string | undefined {
  const pathname = src.split(/[?#]/, 1)[0] ?? '';
  const name = pathname.slice(pathname.lastIndexOf('/') + 1);
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? ICON_TYPES[ext] : undefined;
}

/** `<link rel="icon">` of the configured favicon (`NUXT_PUBLIC_FAVICON_IMAGE`), else the default. */
export function faviconLink(configured: string | undefined): {
  key: string;
  rel: 'icon';
  href: string;
  type?: string;
} {
  const href = configured?.trim() || DEFAULT_FAVICON;
  const type = faviconType(href);
  return { key: 'icon', rel: 'icon', href, ...(type ? { type } : {}) };
}

/** Extensions of a partner logo `partner-<slug>.<ext>`, in order of preference. */
export const PARTNER_LOGO_EXTENSIONS = ['svg', 'png', 'webp'] as const;

/** File names listed by an index body; anything else than `{files: string[]}` lists none. */
export function parseBrandingIndex(body: unknown): string[] {
  const files = (body as { files?: unknown } | null | undefined)?.files;
  return Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : [];
}

/** Path of the logo of partner `slug` among the listed `files`, or `undefined`. */
export function partnerLogoPath(files: readonly string[], slug: string): string | undefined {
  if (!slug) return undefined;
  for (const ext of PARTNER_LOGO_EXTENSIONS) {
    const name = `partner-${slug}.${ext}`;
    if (files.includes(name)) return `/branding/${name}`;
  }
  return undefined;
}

/** The public legal pages whose Markdown text comes from the branding directory. */
export type LegalKind = 'privacy' | 'accessibility';

/** Language of a legal-page file name: the 2-3 letter primary subtag of the locale. */
function legalLanguage(locale: string): string | undefined {
  const lang = locale.toLowerCase().split(/[-_]/, 1)[0] ?? '';
  return /^[a-z]{2,3}$/.test(lang) ? lang : undefined;
}

/**
 * The branding file to show for legal page `kind` in `locale`: `<kind>.<lang>.md`
 * when listed, else the English `<kind>.en.md`, else `undefined` (not published).
 */
export function legalFile(
  files: readonly string[],
  kind: LegalKind,
  locale: string,
): { name: string; lang: string } | undefined {
  for (const lang of new Set([legalLanguage(locale), 'en'])) {
    if (!lang) continue;
    const name = `${kind}.${lang}.md`;
    if (files.includes(name)) return { name, lang };
  }
  return undefined;
}
