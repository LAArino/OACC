// SPDX-License-Identifier: EUPL-1.2
// Branding files served at /branding/<name> (server/utils/branding.ts).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRANDING_CONTENT_TYPES,
  brandingContentType,
  brandingEtag,
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
