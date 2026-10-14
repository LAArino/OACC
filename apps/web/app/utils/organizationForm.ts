// SPDX-License-Identifier: EUPL-1.2
// Organization form (spec §2.1 step 1, §8): form state ↔ `OrganizationInput`
// and the client-side checks mirroring the DDL and the canonical schema.
import {
  EMAIL_PATTERN,
  HTTPS_URL_PATTERN,
  LANGUAGE_TAG_PATTERN,
  SLUG_PATTERN,
} from '@oecp/schemas';
import type { AdminOrganizationInput, AdminOrganizationRecord } from '~/types/admin';
import type { FormIssue } from './adminCourseForm';
import { isTimeZone } from './adminCourseForm';
import { isIdpAlias } from './invitation';

export const ORG_TYPES = [
  'alliance',
  'institution',
  'faculty',
  'department',
  'campus',
  'other',
] as const satisfies readonly AdminOrganizationRecord['org_type'][];

export interface OrganizationNameRow {
  lang: string;
  text: string;
}

export interface OrganizationForm {
  slug: string;
  org_type: AdminOrganizationRecord['org_type'];
  is_partner: boolean;
  /** '' = top level. */
  parent_id: string;
  /** English first (required), then other languages. */
  names: OrganizationNameRow[];
  country_code: string;
  schac_home_organization: string;
  keycloak_idp_alias: string;
  contact_email: string;
  default_timezone: string;
  /** Comma-separated BCP 47 tags, e.g. `en, de`. */
  ui_languages: string;
  website_url: string;
  logo_url: string;
  erasmus_code: string;
  pic: string;
  ext_id: string;
}

export function emptyOrganizationForm(): OrganizationForm {
  return {
    slug: '',
    org_type: 'institution',
    is_partner: true,
    parent_id: '',
    names: [{ lang: 'en', text: '' }],
    country_code: '',
    schac_home_organization: '',
    keycloak_idp_alias: '',
    contact_email: '',
    default_timezone: 'Europe/Brussels',
    ui_languages: 'en',
    website_url: '',
    logo_url: '',
    erasmus_code: '',
    pic: '',
    ext_id: '',
  };
}

export function organizationFormOf(org: AdminOrganizationRecord): OrganizationForm {
  const names = [
    { lang: 'en', text: org.name.en ?? '' },
    ...Object.entries(org.name)
      .filter(([lang]) => lang !== 'en')
      .map(([lang, text]) => ({ lang, text })),
  ];
  const s = (v: string | null) => v ?? '';
  return {
    slug: org.slug,
    org_type: org.org_type,
    is_partner: org.is_partner,
    parent_id: s(org.parent_id),
    names,
    country_code: s(org.country_code),
    schac_home_organization: s(org.schac_home_organization),
    keycloak_idp_alias: s(org.keycloak_idp_alias),
    contact_email: s(org.contact_email),
    default_timezone: org.default_timezone,
    ui_languages: org.ui_languages.join(', '),
    website_url: s(org.website_url),
    logo_url: s(org.logo_url),
    erasmus_code: s(org.erasmus_code),
    pic: s(org.pic),
    ext_id: s(org.ext_id),
  };
}

/** Interface languages are primary language subtags (`en`, `de`), as the API stores them. */
const UI_LANGUAGE = /^[a-z]{2,3}$/;

export function parseLanguages(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

/** Form field name of a name row; row 0 is English. */
export const nameField = (index: number, part: 'lang' | 'text') => `names/${index}/${part}`;

/**
 * Client-side checks. Field names are the form's (`names/1/text` for name rows);
 * `code` is an `admin.organizations.validation.*` key.
 */
export function validateOrganizationForm(
  form: OrganizationForm,
  context: { creating: boolean; selfId?: string },
): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (field: string, code: string) => issues.push({ field, code });
  const opt = (value: string) => value.trim();

  if (context.creating && !SLUG_PATTERN.test(form.slug.trim())) add('slug', 'slug');
  if (!ORG_TYPES.includes(form.org_type)) add('org_type', 'required');
  if (form.parent_id && form.parent_id === context.selfId) add('parent_id', 'parentSelf');
  if (form.org_type === 'alliance' && form.is_partner) add('is_partner', 'alliancePartner');
  if (form.org_type === 'alliance' && form.parent_id) add('parent_id', 'allianceParent');

  const seen = new Set<string>();
  form.names.forEach((row, index) => {
    const lang = row.lang.trim();
    if (index === 0) {
      if (!row.text.trim()) add(nameField(0, 'text'), 'nameEnglish');
      seen.add('en');
      return;
    }
    if (!LANGUAGE_TAG_PATTERN.test(lang)) add(nameField(index, 'lang'), 'language');
    else if (seen.has(lang)) add(nameField(index, 'lang'), 'languageDuplicate');
    seen.add(lang);
    if (!row.text.trim()) add(nameField(index, 'text'), 'nameText');
  });

  if (opt(form.country_code) && !/^[A-Z]{2}$/.test(opt(form.country_code))) {
    add('country_code', 'countryCode');
  }
  if (opt(form.schac_home_organization).length > 253) add('schac_home_organization', 'tooLong');
  const alias = opt(form.keycloak_idp_alias);
  if (alias && !isIdpAlias(alias)) {
    add('keycloak_idp_alias', 'idpAlias');
  }
  const email = opt(form.contact_email);
  if (email && (email.length > 320 || !EMAIL_PATTERN.test(email))) add('contact_email', 'email');
  if (!isTimeZone(form.default_timezone)) add('default_timezone', 'timezone');
  const languages = parseLanguages(form.ui_languages);
  if (!languages.length) add('ui_languages', 'uiLanguagesRequired');
  else if (languages.length > 30 || !languages.every((l) => UI_LANGUAGE.test(l))) {
    add('ui_languages', 'uiLanguages');
  }
  for (const field of ['website_url', 'logo_url'] as const) {
    const url = opt(form[field]);
    if (url && (url.length > 2048 || !HTTPS_URL_PATTERN.test(url))) add(field, 'https');
  }
  if (opt(form.erasmus_code).length > 40) add('erasmus_code', 'tooLong');
  if (opt(form.pic) && !/^[0-9]{9}$/.test(opt(form.pic))) add('pic', 'pic');
  if (opt(form.ext_id).length > 200) add('ext_id', 'tooLong');
  return issues;
}

