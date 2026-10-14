// SPDX-License-Identifier: EUPL-1.2
/** Pure mapping of catalogue rows to the `/api/public/v1` contract (public-responses.ts). */
import type {
  CourseLevel,
  CourseSearchResponse,
  NormalizedCourseSearch,
  PublicCourseCard,
  PublicCourseDetail,
  PublicCourseText,
  PublicDeliveryMode,
  PublicIscedField,
  ReferenceResponse,
} from '@oecp/schemas';
import { courseLevel } from '@oecp/schemas';
import type {
  CardOfferingRow,
  CourseDetailRows,
  IscedRow,
  ModeRef,
  ReferenceRows,
  SearchResultRows,
} from './catalogue.repository.js';

/** Maximum length of a card abstract, ellipsis included. */
export const ABSTRACT_MAX = 300;

/**
 * Shortens `text` to at most `max` characters, at a word boundary when one lies in
 * the last third, ending with `…`. Whitespace runs collapse to one space.
 */
export function truncate(text: string, max = ABSTRACT_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const chars = [...clean];
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  const head = space >= Math.floor(((max - 1) * 2) / 3) ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s.,;:!?-]+$/u, '')}…`;
}

const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const toNumber = (v: string | null): number | null => (v === null ? null : Number(v));
const primary = (tag: string): string => tag.split('-')[0]!.toLowerCase();
const asLevel = (v: string | null): CourseLevel | null =>
  courseLevel.safeParse(v).success ? (v as CourseLevel) : null;

function publicMode(m: ModeRef): PublicDeliveryMode {
  return { code: m.code, label: m.label, schema_org: m.schema_org };
}

/** Distinct broad fields in row order (primary first). */
function broadFields(rows: IscedRow[]): PublicIscedField[] {
  const seen = new Map<string, PublicIscedField>();
  for (const r of rows)
    if (!seen.has(r.broad_code)) seen.set(r.broad_code, { code: r.broad_code, label: r.label });
  return [...seen.values()];
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Whether an upcoming offering satisfies the `mode`/`lang` filters of the request. */
function matchesOfferingFilters(o: CardOfferingRow, search: NormalizedCourseSearch): boolean {
  if (search.mode.length && !o.modes.some((m) => search.mode.includes(m.code))) return false;
  if (search.lang.length && !o.teaching_languages.some((t) => search.lang.includes(primary(t)))) {
    return false;
  }
  return true;
}

export function toSearchResponse(
  rows: SearchResultRows,
  search: NormalizedCourseSearch,
): CourseSearchResponse {
  const courses = new Map(rows.courses.map((c) => [c.id, c]));
  const texts = groupBy(rows.texts, (t) => t.course_id);
  const isced = groupBy(rows.isced, (i) => i.course_id);
  const offerings = groupBy(rows.offerings, (o) => o.course_id);

  const items: PublicCourseCard[] = [];
  for (const id of rows.ids) {
    const c = courses.get(id);
    if (!c) continue; // deleted between the page query and hydration
    const own = texts.get(id) ?? [];
    const local = own.find((t) => t.lang === search.locale);
    const en = own.find((t) => t.lang === 'en');
    const titleRow = local ?? en ?? own[0];
    const abstractRow = local?.abstract ? local : en?.abstract ? en : null;
    const upcoming = offerings.get(id) ?? [];
    const modes = new Map<string, number>();
    const languages = new Set<string>();
    for (const o of upcoming) {
      for (const m of o.modes) modes.set(m.code, m.sort_order);
      for (const t of o.teaching_languages) languages.add(primary(t));
    }
    const next = upcoming.find((o) => matchesOfferingFilters(o, search)) ?? null;
    items.push({
      id,
      ext_id: c.ext_id,
      organization: {
        id: c.org_id,
        slug: c.org_slug,
        name: c.org_name,
        country_code: c.org_country_code,
      },
      title: titleRow?.title ?? c.ext_id,
      title_lang: titleRow?.lang ?? 'en',
      abstract: abstractRow?.abstract ? truncate(abstractRow.abstract) : null,
      abstract_lang: abstractRow?.lang ?? null,
      ects: Number(c.ects),
      level: asLevel(c.level),
      isced_broad_fields: broadFields(isced.get(id) ?? []),
      delivery_modes: [...modes.entries()]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([code]) => code),
      teaching_languages: [...languages].sort(),
      next_offering: next && {
        id: next.id,
        start_date: next.start_date,
        end_date: next.end_date,
        application_deadline: next.application_deadline,
        enrol_start_date: next.enrol_start_date,
        timezone: next.timezone,
        seats_available: next.seats_available,
        alliance_seats: next.alliance_seats,
        seats_updated_at: toIso(next.seats_updated_at),
      },
      offerings_count: upcoming.length,
    });
  }
  return {
    items,
    page: search.page,
    page_size: search.pageSize,
    total: rows.total,
    facets: rows.facets,
  };
}

export function toCourseDetail(rows: CourseDetailRows): PublicCourseDetail {
  const { course: c } = rows;
  const texts: Record<string, PublicCourseText> = {};
  for (const t of rows.texts) {
    texts[t.lang] = {
      title: t.title,
      abstract: t.abstract,
      description: t.description,
      learning_outcomes: t.learning_outcomes,
      prerequisites: t.prerequisites,
      assessment: t.assessment,
      keywords: t.keywords,
      is_machine_translated: t.is_machine_translated,
    };
  }
  const stamps = [
    c.updated_at,
    ...rows.texts.map((t) => t.updated_at),
    ...rows.offerings.map((o) => o.updated_at),
  ];
  const updated = new Date(Math.max(...stamps.map((d) => d.getTime())));
  return {
    id: c.id,
    ext_id: c.ext_id,
    organization: {
      id: c.org_id,
      slug: c.org_slug,
      name: c.org_name,
      country_code: c.org_country_code,
      logo_url: c.org_logo_url,
      website_url: c.org_website_url,
    },
    teaching_unit:
      c.unit_id && c.unit_slug && c.unit_name
        ? { id: c.unit_id, slug: c.unit_slug, name: c.unit_name }
        : null,
    ects: Number(c.ects),
    level: asLevel(c.level),
    eqf_level: c.eqf_level,
    teaching_hours: toNumber(c.teaching_hours),
    info_url: c.info_url,
    contact_email: c.contact_email ?? c.org_contact_email,
    texts,
    isced_codes: rows.isced.map((i) => ({
      code: i.isced_code,
      broad_code: i.broad_code,
      is_primary: i.is_primary,
      label: i.label,
    })),
    offerings: rows.offerings.map((o) => ({
      id: o.id,
      ext_offering_id: o.ext_offering_id,
      status: o.status,
      academic_session:
        o.session_id && o.session_name && o.session_start_date && o.session_end_date
          ? {
              id: o.session_id,
              name: o.session_name,
              start_date: o.session_start_date,
              end_date: o.session_end_date,
            }
          : null,
      start_date: o.start_date,
      end_date: o.end_date,
      enrol_start_date: o.enrol_start_date,
      application_deadline: o.application_deadline,
      timezone: o.timezone,
      teaching_languages: o.teaching_languages,
      delivery_modes: o.modes.map((m) => m.code),
      campus: o.campus,
      max_students: o.max_students,
      alliance_seats: o.alliance_seats,
      seats_available: o.seats_available,
      seats_updated_at: toIso(o.seats_updated_at),
      application_url: o.application_url,
    })),
    updated_at: updated.toISOString(),
  };
}

export function toReference(rows: ReferenceRows): ReferenceResponse {
  return {
    organizations: rows.organizations.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      country_code: o.country_code,
      logo_url: o.logo_url,
      website_url: o.website_url,
      org_type: o.org_type,
      is_partner: o.is_partner,
      parent_id: o.parent_id,
    })),
    delivery_modes: rows.modes.map(publicMode),
    isced_broad_fields: rows.isced.map((i) => ({ code: i.code, label: i.label })),
    teaching_languages: rows.languages,
    levels: [...courseLevel.options],
  };
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]!);

/** sitemaps.org 0.9 document of the English course pages. */
export function toSitemap(baseUrl: string, rows: { id: string; lastmod: Date }[]): string {
  const urls = rows.map(
    (r) =>
      `  <url><loc>${xml(`${baseUrl}/en/courses/${r.id}`)}</loc><lastmod>${r.lastmod.toISOString()}</lastmod></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
