// SPDX-License-Identifier: EUPL-1.2
import { z } from 'zod';

/** DDL domain `language_tag`. */
export const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
/** ISCED-F 2013 code at 2, 3, 4 (or detailed up to 6) digits. */
export const ISCED_CODE_PATTERN = /^\d{2,6}$/;
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const HTTPS_URL_PATTERN = /^https:\/\/[^\s/?#]+[^\s]*$/;
export const SLUG_PATTERN = /^[a-z0-9-]{2,40}$/;
export const DELIVERY_MODE_CODE_PATTERN = /^(x-)?[a-z][a-z0-9_-]*$/;
/** Course and offering codes as accepted in CSV template 1.0. */
export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const IANA_TZ_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

function isWellFormedBcp47(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

function isIanaTimeZone(tz: string): boolean {
  if (!IANA_TZ_PATTERN.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** BCP 47 tag, restricted to the DDL `language_tag` shape (lower-case primary subtag). */
export const languageTag = z
  .string()
  .regex(LANGUAGE_TAG_PATTERN)
  .refine(isWellFormedBcp47, { message: 'Not a well-formed BCP 47 tag' });

/** Primary language subtag only, as used to key `course_texts`. */
export const primaryLanguage = z.string().regex(/^[a-z]{2,3}$/);

/** Short label map `{bcp47: text}` that MUST contain `en`. */
export const localizedLabel = z
  .object({ en: z.string().min(1) })
  .catchall(z.string().min(1))
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (!LANGUAGE_TAG_PATTERN.test(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Invalid language tag key' });
      }
    }
  });
export type LocalizedLabel = z.infer<typeof localizedLabel>;

export const iscedCode = z.string().regex(ISCED_CODE_PATTERN);
export const uuid = z.uuid();
export const slug = z.string().regex(SLUG_PATTERN);
export const httpsUrl = z.string().max(2048).regex(HTTPS_URL_PATTERN);
export const email = z.string().max(320).regex(EMAIL_PATTERN);
/** Calendar date `YYYY-MM-DD`, local to the offering time zone. */
export const isoDate = z.iso.date();
export const isoDateTime = z.iso.datetime({ offset: true });
export const ianaTimeZone = z
  .string()
  .regex(IANA_TZ_PATTERN)
  .refine(isIanaTimeZone, { message: 'Unknown IANA time zone' });
export const deliveryModeCode = z.string().regex(DELIVERY_MODE_CODE_PATTERN);
export const extId = z.string().min(1).max(200);
