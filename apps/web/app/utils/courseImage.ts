// SPDX-License-Identifier: EUPL-1.2
// Course images on the public pages [DL 27]: alternative text (none when the
// image is decorative), the size of the thumbnail and absolute URLs for link
// previews (`og:image`). The API sends paths on the portal origin.
import type { CourseImage } from '../types/catalogue';
import { pickLocalized } from './localized';

/** Longest side of the thumbnail file (`*.sm.webp`); `width`/`height` are the lg file's. */
const THUMBNAIL_MAX = 640;

/**
 * Alternative text of a course image in the page locale (English fallback), with
 * its language; empty for a decorative image (or, defensively, one without text).
 */
export function courseImageAlt(
  image: CourseImage,
  locale: string,
): { text: string; lang: string | undefined } {
  if (image.decorative) return { text: '', lang: undefined };
  const picked = pickLocalized(image.alt, locale);
  const text = picked?.value.trim() ?? '';
  return { text, lang: text && picked!.lang !== locale ? picked!.lang : undefined };
}

/** Pixel size of the thumbnail: the lg size fitted inside 640×640 (never upscaled). */
export function courseThumbnailSize(image: CourseImage): { width: number; height: number } {
  const scale = Math.min(1, THUMBNAIL_MAX / Math.max(image.width, image.height, 1));
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

/** `src` made absolute on `origin` (kept as is when already an http(s) URL). */
export function absoluteUrl(src: string, origin: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${origin.replace(/\/$/, '')}${src.startsWith('/') ? '' : '/'}${src}`;
}
