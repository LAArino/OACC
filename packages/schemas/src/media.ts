// SPDX-License-Identifier: EUPL-1.2
/**
 * Course images (decision 27): one image per course, stored and served by OECP
 * (never an external link), re-encoded as two WebP files: `lg` fitted inside
 * 1600×1600 and `sm` fitted inside 640×640, never upscaled, metadata stripped.
 * The alternative text is mandatory unless the image is decorative; the credit
 * is free text. The harvester never sets or changes an image (OEAPI v5 has none):
 * images come from the web form (`PUT /api/admin/v1/courses/{id}/image`) or from
 * CSV template 1.3 (`image_url`, fetched by the worker).
 *
 * Browser-safe (Zod only). Issue messages are stable error codes.
 */
import { z } from 'zod';
import { isoDateTime, uuid } from './primitives.js';

/** Upload and fetch limit (bytes), checked before the body is buffered. */
export const COURSE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Decoded pixels of an input image (width × height). */
export const COURSE_IMAGE_MAX_PIXELS = 40_000_000;
/** Largest re-encoded file (bytes). */
export const COURSE_IMAGE_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
/** Accepted input types, sniffed from the content (the declared type is not trusted). */
export const COURSE_IMAGE_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Bounding boxes of the two variants (pixels). */
export const COURSE_IMAGE_VARIANTS = { lg: 1600, sm: 640 } as const;
export type CourseImageVariant = keyof typeof COURSE_IMAGE_VARIANTS;
/** WebP quality of both variants. */
export const COURSE_IMAGE_WEBP_QUALITY = 80;
export const COURSE_IMAGE_ALT_MAX = 300;
export const COURSE_IMAGE_CREDIT_MAX = 300;
export const COURSE_IMAGE_SOURCE_URL_MAX = 2048;
/** First 16 hex characters of the SHA-256 of the `lg` file. */
export const COURSE_IMAGE_KEY_PATTERN = /^[0-9a-f]{16}$/;
/** File names under `/media/courses/{courseId}/`. */
export const COURSE_IMAGE_FILE_PATTERN = /^[0-9a-f]{16}\.(lg|sm)\.webp$/;

/** Path of a variant on the portal origin: `/media/courses/<id>/<key>.<variant>.webp`. */
export function courseImagePath(
  courseId: string,
  key: string,
  variant: CourseImageVariant,
): string {
  return `/media/courses/${courseId}/${key}.${variant}.webp`;
}

/** Alternative texts keyed by primary language subtag; each 1–300 characters after trimming. */
export const courseImageAlt = z.record(
  z.string().regex(/^[a-z]{2,3}$/, { error: 'oecp.content.unsupported_language' }),
  z.string().trim().min(1).max(COURSE_IMAGE_ALT_MAX),
);
export type CourseImageAlt = z.infer<typeof courseImageAlt>;

/** Image credit (photographer, licence…); trimmed, empty → null. */
const credit = z
  .string()
  .max(COURSE_IMAGE_CREDIT_MAX)
  .nullable()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : null;
  });

/** The image of a course as stored (admin course record, `PUT`/`PATCH …/image`). */
export const courseImage = z.strictObject({
  /** First 16 hex characters of the SHA-256 of the `lg` file; names both files. */
  key: z.string().regex(COURSE_IMAGE_KEY_PATTERN),
  /** Keyed by primary language subtag; contains `en` unless `decorative`. */
  alt: z.record(z.string(), z.string()),
  /** Purely decorative: rendered with an empty alternative text. */
  decorative: z.boolean(),
  credit: z.string().nullable(),
  /** Of the `lg` file. */
  width: z.int().min(1),
  height: z.int().min(1),
  /** The CSV `image_url` the image was fetched from; null for an uploaded file. */
  source_url: z.string().nullable(),
  updated_at: isoDateTime,
});
export type CourseImage = z.infer<typeof courseImage>;

/** The image on the public course card and page (paths on the portal origin). */
export const publicCourseImage = z.strictObject({
  /** `lg` file, `/media/courses/<id>/<key>.lg.webp`. */
  url: z.string(),
  /** `sm` file, `/media/courses/<id>/<key>.sm.webp`. */
  thumbnail_url: z.string(),
  alt: z.record(z.string(), z.string()),
  decorative: z.boolean(),
  credit: z.string().nullable(),
  /** Of the `lg` file. */
  width: z.int().min(1),
  height: z.int().min(1),
});
export type PublicCourseImage = z.infer<typeof publicCourseImage>;

/**
 * Text parts of `PUT /courses/{id}/image` (`multipart/form-data`, next to the
 * `file` part): `alt_en` is required unless `decorative` is `true`.
 */
export const courseImageUploadFields = z
  .object({
    alt_en: z.string().max(COURSE_IMAGE_ALT_MAX).optional(),
    decorative: z.enum(['true', 'false']).default('false'),
    credit: z.string().max(COURSE_IMAGE_CREDIT_MAX).optional(),
  })
  .transform((f) => {
    const alt = f.alt_en?.trim();
    const creditText = f.credit?.trim();
    return {
      alt: alt ? { en: alt } : ({} as Record<string, string>),
      decorative: f.decorative === 'true',
      credit: creditText ? creditText : null,
    };
  })
  .superRefine((f, ctx) => {
    if (!f.decorative && !f.alt['en']) {
      ctx.addIssue({ code: 'custom', path: ['alt_en'], message: 'oecp.media.alt_required' });
    }
  });
export type CourseImageUploadFields = z.output<typeof courseImageUploadFields>;

/**
 * `PATCH /courses/{id}/image`: metadata only. `alt` replaces the whole map; the
 * result must still be decorative or have an English text.
 */
export const courseImagePatch = z
  .strictObject({
    alt: courseImageAlt.optional(),
    decorative: z.boolean().optional(),
    credit: credit.optional(),
  })
  .refine((p) => p.alt !== undefined || p.decorative !== undefined || p.credit !== undefined, {
    error: 'oecp.request.validation_failed',
  });
export type CourseImagePatch = z.input<typeof courseImagePatch>;
export type CourseImagePatchValue = z.output<typeof courseImagePatch>;

/** Whether an image's metadata satisfies the alternative-text rule (DDL CHECK of 0008). */
export function courseImageAltSatisfied(image: {
  decorative: boolean;
  alt: Readonly<Record<string, string>>;
}): boolean {
  return image.decorative || Boolean(image.alt['en']);
}

/** The public image object of a stored image. */
export function toPublicCourseImage(
  courseId: string,
  image: Pick<CourseImage, 'key' | 'alt' | 'decorative' | 'credit' | 'width' | 'height'>,
  base = '',
): PublicCourseImage {
  return {
    url: base + courseImagePath(courseId, image.key, 'lg'),
    thumbnail_url: base + courseImagePath(courseId, image.key, 'sm'),
    alt: image.alt,
    decorative: image.decorative,
    credit: image.credit,
    width: image.width,
    height: image.height,
  };
}

/** Job data of the worker's `media` queue (CSV `image_url` fetch). */
export const courseImageFetchJob = z.strictObject({
  courseId: uuid,
  syncRunId: uuid,
  /** Course code and `courses.csv` row, for the sync error of a failed fetch. */
  extId: z.string().min(1).max(200),
  row: z.int().min(2).optional(),
  url: z.string().max(COURSE_IMAGE_SOURCE_URL_MAX),
  alt: courseImageAlt,
  decorative: z.boolean(),
  credit: z.string().max(COURSE_IMAGE_CREDIT_MAX).nullable(),
});
export type CourseImageFetchJob = z.infer<typeof courseImageFetchJob>;