export function organizationBody(form: OrganizationForm): AdminOrganizationInput {
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
  const name: Record<string, string> = {};
  for (const row of form.names) {
    const lang = row.lang.trim();
    if (lang && row.text.trim()) name[lang] = row.text.trim();
  }
  return {
    slug: form.slug.trim(),
    org_type: form.org_type,
    is_partner: form.is_partner,
    parent_id: form.parent_id || null,
    name,
    country_code: orNull(form.country_code),
    schac_home_organization: orNull(form.schac_home_organization),
    keycloak_idp_alias: orNull(form.keycloak_idp_alias),
    contact_email: orNull(form.contact_email),
    default_timezone: form.default_timezone,
    ui_languages: parseLanguages(form.ui_languages),
    website_url: orNull(form.website_url),
    logo_url: orNull(form.logo_url),
    erasmus_code: orNull(form.erasmus_code),
    pic: orNull(form.pic),
    ext_id: orNull(form.ext_id),
  };
}

/** Form field of a server pointer (`/name/en` → the English name). */
export function organizationFieldOf(pointer: string, form: OrganizationForm): string {
  const parts = pointer.replace(/^\//, '').split('/');
  if (parts[0] === 'name') {
    const index = form.names.findIndex((row) => row.lang.trim() === (parts[1] ?? 'en'));
    return nameField(Math.max(0, index), 'text');
  }
  return parts[0] ?? '';
}

/** `admin.organizations.validation.*` key of a stable server code, if the page explains it. */
export const ORGANIZATION_SERVER_CODES: Readonly<Record<string, string>> = {
  'oecp.content.duplicate_slug': 'duplicateSlug',
  'oecp.content.slug_immutable': 'slugImmutable',
  'oecp.content.invalid_parent': 'invalidParent',
  'oecp.content.duplicate_identifier': 'duplicateIdentifier',
};

/** Ids of `org` and every organization below it (a parent must not be one of them). */
export function descendantIds(
  orgId: string,
  all: readonly Pick<AdminOrganizationRecord, 'id' | 'parent_id'>[],
): Set<string> {
  const out = new Set<string>([orgId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of all) {
      if (o.parent_id && out.has(o.parent_id) && !out.has(o.id)) {
        out.add(o.id);
        grew = true;
      }
    }
  }
  return out;
}

export function organizationDisplayName(org: { name: Record<string, string>; slug: string }) {
  return org.name.en || org.slug;
}

/** DOM id of a form field: `slug` → `org-slug`, `names/1/text` → `org-names-1-text`. */
export function organizationFieldId(field: string): string {
  return `org-${field.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

/**
 * Organizations as a tree, each followed by its sub-units (`— ` per level),
 * by English name; `exclude` drops those ids (an organization and its
 * descendants cannot be its own parent). Deleted organizations are left out.
 */
export function organizationTreeOptions(
  all: readonly AdminOrganizationRecord[],
  exclude: ReadonlySet<string> = new Set(),
): { value: string; label: string }[] {
  const live = all.filter((o) => !o.deleted_at && !exclude.has(o.id));
  const ids = new Set(live.map((o) => o.id));
  const byName = (a: AdminOrganizationRecord, b: AdminOrganizationRecord) =>
    organizationDisplayName(a).localeCompare(organizationDisplayName(b));
  const out: { value: string; label: string }[] = [];
  const visit = (org: AdminOrganizationRecord, depth: number) => {
    if (depth > 32) return;
    out.push({ value: org.id, label: `${'— '.repeat(depth)}${organizationDisplayName(org)}` });
    live
      .filter((o) => o.parent_id === org.id)
      .sort(byName)
      .forEach((child) => visit(child, depth + 1));
  };
  live
    .filter((o) => !o.parent_id || !ids.has(o.parent_id))
    .sort(byName)
    .forEach((org) => visit(org, 0));
  return out;
}
