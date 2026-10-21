// SPDX-License-Identifier: EUPL-1.2
// Branding files served at /branding/<name> (server/utils/branding.ts).
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAVICON,
  faviconLink,
  faviconType,
  parseBrandingIndex,
  partnerLogoPath,
} from '../app/utils/branding';
import {
  BRANDING_CONTENT_TYPES,
  BRANDING_INDEX_TTL_MS,
  type BrandingDirEntry,
  brandingContentType,
  brandingEtag,
  brandingIndexFiles,
  createBrandingIndex,
  etagMatches,
  isBrandingFileName,
  isPathInside,
  resolveBrandingFile,
} from '../server/utils/branding';

const DIR = '/data/branding';

describe('branding file names', () => {
  it('accepts lower-case single segments with an image extension', () => {
    for (const name of [
      'hero.png',
      'hero.jpg',
      'hero.jpeg',
      'hero.webp',
      'hero.avif',
      'logo.svg',
      'favicon.ico',
      'aurora-hero_2026.v2.png',
      '1.png',
      `${'a'.repeat(96)}.png`, // 100 characters
    ]) {
      expect(isBrandingFileName(name), name).toBe(true);
    }
  });

  it('rejects traversal, hidden files, other characters and other extensions', () => {
    for (const name of [
      '',
      '..',
      '../hero.png',
      'a/../hero.png',
      'hero..png',
      '..png',
      '.hero.png',
      '.png',
      'Hero.png',
      'hero.PNG',
      'hero image.png',
      'hero%2epng',
      'sub/hero.png',
      'sub\\hero.png',
      '-hero.png',
      'hero',
      'hero.',
      'hero.gif',
      'hero.html',
      'hero.svgz',
      'hero.png.txt',
      `${'a'.repeat(97)}.png`, // 101 characters
    ]) {
      expect(isBrandingFileName(name), name).toBe(false);
    }
  });

  it('maps each allowed extension to its image content type', () => {
    expect(brandingContentType('hero.png')).toBe('image/png');
    expect(brandingContentType('hero.jpg')).toBe('image/jpeg');
    expect(brandingContentType('hero.jpeg')).toBe('image/jpeg');
    expect(brandingContentType('hero.webp')).toBe('image/webp');
    expect(brandingContentType('hero.avif')).toBe('image/avif');
    expect(brandingContentType('logo.svg')).toBe('image/svg+xml');
    expect(brandingContentType('favicon.ico')).toBe('image/x-icon');
    expect(Object.keys(BRANDING_CONTENT_TYPES).sort()).toEqual([
      'avif',
      'ico',
      'jpeg',
      'jpg',
      'png',
      'svg',
      'webp',
    ]);
    expect(brandingContentType('hero.gif')).toBeUndefined();
    expect(brandingContentType('../hero.png')).toBeUndefined();
  });
});

describe('path containment', () => {
  it('accepts files strictly inside the directory', () => {
    expect(isPathInside(DIR, path.join(DIR, 'hero.png'))).toBe(true);
    expect(isPathInside(`${DIR}/`, path.join(DIR, 'hero.png'))).toBe(true);
  });

  it('rejects the directory itself, its parents and sibling prefixes', () => {
    expect(isPathInside(DIR, DIR)).toBe(false);
    expect(isPathInside(DIR, path.join(DIR, '..', 'secret.png'))).toBe(false);
    expect(isPathInside(DIR, path.join(DIR, '../../etc/passwd'))).toBe(false);
    expect(isPathInside(DIR, '/data/branding-evil/hero.png')).toBe(false);
    expect(isPathInside(DIR, '/etc/passwd')).toBe(false);
  });

  it('resolves only allowed names inside a configured directory', () => {
    expect(resolveBrandingFile(DIR, 'hero.png')).toBe(path.resolve(DIR, 'hero.png'));
    expect(resolveBrandingFile('', 'hero.png')).toBeUndefined();
    expect(resolveBrandingFile(DIR, '..')).toBeUndefined();
    expect(resolveBrandingFile(DIR, '../branding-evil/hero.png')).toBeUndefined();
    expect(resolveBrandingFile(DIR, '.env')).toBeUndefined();
  });
});

