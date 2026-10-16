// SPDX-License-Identifier: EUPL-1.2
// schema.org/Course structured data for the course page (spec §7 "JSON-LD").
import type { CourseDetail, CourseTexts } from '../types/catalogue';
import { courseInstructors, courseLevels, labelText, safeHttpUrl } from './catalogue';
import { absoluteUrl } from './courseImage';
import { pickLocalized } from './localized';

/**
 * Fallback schema.org `courseMode` per delivery mode code, used when `/reference`
 * does not provide `delivery_modes[].schema_org`; unknown codes are passed
 * through as text (allowed by schema.org).
 */
const COURSE_MODE: Readonly<Record<string, string>> = {
  presential: 'Onsite',
  onsite: 'Onsite',
  on_campus: 'Onsite',
  online: 'Online',
  coil: 'Online',
  hybrid: 'Blended',
  blended: 'Blended',
};

export interface CourseJsonLdOptions {
  /**
   * Absolute canonical URL of the course page; its origin also makes the course
   * image absolute (the `og:image` rule: the i18n base URL, else the request's).
   */
  url: string;
  locale: string;
  /** `delivery_modes.schema_org` per code, from `/reference`, when available. */
  courseModes?: Readonly<Record<string, string | undefined>>;
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length),
    ),
  ) as Partial<T>;
}

export function courseJsonLd(
  course: CourseDetail,
  options: CourseJsonLdOptions,
): Record<string, unknown> {
  const text: CourseTexts | undefined = pickLocalized(course.texts, options.locale)?.value;
  const languages = [...new Set(course.offerings.flatMap((o) => o.teaching_languages))];
  const levels = courseLevels(course);
  // schema.org puts `instructor` on CourseInstance; the names are the ones the
  // course page already shows, so every instance carries them.
  const instructors = courseInstructors(course).map((name) => ({ '@type': 'Person', name }));
  const provider = compact({
    '@type': 'CollegeOrUniversity',
    name: labelText(course.organization.name, options.locale),
    address: course.organization.country_code
      ? { '@type': 'PostalAddress', addressCountry: course.organization.country_code }
      : undefined,
  });
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: text?.title,
    description: text?.abstract ?? text?.description ?? undefined,
    courseCode: course.ext_id,
    url: options.url,
    sameAs: safeHttpUrl(course.info_url),
    image: imageUrl(course, options.url),
    inLanguage: languages,
    provider,
    numberOfCredits: { '@type': 'StructuredValue', value: course.ects, unitText: 'ECTS' },
    educationalLevel: levels.length > 1 ? levels : levels[0],
    about: course.isced_codes
      .map((c) => labelText(c.label, options.locale))
      .filter((l): l is string => !!l),
    teaches: text?.learning_outcomes ?? undefined,
    coursePrerequisites: text?.prerequisites ?? undefined,
    keywords: text?.keywords.length ? text.keywords.join(', ') : undefined,
    dateModified: course.updated_at,
    hasCourseInstance: course.offerings
      .filter((o) => o.status !== 'cancelled')
      .map((o) =>
        compact({
          '@type': 'CourseInstance',
          courseMode: [
            ...new Set(
              o.delivery_modes.map((m) => options.courseModes?.[m] ?? COURSE_MODE[m] ?? m),
            ),
          ],
          startDate: o.start_date,
          endDate: o.end_date,
          inLanguage: o.teaching_languages,
          location: o.campus ? { '@type': 'Place', name: o.campus } : undefined,
          instructor: instructors,
          url: safeHttpUrl(o.application_url),
        }),
      ),
  });
}

/** The course image's lg file as an absolute URL on the canonical URL's origin [DL 27]. */
function imageUrl(course: CourseDetail, pageUrl: string): string | undefined {
  const src = course.image?.url;
  if (!src) return undefined;
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return undefined;
  }
  return absoluteUrl(src, origin);
}

/** JSON for an inline `<script type="application/ld+json">`: `<` escaped so it cannot close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
