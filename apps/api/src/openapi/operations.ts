// SPDX-License-Identifier: EUPL-1.2
/**
 * Operations of `/api/public/v1` and `/api/admin/v1`, one entry per route of the
 * catalogue and admin controllers. Request and response shapes are references to
 * the component schemas of `components.ts`; query parameters are read from the
 * same Zod schemas the controllers validate with. `test/unit/openapi.test.ts`
 * fails when a route, method, role rule or success status here drifts from the
 * controllers.
 */
import {
  adminCourseHistoryQuery,
  adminCourseListQuery,
  adminOrganizationListQuery,
  COURSE_IMAGE_MAX_BYTES,
  CSV_MAX_FILE_BYTES,
  courseSearchQuery,
  MAX_ATTRIBUTE_FILTERS,
  maintenanceRunListQuery,
  suggestQuery,
  syncRunDetailQuery,
  syncRunListQuery,
} from '@oecp/schemas';
import type { z } from 'zod';
import { CSV_INLINE_MAX_ROWS } from '../ingestion/csv/csv.constants.js';
import type { JsonSchema } from './components.js';

export type ApiName = 'public' | 'admin';
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
/** Who may call an admin operation (`x-oecp-roles`). */
export type Access = 'alliance_admin' | 'partner_admin' | 'role-less' | 'anonymous';
export type HeaderName =
  | 'Cache-Control'
  | 'ETag'
  | 'Location'
  | 'Retry-After'
  | 'Content-Disposition'
  | 'X-Content-Type-Options';
export type PathParameter =
  | 'PublicCourseId'
  | 'OrgId'
  | 'OrganizationId'
  | 'InvitationId'
  | 'CourseId'
  | 'OfferingId'
  | 'SyncRunId'
  | 'AdminSub'
  | 'MaintenanceJobName';

export interface ResponseSpec {
  description: string;
  /** Component id, or an inline schema. */
  schema?: string | JsonSchema;
  /** Default `application/json`. */
  contentType?: string;
  headers?: readonly HeaderName[];
}

export interface QuerySpec {
  schema: z.ZodType;
  /** Description of every parameter; parameters missing here fail the build. */
  descriptions: Readonly<Record<string, string>>;
  /** Schema members that are not parameters of their own (`attributes` ← `attr_<key>`). */
  skip?: readonly string[];
}

export interface OperationSpec {
  method: HttpMethod;
  /** Path below the API base (`/api/public/v1` or `/api/admin/v1`). */
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description?: string;
  /** Admin API only; `anonymous` = no token. */
  access?: readonly Access[];
  params?: readonly PathParameter[];
  query?: QuerySpec;
  /** Component id of an `application/json` body, or the CSV or image multipart body. */
  body?: { schema: string; required?: boolean } | 'csv-multipart' | 'image-multipart';
  /** Success (and documented non-error) responses. */
  responses: Readonly<Record<number, ResponseSpec>>;
  /** Error responses (problem+json), status → description with the codes. */
  errors?: Readonly<Record<number, string>>;
}

export const API_BASE: Readonly<Record<ApiName, string>> = {
  public: '/api/public/v1',
  admin: '/api/admin/v1',
};

const P = 'partner_admin';
const A = 'alliance_admin';
const PA: readonly Access[] = [P, A];
const ANY_TOKEN: readonly Access[] = [P, A, 'role-less'];

const OPENAPI_DESCRIPTION =
  'This document, generated at start-up from the Zod contracts of `@oecp/schemas`; the copy in the repository is `docs/api/`. Anonymous and cacheable for an hour.';

const DOCS_DESCRIPTION =
  'HTML page that renders this document with Redoc, served by the API itself (bundle under `/api/docs-assets/`, no third-party origin; scripts and styles from the portal origin only). Anonymous and cacheable for an hour; 10 requests/s per client address (burst 20) at the edge proxy.';

const docsOperation = (api: ApiName): OperationSpec => ({
  method: 'get',
  path: '/docs',
  operationId: `${api}GetApiReference`,
  tag: 'API description',
  summary: 'View this document in the browser',
  description:
    api === 'admin'
      ? `${DOCS_DESCRIPTION} Not protected, like \`/openapi.json\`.`
      : DOCS_DESCRIPTION,
  ...(api === 'admin' ? { access: ['anonymous'] as const } : {}),
  responses: {
    200: {
      description: 'The viewer page (loads `openapi.json` from the same API).',
      contentType: 'text/html',
      schema: { type: 'string' },
      headers: ['Cache-Control', 'ETag'],
    },
  },
});

/* ------------------------------------------------------------------ public API */