describe('caching', () => {
  it('derives a weak etag from size and modification time', () => {
    const etag = brandingEtag(1234, 1_760_000_000_123.7);
    expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(brandingEtag(1234, 1_760_000_000_123.7)).toBe(etag);
    expect(brandingEtag(1235, 1_760_000_000_123.7)).not.toBe(etag);
    expect(brandingEtag(1234, 1_760_000_000_124)).not.toBe(etag);
  });

  it('matches If-None-Match with weak comparison', () => {
    const etag = brandingEtag(10, 20);
    expect(etagMatches(etag, etag)).toBe(true);
    expect(etagMatches(etag.replace(/^W\//, ''), etag)).toBe(true);
    expect(etagMatches(`W/"other", ${etag}`, etag)).toBe(true);
    expect(etagMatches('*', etag)).toBe(true);
    expect(etagMatches(undefined, etag)).toBe(false);
    expect(etagMatches('', etag)).toBe(false);
    expect(etagMatches('W/"other"', etag)).toBe(false);
  });
});

describe('index of the branding directory (/branding/index.json)', () => {
  const file = (name: string): BrandingDirEntry => ({ name, isFile: true });

  it('lists only regular files whose names pass the rule, sorted', () => {
    expect(
      brandingIndexFiles([
        file('partner-uice.svg'),
        file('favicon.svg'),
        file('.secret.png'),
        file('Hero.png'),
        file('notes.txt'),
        file('index.json'),
        file('README.md'),
        { name: 'dir.png', isFile: false },
        file('partner-ude.png'),
      ]),
    ).toEqual(['favicon.svg', 'partner-ude.png', 'partner-uice.svg']);
  });

  it('is off (undefined, answered 404) when no directory is configured', () => {
    const readDir = vi.fn(async () => [file('hero.png')]);
    expect(createBrandingIndex(readDir).list('')).toBeUndefined();
    expect(readDir).not.toHaveBeenCalled();
  });

  it('reads the directory at most once per minute and shares concurrent reads', async () => {
    let clock = 1_000_000;
    let entries = [file('hero.png')];
    const readDir = vi.fn(async () => entries);
    const index = createBrandingIndex(readDir, { now: () => clock });

    const [a, b] = await Promise.all([index.list(DIR), index.list(DIR)]);
    expect(a).toEqual(['hero.png']);
    expect(b).toEqual(['hero.png']);
    expect(readDir).toHaveBeenCalledTimes(1);
    expect(readDir).toHaveBeenCalledWith(DIR);

    entries = [file('hero.png'), file('partner-uice.svg')];
    clock += BRANDING_INDEX_TTL_MS - 1;
    expect(await index.list(DIR)).toEqual(['hero.png']);
    expect(readDir).toHaveBeenCalledTimes(1);

    clock += 1;
    expect(await index.list(DIR)).toEqual(['hero.png', 'partner-uice.svg']);
    expect(readDir).toHaveBeenCalledTimes(2);
    expect(BRANDING_INDEX_TTL_MS).toBe(60_000);
  });

  it('lists no files when the directory cannot be read, and retries later', async () => {
    let clock = 0;
    const readDir = vi
      .fn<(dir: string) => Promise<BrandingDirEntry[]>>()
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      .mockResolvedValue([file('hero.png')]);
    const index = createBrandingIndex(readDir, { now: () => clock });
    expect(await index.list(DIR)).toEqual([]);
    clock += BRANDING_INDEX_TTL_MS;
    expect(await index.list(DIR)).toEqual(['hero.png']);
  });

  it('keeps one cache entry per directory', async () => {
    const readDir = vi.fn(async (dir: string) => [file(dir === DIR ? 'a.png' : 'b.png')]);
    const index = createBrandingIndex(readDir);
    expect(await index.list(DIR)).toEqual(['a.png']);
    expect(await index.list('/other')).toEqual(['b.png']);
    expect(readDir).toHaveBeenCalledTimes(2);
  });
});

describe('partner logos (app side)', () => {
  it('reads the file list of an index body and ignores anything else', () => {
    expect(parseBrandingIndex({ files: ['a.png', 7, 'b.svg'] })).toEqual(['a.png', 'b.svg']);
    expect(parseBrandingIndex({ files: 'a.png' })).toEqual([]);
    expect(parseBrandingIndex(null)).toEqual([]);
    expect(parseBrandingIndex('<html>')).toEqual([]);
  });

  it('picks partner-<slug>.svg, then .png, then .webp', () => {
    const files = ['partner-uice.png', 'partner-uice.svg', 'partner-ude.webp', 'partner-x.jpg'];
    expect(partnerLogoPath(files, 'uice')).toBe('/branding/partner-uice.svg');
    expect(partnerLogoPath(files, 'ude')).toBe('/branding/partner-ude.webp');
    expect(partnerLogoPath(files, 'x')).toBeUndefined();
    expect(partnerLogoPath(files, 'uva')).toBeUndefined();
    expect(partnerLogoPath(files, '')).toBeUndefined();
    expect(partnerLogoPath([], 'uice')).toBeUndefined();
  });
});

describe('favicon link', () => {
  it('uses the portal favicon when none is configured', () => {
    expect(DEFAULT_FAVICON).toBe('/favicon.svg');
    for (const configured of [undefined, '', '  ']) {
      expect(faviconLink(configured)).toEqual({
        key: 'icon',
        rel: 'icon',
        href: '/favicon.svg',
        type: 'image/svg+xml',
      });
    }
  });

  it('types the configured icon by its extension', () => {
    expect(faviconLink('/branding/favicon.png')).toMatchObject({
      href: '/branding/favicon.png',
      type: 'image/png',
    });
    expect(faviconType('/branding/favicon.ico')).toBe('image/x-icon');
    expect(faviconType('https://cdn.example.eu/a/icon.SVG?v=2#x')).toBe('image/svg+xml');
    expect(faviconType('/branding/icon.webp')).toBe('image/webp');
    expect(faviconType('https://cdn.example.eu/icon')).toBeUndefined();
    expect(faviconLink('https://cdn.example.eu/icon')).toEqual({
      key: 'icon',
      rel: 'icon',
      href: 'https://cdn.example.eu/icon',
    });
  });
});

describe('legal page texts (privacy.<lang>.md, accessibility.<lang>.md)', () => {
  it('serves the two Markdown names for 2-3 letter languages as UTF-8 Markdown', () => {
    for (const name of [
      'privacy.en.md',
      'privacy.ca.md',
      'privacy.fil.md',
      'accessibility.en.md',
      'accessibility.es.md',
      'accessibility.fil.md',
    ]) {
      expect(isBrandingFileName(name), name).toBe(true);
      expect(brandingContentType(name), name).toBe('text/markdown; charset=utf-8');
      expect(resolveBrandingFile(DIR, name), name).toBe(path.resolve(DIR, name));
    }
  });

  it('rejects other names, languages and extensions', () => {
    for (const name of [
      'privacy.html',
      'privacy.md',
      'privacy.en.html',
      'privacy.en.md.txt',
      'privacy.e.md',
      'privacy.engl.md',
      'privacy.EN.md',
      'privacy.en-gb.md',
      'privacy.en.MD',
      'cookies.en.md',
      'README.md',
      'notes.en.md',
      '.privacy.en.md',
      '../privacy.en.md',
      'a/privacy.en.md',
      'privacy..md',
      'privacy.en..md',
      'privacy.1a.md',
    ]) {
      expect(isBrandingFileName(name), name).toBe(false);
      expect(resolveBrandingFile(DIR, name), name).toBeUndefined();
    }
  });

  it('lists them in the index next to the images, and nothing else with .md', () => {
    const file = (name: string): BrandingDirEntry => ({ name, isFile: true });
    expect(
      brandingIndexFiles([
        file('privacy.en.md'),
        file('accessibility.ca.md'),
        file('privacy.html'),
        file('README.md'),
        file('hero.png'),
        { name: 'privacy.es.md', isFile: false },
      ]),
    ).toEqual(['accessibility.ca.md', 'hero.png', 'privacy.en.md']);
  });
});
