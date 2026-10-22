// SPDX-License-Identifier: EUPL-1.2
/**
 * Organizations and their administrators (spec §2, §8): contracts of
 * `/api/admin/v1/organizations…` and `/api/admin/v1/organizations/{orgId}/admins…`.
 *
 * Browser-safe (Zod only). Issue messages are stable error codes where one exists.
 */
import { z } from 'zod';
import { adminRole, orgType } from './enums.js';
import {
  email,
  httpsUrl,
  ianaTimeZone,
  idpAlias,
  isoDateTime,
  localizedLabel,
  primaryLanguage,
  SLUG_PATTERN,
  uuid,
} from './primitives.js';

const optional = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

/**
 * `POST /api/admin/v1/organizations` and `PUT /api/admin/v1/organizations/{id}`
 * (alliance_admin). `PUT` is a full replace: optional members left out become
 * null. `slug` cannot change after creation (409 `oecp.content.slug_immutable`).
 *
 * Derived by the API, never sent: `partner_id` (a partner is its own partner;
 * a sub-unit inherits it from its parent), `id`, timestamps.
 */
export const organizationInput = z
  .strictObject({
    slug: z.string().regex(SLUG_PATTERN),
    org_type: orgType,
    is_partner: z.boolean(),
    parent_id: optional(uuid),
    /** Display name by BCP 47 tag; `en` is required. */
    name: localizedLabel,
    country_code: optional(z.string().regex(/^[A-Z]{2}$/)),
    /** Domain asserted by the partner IdP as `schacHomeOrganization`. */
    schac_home_organization: optional(z.string().min(1).max(253)),
    keycloak_idp_alias: optional(idpAlias),
    contact_email: optional(email),
    default_timezone: ianaTimeZone,
    /** Primary language subtags of the organization's interface languages, at least one. */
    ui_languages: z.array(primaryLanguage).min(1).max(30),
    website_url: optional(httpsUrl),
    logo_url: optional(httpsUrl),
    erasmus_code: optional(z.string().min(1).max(40)),
    pic: optional(z.string().regex(/^[0-9]{9}$/)),
    ext_id: optional(z.string().min(1).max(200)),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.ui_languages.forEach((lang, i) => {
      if (seen.has(lang)) {
        ctx.addIssue({ code: 'custom', path: ['ui_languages', i], message: 'Duplicate language' });
      }
      seen.add(lang);
    });
    if (v.org_type === 'alliance' && v.is_partner) {
      ctx.addIssue({
        code: 'custom',
        path: ['is_partner'],
        message: 'The alliance organization is not a partner',
      });
    }
    if (v.org_type === 'alliance' && v.parent_id !== null) {
      ctx.addIssue({ code: 'custom', path: ['parent_id'], message: 'oecp.content.invalid_parent' });
    }
  });
export type OrganizationInput = z.input<typeof organizationInput>;
export type OrganizationInputValue = z.output<typeof organizationInput>;

/** An organization as the admin API returns it. */
export const adminOrganization = z.object({
  id: uuid,
  slug: z.string(),
  org_type: orgType,
  is_partner: z.boolean(),
  parent_id: uuid.nullable(),
  /** The partner the organization belongs to: itself for a partner, inherited by sub-units. */
  partner_id: uuid.nullable(),
  name: z.record(z.string(), z.string()),
  country_code: z.string().nullable(),
  schac_home_organization: z.string().nullable(),
  keycloak_idp_alias: z.string().nullable(),
  contact_email: z.string().nullable(),
  default_timezone: z.string(),
  ui_languages: z.array(z.string()),
  website_url: z.string().nullable(),
  logo_url: z.string().nullable(),
  erasmus_code: z.string().nullable(),
  pic: z.string().nullable(),
  ext_id: z.string().nullable(),
  deleted_at: isoDateTime.nullable(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
  counts: z.object({
    /** Courses of this organization (not of its sub-units) that are not deleted. */
    courses_total: z.int().nonnegative(),
    courses_published: z.int().nonnegative(),
    /** Direct children that are not deleted. */
    sub_units: z.int().nonnegative(),
  }),
});
export type AdminOrganization = z.infer<typeof adminOrganization>;

/** `GET /api/admin/v1/organizations?include_deleted=` */
export const adminOrganizationListQuery = z.object({
  include_deleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type AdminOrganizationListQuery = z.output<typeof adminOrganizationListQuery>;

/** Alliance first, then partners, then other organizations; by slug within each group. */
export const adminOrganizationList = z.object({ items: z.array(adminOrganization) });
export type AdminOrganizationList = z.infer<typeof adminOrganizationList>;

/**
 * An administrator of an organization: a Keycloak user whose attribute
 * `oecp_org_id` is the organization's id (alliance admins under the alliance
 * organization).
 */
export const organizationAdmin = z.object({
  /** Keycloak user id, the `sub` claim. */
  sub: z.string(),
  username: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  /** OACC realm roles (`partner_admin`, `alliance_admin`); empty if removed in Keycloak. */
  roles: z.array(adminRole),
  /** Alias of the linked identity provider, or `local` for a Keycloak account. */
  idp: z.string(),
  enabled: z.boolean(),
  email_verified: z.boolean(),
  created_at: isoDateTime.nullable(),
  /** Latest LOGIN event; null when unknown (Keycloak events not readable by the API). */
  last_login_at: isoDateTime.nullable(),
  /** Pending Keycloak required actions, e.g. `UPDATE_PASSWORD`, `CONFIGURE_TOTP`. */
  required_actions: z.array(z.string()),
});
export type OrganizationAdmin = z.infer<typeof organizationAdmin>;

/** `GET /api/admin/v1/organizations/{orgId}/admins`, by e-mail. */
export const organizationAdminList = z.object({ items: z.array(organizationAdmin) });
export type OrganizationAdminList = z.infer<typeof organizationAdminList>;

/** `POST /api/admin/v1/organizations/{orgId}/admins/{sub}/resend-setup` (200). */
export const resendSetupResponse = z.object({
  sub: z.string(),
  /** The required actions the e-mail asks for. */
  actions: z.array(z.string()),
});
export type ResendSetupResponse = z.infer<typeof resendSetupResponse>;