export const PUBLIC_OPERATIONS: readonly OperationSpec[] = [
  {
    method: 'get',
    path: '/courses',
    operationId: 'publicSearchCourses',
    tag: 'Catalogue',
    summary: 'Search courses',
    description: `Published, non-deleted courses with facet counts (spec §7.1). Repeated parameters (\`partner=a&partner=b\`) are OR-ed within a filter and AND-ed across filters; facets are disjunctive (each ignores its own filter).

**Alliance attributes:** \`attr_<key>=<value>\` (repeatable, at most ${MAX_ATTRIBUTE_FILTERS} distinct keys) filters by an alliance attribute: values OR-ed within a key, keys AND-ed. Booleans take \`true\` or \`false\`; \`enum\`/\`multi_enum\` an option value. Keys without a definition are ignored; the filterable keys are listed by \`GET /reference\` (\`attribute_definitions[].filterable\`).

**Ranking:** \`sort=relevance\` (default with \`q\`) ranks by \`ts_rank_cd\` plus title trigram similarity; without \`q\` the default is \`start_date\`.

Per-client rate limit at the edge: 20 requests/s (burst 40).`,
    query: {
      schema: courseSearchQuery,
      skip: ['attributes'],
      descriptions: {
        q: 'Full-text query (title, abstract, description, keywords…); one word also matches as a prefix and, from 3 characters, by trigram similarity.',
        partner: 'Organization slug (repeatable).',
        mode: 'Delivery mode code (repeatable), see `GET /reference`.',
        ectsMin: 'Minimum ECTS, inclusive.',
        ectsMax: 'Maximum ECTS, inclusive.',
        ects_min: 'Alias of `ectsMin`.',
        ects_max: 'Alias of `ectsMax`.',
        lang: '**Teaching** language: primary subtag of an offering `teaching_languages` (repeatable). The display language is `locale`.',
        isced: 'ISCED-F broad field, two digits (repeatable).',
        level: 'Study cycle, matches any of a course `levels` (repeatable).',
        kind: 'Course kind (repeatable).',
        sort: '`relevance` (default with `q`), `title`, `start_date` (default otherwise), `deadline` (next open application deadline first, courses without one last).',
        page: 'Page number, 1-based.',
        pageSize: 'Results per page (default 20).',
        page_size: 'Alias of `pageSize`.',
        includeUnscheduled:
          'Older spelling of `upcoming=false`: `true` lists every published course. `upcoming` wins when both are given.',
        upcoming:
          'Default `true`: only courses with a published offering whose `end_date` is today (UTC) or later. `false` lists every published course.',
        locale:
          '**Display** language of resolved texts (`title`, `abstract`), primary subtag; English fallback. The `*_lang` members say which language was used.',
      },
    },
    responses: {
      200: {
        description: 'One page of results with facets.',
        schema: 'CourseSearchResponse',
        headers: ['Cache-Control', 'ETag'],
      },
    },
    errors: { 400: 'Invalid query parameter: `oecp.request.validation_failed`.' },
  },
  {
    method: 'get',
    path: '/courses/{courseId}',
    operationId: 'publicGetCourse',
    tag: 'Catalogue',
    summary: 'Get a course page',
    description:
      'The course with its texts in every language (each with the optional IT Handbook texts), `instructors`, every attribute, published offerings (past ones included) and cancelled offerings not yet started, and the contact (course, else organization).',
    params: ['PublicCourseId'],
    responses: {
      200: {
        description: 'The course.',
        schema: 'PublicCourseDetail',
        headers: ['Cache-Control', 'ETag'],
      },
    },
    errors: {
      404: 'Malformed, unknown, unpublished or deleted id: `oecp.request.not_found`.',
    },
  },
  {
    method: 'get',
    path: '/suggest',
    operationId: 'publicSuggest',
    tag: 'Catalogue',
    summary: 'Suggest course titles',
    description:
      'Up to `limit` title suggestions for `q`. Of each course the title in `locale` is suggested when it matches, else the English one, else the best match. Per-client rate limit at the edge: 10 requests/s (burst 20).',
    query: {
      schema: suggestQuery,
      descriptions: {
        q: 'Text typed so far, 2–100 characters.',
        limit: 'Maximum number of suggestions.',
        locale: 'Preferred title language, primary subtag.',
        lang: 'Alias of `locale` (this endpoint has no teaching-language filter).',
      },
    },
    responses: {
      200: {
        description: 'Suggestions, best first.',
        schema: 'SuggestResponse',
        headers: ['Cache-Control', 'ETag'],
      },
    },
    errors: { 400: 'Missing or invalid `q`, invalid `limit`: `oecp.request.validation_failed`.' },
  },
  {
    method: 'get',
    path: '/reference',
    operationId: 'publicGetReference',
    tag: 'Catalogue',
    summary: 'Get reference data for filters',
    description:
      'Organizations (with `idp_alias` for "Sign in through your university": the organization `keycloak_idp_alias` when it names an IdP enabled in the realm, else null), active delivery modes with their schema.org mode, ISCED broad fields, teaching languages in use, levels, kinds and alliance attribute definitions.',
    responses: {
      200: {
        description: 'Reference data.',
        schema: 'ReferenceResponse',
        headers: ['Cache-Control', 'ETag'],
      },
    },
  },
  {
    method: 'get',
    path: '/sitemap.xml',
    operationId: 'publicGetSitemap',
    tag: 'Catalogue',
    summary: 'Get the sitemap',
    description:
      'sitemaps.org `urlset` of the published courses as `{OECP_PUBLIC_BASE_URL}/en/courses/{id}` with `lastmod` (at most 50,000 URLs, built on request). The portal serves it as `/sitemap.xml`.',
    responses: {
      200: {
        description: 'The sitemap.',
        contentType: 'application/xml',
        schema: { type: 'string' },
        headers: ['Cache-Control', 'ETag'],
      },
    },
  },
  {
    method: 'get',
    path: '/openapi.json',
    operationId: 'publicGetOpenApiDocument',
    tag: 'API description',
    summary: 'Get this OpenAPI document',
    description: OPENAPI_DESCRIPTION,
    responses: {
      200: {
        description: 'OpenAPI 3.1 document of `/api/public/v1`.',
        schema: { type: 'object' },
        headers: ['Cache-Control', 'ETag'],
      },
    },
  },
  docsOperation('public'),
];

/* ------------------------------------------------------------------- admin API */

const SCOPE_404 =
  'Unknown organization (or one outside the caller scope): `oecp.request.not_found`.';

const COURSE_WRITE_ERRORS = {
  409: 'Write refused: `oecp.sync.channel_disabled` (the organization authoritative channel is `oeapi`: use the overrides endpoints), `oecp.content.duplicate_ext_id`, `oecp.content.ext_id_immutable`.',
  422: 'Content rules of the body (`CONTENT_RULE_CODES`: English title to publish `oecp.content.english_missing`, date order, seats, ISCED list) and reference checks (`oecp.content.unknown_teaching_unit`, `oecp.content.unknown_isced_field`, `oecp.content.unknown_delivery_mode`, `oecp.content.unsupported_language`, `oecp.content.invalid_attribute_value`, `oecp.content.invalid_value`); `errors[].pointer` points into the body.',
} as const;

