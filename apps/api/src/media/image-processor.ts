// SPDX-License-Identifier: EUPL-1.2
import { createHash } from 'node:crypto';
import {
  COURSE_IMAGE_MAX_BYTES,
  COURSE_IMAGE_MAX_PIXELS,
  COURSE_IMAGE_OUTPUT_MAX_BYTES,
  COURSE_IMAGE_VARIANTS,
  COURSE_IMAGE_WEBP_QUALITY,
  type CourseImageVariant,
  type ErrorCode,
} from '@oecp/schemas';
import sharp, { type Metadata } from 'sharp';
import { MEDIA_PROCESS_TIMEOUT_SECONDS } from './media.constants.js';

/** A refused image, with the stable code and the HTTP status of the admin API. */
export class MediaError extends Error {
  constructor(
    readonly code: Extract<ErrorCode, `oecp.media.${string}`>,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

/** The two re-encoded files of an image; `key` names both. */
export interface ProcessedImage {
  /** First 16 hex characters of the SHA-256 of `files.lg`. */
  key: string;
  /** Of the `lg` file. */
  width: number;
  height: number;
  files: Record<CourseImageVariant, Buffer>;
}

/** sharp formats accepted as input (JPEG, PNG, WebP), whatever the declared type. */
const INPUT_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

/**
 * Decodes an uploaded or fetched image and re-encodes it as WebP (decision 27):
 * the format is sniffed by sharp from the bytes (the declared content type is not
 * trusted); at most 5 MiB and 40 megapixels in; EXIF orientation applied, then
 * every metadata (EXIF, XMP, IPTC, ICC) dropped; `lg` fitted inside 1600×1600 and
 * `sm` inside 640×640, never upscaled, quality 80; each output at most 2 MiB.
 * Animated input keeps its first frame. The original is not kept.
 */
export async function processCourseImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > COURSE_IMAGE_MAX_BYTES) {
    throw new MediaError('oecp.media.too_large', 413, `${input.length} bytes`);
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: false }).metadata();
  } catch {
    throw new MediaError('oecp.media.unsupported_type', 415, 'Not a JPEG, PNG or WebP image');
  }
  const format = metadata.format as string | undefined;
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!format || !INPUT_FORMATS.has(format)) {
    throw new MediaError('oecp.media.unsupported_type', 415, `Format ${format ?? 'unknown'}`);
  }
  if (width < 1 || height < 1) {
    throw new MediaError('oecp.media.invalid_image', 422, 'Image has no dimensions');
  }
  if (width * height > COURSE_IMAGE_MAX_PIXELS) {
    throw new MediaError(
      'oecp.media.invalid_image',
      422,
      `${width}×${height} exceeds 40 megapixels`,
    );
  }

  const encode = async (box: number) =>
    sharp(input, { limitInputPixels: COURSE_IMAGE_MAX_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: box, height: box, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: COURSE_IMAGE_WEBP_QUALITY })
      .timeout({ seconds: MEDIA_PROCESS_TIMEOUT_SECONDS })
      .toBuffer({ resolveWithObject: true });
  let lg: Awaited<ReturnType<typeof encode>>;
  let sm: Awaited<ReturnType<typeof encode>>;
  try {
    lg = await encode(COURSE_IMAGE_VARIANTS.lg);
    sm = await encode(COURSE_IMAGE_VARIANTS.sm);
  } catch (error) {
    throw new MediaError(
      'oecp.media.invalid_image',
      422,
      `Image cannot be decoded: ${(error as Error).message}`,
    );
  }
  for (const out of [lg, sm]) {
    if (out.data.length > COURSE_IMAGE_OUTPUT_MAX_BYTES) {
      throw new MediaError(
        'oecp.media.invalid_image',
        422,
        `Re-encoded image of ${out.data.length} bytes exceeds 2 MiB`,
      );
    }
  }
  return {
    key: createHash('sha256').update(lg.data).digest('hex').slice(0, 16),
    width: lg.info.width,
    height: lg.info.height,
    files: { lg: lg.data, sm: sm.data },
  };
}