const OVERRIDES_ERRORS = {
  409: '`oecp.content.override_not_allowed`: the record is not harvested (its organization is not in `overrides` mode).',
  422: 'A key that cannot be overridden (`oecp.content.override_not_allowed` with a pointer) or an override value, or the resulting effective record, breaks a content rule.',
} as const;

const IMAGE_404 = 'Unknown course (or one outside the caller scope): `oecp.request.not_found`.';

const DELETE_ERRORS = {
  409: 'Delete refused (as in the console): `oecp.content.harvested_not_deletable`, `oecp.content.published_not_deletable` (withdraw or cancel first), `oecp.content.has_published_offerings` (courses), `oecp.sync.channel_disabled`.',
} as const;

const IDP_NOT_ENABLED =
  "The organization's identity provider (`keycloak_idp_alias`) is missing or disabled in the Keycloak realm, so the invitee could not sign in: `oecp.invitation.idp_not_enabled` with the extension member `idp_alias`";

const IDENTITY_ERRORS = {
  502: 'Keycloak Admin API failed: `oecp.identity.unavailable`.',
  504: 'Keycloak Admin API timed out: `oecp.identity.unavailable`.',
} as const;

export const ADMIN_OPERATIONS: readonly OperationSpec[] = [
  // Account and invitations (spec §2.1).
  {
    method: 'get',
    path: '/me',
    operationId: 'adminGetMe',
    tag: 'Account',
    summary: 'Get the signed-in administrator',
    description:
      'The token as the API sees it. Role-less tokens are allowed so that the invitation acceptance page can show who is signed in.',
    access: ANY_TOKEN,
    responses: { 200: { description: 'The administrator.', schema: 'AdminMe' } },
  },
  {
    method: 'post',
    path: '/invitations/accept',
    operationId: 'adminAcceptInvitation',
    tag: 'Invitations',
    summary: 'Accept an invitation',
    description:
      'Spec §2.1 step 4: binds the signed-in account to the invited role and organization. Accepts a role-less token; the current token still has no role, so the client must sign in again (`relogin_required`).',
    access: ANY_TOKEN,
    body: { schema: 'AcceptInvitationRequest' },
    responses: {
      200: { description: 'Accepted.', schema: 'AcceptInvitationResponse' },
    },
    errors: {
      403: '`oecp.invitation.mismatch` with `reason` `email`, `idp` or `home_organization` (see `InvitationMismatchReason`).',
      404: 'Unknown token: `oecp.invitation.invalid`.',
      409: 'Revoked or already accepted invitation, or its organization no longer exists: `oecp.invitation.invalid`; the account already administers another organization: `oecp.invitation.mismatch` with `reason: organization`.',
      410: 'Expired invitation: `oecp.invitation.expired`.',
      ...IDENTITY_ERRORS,
    },
  },
  {
    method: 'post',
    path: '/invitations',
    operationId: 'adminCreateInvitation',
    tag: 'Invitations',
    summary: 'Create an invitation',
    description:
      'Creates an invitation and e-mails its link (`{OECP_PUBLIC_BASE_URL}/{locale}/admin/accept#token=…[&idp=…]`); the token is never returned.',
    access: [A],
    body: { schema: 'CreateInvitationRequest' },
    responses: { 201: { description: 'Created.', schema: 'Invitation' } },
    errors: {
      404: 'Unknown organization: `oecp.request.not_found`.',
      409: `${IDP_NOT_ENABLED}.`,
      502: 'The invitation e-mail could not be sent: `oecp.mail.unavailable`.',
    },
  },
  {
    method: 'get',
    path: '/invitations',
    operationId: 'adminListInvitations',
    tag: 'Invitations',
    summary: 'List invitations',
    description:
      '`alliance_admin`: every invitation; `partner_admin`: those of its organization. Most recent first, with the derived `status`.',
    access: PA,
    responses: { 200: { description: 'Invitations.', schema: 'InvitationList' } },
  },
  {
    method: 'post',
    path: '/invitations/{id}/resend',
    operationId: 'adminResendInvitation',
    tag: 'Invitations',
    summary: 'Resend an invitation',
    description:
      'Revokes the invitation (unless already revoked) and sends a new one with the same e-mail, role and organization; returns the new invitation, never its token. The body is optional.',
    access: [A],
    params: ['InvitationId'],
    body: { schema: 'ResendInvitationRequest', required: false },
    responses: { 201: { description: 'The new invitation.', schema: 'Invitation' } },
    errors: {
      404: 'Unknown invitation: `oecp.request.not_found`.',
      409: `Accepted invitations cannot be resent: \`oecp.invitation.invalid\`. ${IDP_NOT_ENABLED}.`,
      502: 'The invitation e-mail could not be sent: `oecp.mail.unavailable`.',
    },
  },
  {
    method: 'delete',
    path: '/invitations/{id}',
    operationId: 'adminRevokeInvitation',
    tag: 'Invitations',
    summary: 'Revoke an invitation',
    description: 'Idempotent for revoked invitations.',
    access: [A],
    params: ['InvitationId'],
    responses: { 204: { description: 'Revoked.' } },
    errors: {
      404: 'Unknown invitation: `oecp.request.not_found`.',
      409: 'Accepted invitations cannot be revoked: `oecp.invitation.invalid`.',
    },
  },

  // Organizations, administrators (spec §8.4).
  {
    method: 'get',
    path: '/organizations',
    operationId: 'adminListOrganizations',
    tag: 'Organizations',
    summary: 'List organizations',
    description:
      '`alliance_admin`: every organization (deleted ones with `include_deleted=true`); `partner_admin`: its organization and sub-units. Alliance first, then partners, then other organizations; by slug within each group.',
    access: PA,
    query: {
      schema: adminOrganizationListQuery,
      descriptions: { include_deleted: 'Also list soft-deleted organizations (alliance only).' },
    },
    responses: { 200: { description: 'Organizations.', schema: 'AdminOrganizationList' } },
  },
  {
    method: 'post',
    path: '/organizations',
    operationId: 'adminCreateOrganization',
    tag: 'Organizations',
    summary: 'Create an organization',
    description:
      'A partner is its own partner (`partner_id = id`); other organizations take the `partner_id` of their parent. Audited `organization.create`.',
    access: [A],
    body: { schema: 'OrganizationInput' },
    responses: {
      201: { description: 'Created.', schema: 'AdminOrganization', headers: ['Location'] },
    },
    errors: {
      409: 'Taken slug (deleted organizations included): `oecp.content.duplicate_slug`; taken `schac_home_organization`, `erasmus_code`, `pic`, `keycloak_idp_alias` or (`partner_id`, `ext_id`): `oecp.content.duplicate_identifier`.',
      422: 'Invalid parent (unknown, deleted, itself or a descendant, chain over 32 levels; an alliance has no parent): `oecp.content.invalid_parent`.',
    },
  },
  {
    method: 'get',
    path: '/organizations/{id}',
    operationId: 'adminGetOrganization',
    tag: 'Organizations',
    summary: 'Get an organization',
    description: '`alliance_admin` also sees deleted organizations (to restore them).',
    access: PA,
    params: ['OrganizationId'],
    responses: { 200: { description: 'The organization.', schema: 'AdminOrganization' } },
    errors: { 404: 'Unknown organization: `oecp.request.not_found`.' },
  },
  {
    method: 'put',
    path: '/organizations/{id}',
    operationId: 'adminUpdateOrganization',
    tag: 'Organizations',
    summary: 'Replace an organization',
    description:
      'Full replace. A change of `is_partner` or `parent_id` recomputes `partner_id` down the subtree. Changing `keycloak_idp_alias` is allowed (administrators must then sign in through the new IdP). Audited `organization.update`.',
    access: [A],
    params: ['OrganizationId'],
    body: { schema: 'OrganizationInput' },
    responses: { 200: { description: 'The organization.', schema: 'AdminOrganization' } },
    errors: {
      404: 'Unknown organization: `oecp.request.not_found`.',
      409: '`oecp.content.slug_immutable`, `oecp.content.duplicate_slug`, `oecp.content.duplicate_identifier`.',
      422: '`oecp.content.invalid_parent`.',
    },
  },
  {
    method: 'delete',
    path: '/organizations/{id}',
    operationId: 'adminDeleteOrganization',
    tag: 'Organizations',
    summary: 'Delete an organization',
    description: 'Soft delete. Audited `organization.delete`.',
    access: [A],
    params: ['OrganizationId'],
    responses: { 204: { description: 'Deleted.' } },
    errors: {
      404: 'Unknown organization: `oecp.request.not_found`.',
      409: 'Still in use (courses, sub-units, administrators, pending invitations or an enabled harvest; `detail` lists the reasons): `oecp.content.organization_in_use`.',
    },
  },
  {
    method: 'post',
    path: '/organizations/{id}/restore',
    operationId: 'adminRestoreOrganization',
    tag: 'Organizations',
    summary: 'Restore a deleted organization',
    description: 'Idempotent. Audited `organization.restore`.',
    access: [A],
    params: ['OrganizationId'],
    responses: { 200: { description: 'The organization.', schema: 'AdminOrganization' } },
    errors: {
      404: 'Unknown organization: `oecp.request.not_found`.',
      409: 'The parent is deleted: `oecp.content.invalid_parent`.',
    },
  },
  {
    method: 'get',
    path: '/organizations/{orgId}/admins',
    operationId: 'adminListOrganizationAdmins',
    tag: 'Administrators',
    summary: 'List the administrators of an organization',
    description:
      'Keycloak users whose attribute `oecp_org_id` is the organization (alliance admins under the alliance organization), by e-mail. `last_login_at` is null while the backend client cannot read events.',
    access: PA,
    params: ['OrgId'],
    responses: { 200: { description: 'Administrators.', schema: 'OrganizationAdminList' } },
    errors: { 404: SCOPE_404, ...IDENTITY_ERRORS },
  },
  {
    method: 'delete',
    path: '/organizations/{orgId}/admins/{sub}',
    operationId: 'adminRevokeOrganizationAdmin',
    tag: 'Administrators',
    summary: 'Revoke an administrator',
    description:
      'Spec §2.2: the OECP roles and `oecp_org_id` are removed and the user sessions ended. Audited `admin.revoke`.',
    access: [A],
    params: ['OrgId', 'AdminSub'],
    responses: { 204: { description: 'Revoked.' } },
    errors: {
      404: 'Unknown organization or administrator: `oecp.request.not_found`.',
      409: '`oecp.admin.cannot_remove_self`, `oecp.admin.last_alliance_admin`.',
      ...IDENTITY_ERRORS,
    },
  },
  {
    method: 'post',
    path: '/organizations/{orgId}/admins/{sub}/resend-setup',
    operationId: 'adminResendAdminSetup',
    tag: 'Administrators',
    summary: 'Resend the account set-up e-mail',
    description:
      'Re-sends Keycloak execute-actions e-mail for the pending `UPDATE_PASSWORD`/`CONFIGURE_TOTP` of a local account. Audited `admin.resend_setup`.',
    access: [A],
    params: ['OrgId', 'AdminSub'],
    responses: { 200: { description: 'E-mail sent.', schema: 'ResendSetupResponse' } },
    errors: {
      404: 'Unknown organization or administrator: `oecp.request.not_found`.',
      409: 'Brokered account: `oecp.admin.not_local_account`; nothing pending: `oecp.admin.setup_complete`.',
      ...IDENTITY_ERRORS,
    },
  },
  {
    method: 'post',
    path: '/organizations/{orgId}/invitations',
    operationId: 'adminCreateOrganizationInvitation',
    tag: 'Invitations',
    summary: 'Create an invitation to an organization',
    description:
      'Organization-scoped alias of `POST /invitations`: same role rule, response and audit (`invitation.create`); the organization comes from the path.',
    access: [A],
    params: ['OrgId'],
    body: { schema: 'CreateOrganizationInvitationRequest' },
    responses: { 201: { description: 'Created.', schema: 'Invitation' } },
    errors: {
      404: SCOPE_404,
      409: `${IDP_NOT_ENABLED}.`,
      502: 'The invitation e-mail could not be sent: `oecp.mail.unavailable`.',
    },
  },
  {
    method: 'get',
    path: '/organizations/{orgId}/invitations',
    operationId: 'adminListOrganizationInvitations',
    tag: 'Invitations',
    summary: 'List the invitations of an organization',
    description: 'Most recent first, with the derived `status`.',
    access: PA,
    params: ['OrgId'],
    responses: { 200: { description: 'Invitations.', schema: 'InvitationList' } },
    errors: { 404: SCOPE_404 },
  },

  // Channel A settings and sync monitor (spec §6.2, §8.2).
  {
    method: 'get',
    path: '/organizations/{orgId}/integration',
    operationId: 'adminGetIntegration',
    tag: 'Integrations',
    summary: 'Get the integration settings',
    access: PA,
    params: ['OrgId'],
    responses: { 200: { description: 'The settings.', schema: 'PartnerIntegration' } },
    errors: {
      404: 'Unknown organization: `oecp.request.not_found`; no settings stored yet (before the first `PUT`): `oecp.integration.not_configured`.',
    },
  },
  {
    method: 'put',
    path: '/organizations/{orgId}/integration',
    operationId: 'adminUpdateIntegration',
    tag: 'Integrations',
    summary: 'Replace the integration settings',
    description:
      'Full document; omitted members take their defaults. Every change is audited with from/to values (never the credential).',
    access: PA,
    params: ['OrgId'],
    body: { schema: 'IntegrationUpdateRequest' },
    responses: { 200: { description: 'The settings.', schema: 'PartnerIntegration' } },
    errors: {
      400: 'Request shape and cross-field rules (`oecp.integration.*_required`, `oecp.integration.basic_secret_format`, `oecp.integration.secret_not_expected`, `oecp.sync.channel_disabled` for `enabled` without `oeapi`).',
      404: SCOPE_404,
      422: '`oecp.integration.insecure_url` (`http` without `OECP_ALLOW_INSECURE_PARTNER_HTTP`), `oecp.integration.surfeduhub_unavailable` (no gateway credential configured), `oecp.integration.secret_required` (an authenticated scheme without a stored or new credential).',
      503: 'A new credential cannot be stored because the master key is missing or invalid: `oecp.secrets.unavailable`; nothing is written.',
    },
  },
  {
    method: 'post',
    path: '/organizations/{orgId}/integration/approve-host',
    operationId: 'adminApproveIntegrationHost',
    tag: 'Integrations',
    summary: 'Approve the partner host',
    description:
      'Approves the host of the current `base_url` (`access_mode: direct` only; ADR-0009). Audited.',
    access: [A],
    params: ['OrgId'],
    responses: { 200: { description: 'The settings.', schema: 'PartnerIntegration' } },
    errors: {
      404: 'Unknown organization or `oecp.integration.not_configured`.',
      409: 'Not `direct` access or no `base_url`: `oecp.integration.base_url_required`.',
      422: 'Insecure `base_url`: `oecp.integration.insecure_url`.',
    },
  },
  {
    method: 'post',
    path: '/organizations/{orgId}/integration/test-connection',
    operationId: 'adminTestIntegrationConnection',
    tag: 'Integrations',
    summary: 'Test the partner connection',
    description:
      'Calls `GET /` and `GET /courses?pageSize=1` on the saved settings. Remote failures are 200 `{ok: false, error}`; a credential that does not decrypt with a readable key is 200 `oecp.oeapi.secret_unavailable`.',
    access: PA,
    params: ['OrgId'],
    responses: { 200: { description: 'The result.', schema: 'TestConnectionResult' } },
    errors: {
      404: 'Unknown organization or `oecp.integration.not_configured`.',
      409: 'Blocked settings (host not approved, insecure or missing URL, missing endpoint id): `oecp.integration.*`.',
      503: 'A credential is needed and the master key is missing or invalid: `oecp.secrets.unavailable`.',
    },
  },
  {
    method: 'post',
    path: '/organizations/{orgId}/integration/sync-now',
    operationId: 'adminSyncNow',
    tag: 'Integrations',
    summary: 'Start a harvest now',
    description: 'Queues a manual harvest of Channel A; follow it with `GET /sync-runs/{id}`.',
    access: PA,
    params: ['OrgId'],
    responses: { 202: { description: 'Queued.', schema: 'SyncNowResponse' } },
    errors: {
      404: 'Unknown organization or `oecp.integration.not_configured`.',
      409: 'Harvesting disabled (`oecp.sync.channel_disabled`), blocked settings (`oecp.integration.*`) or a harvest already running (`oecp.sync.already_running`).',
      429: 'One manual run per 15 minutes: `oecp.sync.rate_limited`, with `Retry-After`.',
    },
  },
  {
    method: 'get',
    path: '/organizations/{orgId}/sync-runs',
    operationId: 'adminListSyncRuns',
    tag: 'Sync runs',
    summary: 'List the sync runs of an organization',
    description: 'Every channel, most recent first.',
    access: PA,
    params: ['OrgId'],
    query: {
      schema: syncRunListQuery,
      descriptions: { limit: 'Maximum number of runs.' },
    },
    responses: { 200: { description: 'Runs.', schema: 'SyncRunList' } },
    errors: { 404: SCOPE_404 },
  },
  {
    method: 'get',
    path: '/sync-runs/{id}',
    operationId: 'adminGetSyncRun',
    tag: 'Sync runs',
    summary: 'Get a sync run with its errors',
    description:
      'The run, one page of its errors and warnings, and `handbook_incomplete` (courses of the run with `oecp.content.handbook_incomplete`).',
    access: PA,
    params: ['SyncRunId'],
    query: {
      schema: syncRunDetailQuery,
      descriptions: {
        page: 'Page of `errors`, 1-based.',
        page_size: 'Errors per page.',
        severity: 'Only errors or only warnings.',
      },
    },
    responses: { 200: { description: 'The run.', schema: 'SyncRunDetail' } },
    errors: { 404: 'Unknown run (or one outside the caller scope): `oecp.request.not_found`.' },
  },

  // Channel B, CSV console (spec §6.3).
  {
    method: 'post',
    path: '/organizations/{orgId}/uploads',
    operationId: 'adminUploadCsv',
    tag: 'CSV uploads',
    summary: 'Upload CSV files',
    description: `\`multipart/form-data\` with the file parts \`courses\` and/or \`offerings\` (template 1.3; 1.0, 1.1 and 1.2 accepted; \`image_url\` cells are fetched asynchronously after a successful run, failures are warnings \`oecp.media.fetch_failed\` added to the run), at most ${CSV_MAX_FILE_BYTES / 1024 / 1024} MB each; no other parts. All or nothing (ADR-0011): uploads with at most ${CSV_INLINE_MAX_ROWS} data rows are processed in the request (201, or 422 when validation fails and nothing is written), larger ones are queued (202). \`Location: /api/admin/v1/sync-runs/{id}\` is set on every response that has a run (201, 202, 422, 503).`,
    access: PA,
    params: ['OrgId'],
    body: 'csv-multipart',
    responses: {
      201: {
        description: 'Processed inline.',
        schema: 'CsvUploadInlineResponse',
        headers: ['Location'],
      },
      202: {
        description: 'Queued; follow the run at `Location`.',
        schema: 'CsvUploadResponse',
        headers: ['Location'],
      },
    },
    errors: {
      400: 'No file part: `oecp.csv.no_files`; another part or a second file: `oecp.csv.unexpected_file`.',
      404: SCOPE_404,
      409: 'The organization authoritative channel is not `csv`/`form`: `oecp.sync.channel_disabled`.',
      413: 'A file over the size limit: `oecp.csv.file_too_large`.',
      422: 'Inline run failed validation (`CsvUploadProblem`; nothing written); `Location` names the run.',
      429: 'Upload rate limit: `oecp.csv.rate_limited`, with `Retry-After`.',
      503: 'Queue unavailable, the run was cancelled: `oecp.internal`; `Location` names the run.',
    },
  },
  {
    method: 'get',
    path: '/csv-template/courses.csv',
    operationId: 'adminGetCoursesCsvTemplate',
    tag: 'CSV uploads',
    summary: 'Download the courses CSV template',
    description:
      'Template 1.3 header row (`instructors`, the IT Handbook texts and the image columns `image_url`, `image_alt_en`, `image_credit`) with one `attr_<key>` column per alliance attribute definition.',
    access: PA,
    responses: {
      200: {
        description: 'Header row, UTF-8.',
        contentType: 'text/csv',
        schema: { type: 'string' },
        headers: ['Content-Disposition', 'X-Content-Type-Options'],
      },
    },
  },
  {
    method: 'get',
    path: '/csv-template/offerings.csv',
    operationId: 'adminGetOfferingsCsvTemplate',
    tag: 'CSV uploads',
    summary: 'Download the offerings CSV template',
    access: PA,
    responses: {
      200: {
        description: 'Header row, UTF-8.',
        contentType: 'text/csv',
        schema: { type: 'string' },
        headers: ['Content-Disposition', 'X-Content-Type-Options'],
      },
    },
  },
  {
    method: 'get',
    path: '/csv-template/schema.json',
    operationId: 'adminGetCsvSchema',
    tag: 'CSV uploads',
    summary: 'Download the CSV JSON Schema',
    description:
      'The generated JSON Schema 2020-12 of template 1.3 (`urn:oecp:schema:csv:1.3`), which also accepts 1.0, 1.1 and 1.2 files; `attr_<key>` cells are checked by the validator against the definitions, not by the schema.',
    access: PA,
    responses: {
      200: {
        description: 'JSON Schema document.',
        contentType: 'application/schema+json',
        schema: { type: 'object' },
        headers: ['Content-Disposition'],
      },
    },
  },

  // Channel C, course wizard (spec §6.4, §6.5, §8.2, §8.3).
  {
    method: 'get',
    path: '/organizations/{orgId}/reference',
    operationId: 'adminGetOrganizationReference',
    tag: 'Courses',
    summary: 'Get the reference data of an organization',
    description:
      'Everything the course wizard and the CSV console need for one organization: default time zone, levels, kinds, modes, ISCED broad fields, form languages, attribute definitions, academic sessions, teaching units, `authoritative_channel` and `form_mode` (`overrides` when the authoritative channel is `oeapi`, else `write`).',
    access: PA,
    params: ['OrgId'],
    responses: { 200: { description: 'Reference data.', schema: 'AdminReference' } },
    errors: { 404: SCOPE_404 },
  },
  {
    method: 'get',
    path: '/organizations/{orgId}/courses',
    operationId: 'adminListCourses',
    tag: 'Courses',
    summary: 'List the courses of an organization',
    description:
      'Every status, deleted courses excluded. Repeated parameters accept `k=a&k=b` and `k[]=a&k[]=b`.',
    access: PA,
    params: ['OrgId'],
    query: {
      schema: adminCourseListQuery,
      descriptions: {
        q: 'Case-insensitive match on the code or any title.',
        status: 'Lifecycle status (repeatable).',
        kind: 'Course kind (repeatable).',
        source_channel: 'Channel that wrote the course (repeatable).',
        page: 'Page number, 1-based.',
        page_size: 'Courses per page.',
      },
    },
    responses: { 200: { description: 'One page of courses.', schema: 'AdminCourseList' } },
    errors: { 404: SCOPE_404 },
  },
  {
    method: 'post',
    path: '/organizations/{orgId}/courses',
    operationId: 'adminCreateCourse',
    tag: 'Courses',
    summary: 'Create a course',
    description:
      'Organizations in `write` mode only. Re-creating a soft-deleted code revives it without its old overrides.',
    access: PA,
    params: ['OrgId'],
    body: { schema: 'CourseInput' },
    responses: { 201: { description: 'Created.', schema: 'AdminCourse', headers: ['Location'] } },
    errors: { 404: SCOPE_404, ...COURSE_WRITE_ERRORS },
  },
  {
    method: 'get',
    path: '/courses/{id}',
    operationId: 'adminGetCourse',
    tag: 'Courses',
    summary: 'Get a course',
    access: PA,
    params: ['CourseId'],
    responses: { 200: { description: 'The course.', schema: 'AdminCourse' } },
    errors: { 404: 'Unknown course (or one outside the caller scope): `oecp.request.not_found`.' },
  },
  {
    method: 'put',
    path: '/courses/{id}',
    operationId: 'adminReplaceCourse',
    tag: 'Courses',
    summary: 'Replace a course',
    description:
      'Full replace (`write` mode): omitted languages are deleted except English; the code is immutable.',
    access: PA,
    params: ['CourseId'],
    body: { schema: 'CourseInput' },
    responses: { 200: { description: 'The course.', schema: 'AdminCourse' } },
    errors: { 404: 'Unknown course: `oecp.request.not_found`.', ...COURSE_WRITE_ERRORS },
  },
  {
    method: 'delete',
    path: '/courses/{id}',
    operationId: 'adminDeleteCourse',
    tag: 'Courses',
    summary: 'Delete a course',
    description: 'Soft delete.',
    access: PA,
    params: ['CourseId'],
    responses: { 204: { description: 'Deleted.' } },
    errors: { 404: 'Unknown course: `oecp.request.not_found`.', ...DELETE_ERRORS },
  },
  {
    method: 'put',
    path: '/courses/{id}/image',
    operationId: 'adminPutCourseImage',
    tag: 'Courses',
    summary: 'Upload or replace the course image',
    description: `Decision 27: one image per course, stored by OECP. \`multipart/form-data\` with \`file\` (JPEG, PNG or WebP, sniffed from the bytes; at most ${COURSE_IMAGE_MAX_BYTES / 1024 / 1024} MiB and 40 megapixels), \`alt_en\` (required unless \`decorative=true\`, at most 300 characters), \`decorative\` (\`true\`/\`false\`, default \`false\`) and \`credit\` (at most 300 characters). Re-encoded to WebP without metadata: \`lg\` inside 1600×1600 and \`sm\` inside 640×640, never upscaled; served at \`/media/courses/{id}/{key}.lg.webp\` and \`.sm.webp\`. Replaces (and deletes) the previous image. Works on harvested courses too: the harvester never touches the image. Audited \`course.image_set\`.`,
    access: PA,
    params: ['CourseId'],
    body: 'image-multipart',
    responses: { 200: { description: 'The stored image.', schema: 'CourseImage' } },
    errors: {
      400: 'Missing `file` part, unexpected parts or invalid text parts: `oecp.request.validation_failed`.',
      404: IMAGE_404,
      413: 'File over 5 MiB: `oecp.media.too_large`.',
      415: 'Not a JPEG, PNG or WebP image: `oecp.media.unsupported_type`.',
      422: 'No English alternative text on a non-decorative image: `oecp.media.alt_required`; image that cannot be decoded, over 40 megapixels or over 2 MiB once re-encoded: `oecp.media.invalid_image`.',
    },
  },
  {
    method: 'patch',
    path: '/courses/{id}/image',
    operationId: 'adminPatchCourseImage',
    tag: 'Courses',
    summary: 'Change the alternative text, decorative flag or credit of the course image',
    description:
      'Metadata only; `alt` replaces the whole map (keys are primary language subtags). The result must be decorative or have an English text. Audited `course.image_set`.',
    access: PA,
    params: ['CourseId'],
    body: { schema: 'CourseImagePatch' },
    responses: { 200: { description: 'The stored image.', schema: 'CourseImage' } },
    errors: {
      404: 'Unknown course (`oecp.request.not_found`) or a course without image (`oecp.media.not_found`).',
      422: 'No English alternative text on a non-decorative image: `oecp.media.alt_required`.',
    },
  },
  {
    method: 'delete',
    path: '/courses/{id}/image',
    operationId: 'adminDeleteCourseImage',
    tag: 'Courses',
    summary: 'Remove the course image',
    description:
      'Deletes the files and clears the image; the portal falls back to the partner logo. Audited `course.image_removed`.',
    access: PA,
    params: ['CourseId'],
    responses: { 204: { description: 'Removed.' } },
    errors: {
      404: 'Unknown course (`oecp.request.not_found`) or a course without image (`oecp.media.not_found`).',
    },
  },
  {
    method: 'patch',
    path: '/courses/{id}/overrides',
    operationId: 'adminPatchCourseOverrides',
    tag: 'Courses',
    summary: 'Set or clear course overrides',
    description:
      'Spec §8.3: overrides on a harvested course (`overrides` mode); every harvest keeps them. `{clear: ["status"]}` reverts the status to the partner value at once. Audited `course.overrides`.',
    access: PA,
    params: ['CourseId'],
    body: { schema: 'CourseOverridesPatch' },
    responses: { 200: { description: 'The course.', schema: 'AdminCourse' } },
    errors: { 404: 'Unknown course: `oecp.request.not_found`.', ...OVERRIDES_ERRORS },
  },
  {
    method: 'post',
    path: '/courses/{id}/status',
    operationId: 'adminSetCourseStatus',
    tag: 'Courses',
    summary: 'Change the status of a course',
    description:
      'Publish, withdraw or return to draft. In `overrides` mode this stores a `status` override. Publishing needs an English title.',
    access: PA,
    params: ['CourseId'],
    body: { schema: 'StatusChangeRequest' },
    responses: { 200: { description: 'The course.', schema: 'AdminCourse' } },
    errors: {
      404: 'Unknown course: `oecp.request.not_found`.',
      422: 'The course cannot take the status (e.g. `oecp.content.english_missing` to publish).',
    },
  },
  {
    method: 'get',
    path: '/courses/{id}/history',
    operationId: 'adminGetCourseHistory',
    tag: 'Courses',
    summary: 'Get the history of a course',
    description:
      'Changes of the course and its offerings, newest first: ingest rows (accepted or rejected payloads, body not included) and audit rows, each with a one-line summary.',
    access: PA,
    params: ['CourseId'],
    query: {
      schema: adminCourseHistoryQuery,
      descriptions: { limit: 'Maximum number of entries.' },
    },
    responses: { 200: { description: 'History entries.', schema: 'AdminCourseHistory' } },
    errors: { 404: 'Unknown course: `oecp.request.not_found`.' },
  },
  {
    method: 'post',
    path: '/courses/{id}/offerings',
    operationId: 'adminCreateOffering',
    tag: 'Offerings',
    summary: 'Create an offering',
    access: PA,
    params: ['CourseId'],
    body: { schema: 'OfferingInput' },
    responses: {
      201: { description: 'Created.', schema: 'AdminOffering', headers: ['Location'] },
    },
    errors: { 404: 'Unknown course: `oecp.request.not_found`.', ...COURSE_WRITE_ERRORS },
  },
  {
    method: 'get',
    path: '/offerings/{id}',
    operationId: 'adminGetOffering',
    tag: 'Offerings',
    summary: 'Get an offering',
    access: PA,
    params: ['OfferingId'],
    responses: { 200: { description: 'The offering.', schema: 'AdminOffering' } },
    errors: {
      404: 'Unknown offering (or one outside the caller scope): `oecp.request.not_found`.',
    },
  },
  {
    method: 'put',
    path: '/offerings/{id}',
    operationId: 'adminReplaceOffering',
    tag: 'Offerings',
    summary: 'Replace an offering',
    description: 'Full replace (`write` mode); the offering code is immutable.',
    access: PA,
    params: ['OfferingId'],
    body: { schema: 'OfferingInput' },
    responses: { 200: { description: 'The offering.', schema: 'AdminOffering' } },
    errors: { 404: 'Unknown offering: `oecp.request.not_found`.', ...COURSE_WRITE_ERRORS },
  },
  {
    method: 'delete',
    path: '/offerings/{id}',
    operationId: 'adminDeleteOffering',
    tag: 'Offerings',
    summary: 'Delete an offering',
    description: 'Soft delete.',
    access: PA,
    params: ['OfferingId'],
    responses: { 204: { description: 'Deleted.' } },
    errors: { 404: 'Unknown offering: `oecp.request.not_found`.', ...DELETE_ERRORS },
  },
  {
    method: 'patch',
    path: '/offerings/{id}/overrides',
    operationId: 'adminPatchOfferingOverrides',
    tag: 'Offerings',
    summary: 'Set or clear offering overrides',
    description:
      'Spec §8.3: overrides on a harvested offering (`overrides` mode). Audited `course_offering.overrides`.',
    access: PA,
    params: ['OfferingId'],
    body: { schema: 'OfferingOverridesPatch' },
    responses: { 200: { description: 'The offering.', schema: 'AdminOffering' } },
    errors: { 404: 'Unknown offering: `oecp.request.not_found`.', ...OVERRIDES_ERRORS },
  },
  {
    method: 'post',
    path: '/offerings/{id}/status',
    operationId: 'adminSetOfferingStatus',
    tag: 'Offerings',
    summary: 'Change the status of an offering',
    description:
      'Publish, cancel, withdraw or return to draft. In `overrides` mode this stores a `status` override.',
    access: PA,
    params: ['OfferingId'],
    body: { schema: 'StatusChangeRequest' },
    responses: { 200: { description: 'The offering.', schema: 'AdminOffering' } },
    errors: {
      404: 'Unknown offering: `oecp.request.not_found`.',
      422: 'The offering cannot take the status.',
    },
  },

  // Network status and maintenance (spec §8.4, §10).
  {
    method: 'get',
    path: '/network-status',
    operationId: 'adminGetNetworkStatus',
    tag: 'Network status',
    summary: 'Get the network status',
    description:
      'Health of the data supply of every organization that is not deleted (alliance first, then partners, then other organizations, by slug); see `NetworkHealth` for the rules.',
    access: [A],
    responses: { 200: { description: 'Network status.', schema: 'NetworkStatus' } },
  },
  {
    method: 'get',
    path: '/maintenance/runs',
    operationId: 'adminListMaintenanceRuns',
    tag: 'Maintenance',
    summary: 'List maintenance runs',
    description: 'Runs of the worker maintenance jobs (kept 12 months), most recent first.',
    access: [A],
    query: {
      schema: maintenanceRunListQuery,
      descriptions: { limit: 'Maximum number of runs.', job: 'Only runs of this job.' },
    },
    responses: { 200: { description: 'Runs.', schema: 'MaintenanceRunList' } },
  },
  {
    method: 'post',
    path: '/maintenance/jobs/{name}/run',
    operationId: 'adminRunMaintenanceJob',
    tag: 'Maintenance',
    summary: 'Run a maintenance job now',
    description:
      'Queues a manual run on the worker `maintenance` queue. `already_queued`: a manual run of the job is still waiting or running and no second one is added. Audited `maintenance.run_requested`.',
    access: [A],
    params: ['MaintenanceJobName'],
    responses: { 202: { description: 'Queued.', schema: 'MaintenanceJobRunResponse' } },
    errors: { 404: 'Unknown job: `oecp.request.not_found`.' },
  },
  {
    method: 'get',
    path: '/openapi.json',
    operationId: 'adminGetOpenApiDocument',
    tag: 'API description',
    summary: 'Get this OpenAPI document',
    description: `${OPENAPI_DESCRIPTION} Not protected: the document describes the API, it grants nothing.`,
    access: ['anonymous'],
    responses: {
      200: {
        description: 'OpenAPI 3.1 document of `/api/admin/v1`.',
        schema: { type: 'object' },
        headers: ['Cache-Control', 'ETag'],
      },
    },
  },
  docsOperation('admin'),
];
