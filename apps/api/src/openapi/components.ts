// SPDX-License-Identifier: EUPL-1.2
/**
 * Component schemas of the OpenAPI documents, converted from the Zod contracts of
 * `@oecp/schemas` with Zod's native `z.toJSONSchema` (JSON Schema 2020-12, the
 * dialect of OpenAPI 3.1). Request bodies and query parameters are converted with
 * `io: "input"` (what a client sends: defaults optional, transforms ignored),
 * responses with `io: "output"` (what the API returns). Schemas registered below
 * become `#/components/schemas/<id>` and are referenced wherever they are nested.
 */
import {
  adminCourse,
  adminCourseHistory,
  adminCourseList,
  adminCourseListItem,
  adminHistoryEntry,
  adminMe,
  adminOffering,
  adminOrganization,
  adminOrganizationList,
  adminCsvReference,
  adminReference,
  adminRole,
  acceptInvitationRequest,
  acceptInvitationResponse,
  attributeDefinition,
  attributeValueType,
  COURSE_OVERRIDE_FIELDS,
  courseCompleteness,
  courseImage,
  courseImagePatch,
  courseInput,
  courseKind,
  courseLevel,
  courseOverridesPatch,
  courseSearchFacets,
  courseSearchResponse,
  createInvitationRequest,
  createOrganizationInvitationRequest,
  csvUploadInlineResponse,
  csvUploadResponse,
  ERROR_CODES,
  type ErrorCode,
  integrationUpdateRequest,
  invitation,
  invitationList,
  invitationMismatchReason,
  invitationStatus,
  lifecycleStatus,
  localizedLabel,
  maintenanceJobRunResponse,
  maintenanceRun,
  maintenanceRunList,
  maintenanceRunStatus,
  maintenanceTrigger,
  networkHealth,
  networkStatus,
  networkStatusItem,
  OFFERING_OVERRIDE_FIELDS,
  offeringInput,
  offeringOverridesPatch,
  organizationAdmin,
  organizationAdminList,
  organizationInput,
  orgType,
  partnerIntegration,
  problemError,
  publicAttribute,
  publicAttributeDefinition,
  publicAttributeValue,
  publicCourseCard,
  publicCourseDetail,
  publicCourseImage,
  publicCourseText,
  publicNextOffering,
  publicOffering,
  publicOrganizationRef,
  referenceResponse,
  resendInvitationRequest,
  resendSetupResponse,
  sourceChannel,
  statusChangeRequest,
  suggestResponse,
  syncError,
  syncNowResponse,
  syncRun,
  syncRunFiles,
  syncRunDetail,
  syncRunList,
  syncRunStatus,
  TEXT_OVERRIDE_FIELDS,
  testConnectionResult,
  uuid,
} from '@oecp/schemas';
import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

/** Where component schemas live in the documents. */
export const SCHEMA_REF = '#/components/schemas/';
export const schemaRef = (id: string): JsonSchema => ({ $ref: SCHEMA_REF + id });

const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

const PREFIX_TITLES: Readonly<Record<string, string>> = {
  'oecp.request': 'Request',
  'oecp.internal': 'Internal',
  'oecp.auth': 'Authentication and authorization (`/api/admin`)',
  'oecp.invitation': 'Invitations',
  'oecp.identity': 'Identity service (Keycloak)',
  'oecp.mail': 'Mail',
  'oecp.admin': 'Administrators',
  'oecp.content': 'Content rules (every channel)',
  'oecp.csv': 'CSV uploads (Channel B)',
  'oecp.oeapi': 'OEAPI harvester (Channel A; reported in sync runs)',
  'oecp.integration': 'Integration settings',
  'oecp.secrets': 'Secrets',
  'oecp.sync': 'Sync runs',
  'oecp.media': 'Course images',
};

/** Markdown list of every stable code, grouped by prefix (spec Appendix A). */
export function errorCodeCatalogue(): string {
  const groups = new Map<string, ErrorCode[]>();
  for (const code of ERROR_CODE_LIST) {
    const prefix = code.split('.').slice(0, 2).join('.');
    groups.set(prefix, [...(groups.get(prefix) ?? []), code]);
  }
  const sections = [...groups].map(([prefix, codes]) => {
    const lines = codes.map((code) => {
      const { message, severity } = ERROR_CODES[code];
      return `- \`${code}\`${severity === 'warning' ? ' *(warning)*' : ''}: ${message}`;
    });
    const pattern = codes.length === 1 && codes[0] === prefix ? prefix : `${prefix}.*`;
    return `**${PREFIX_TITLES[prefix] ?? prefix}** (\`${pattern}\`, ${codes.length})\n\n${lines.join('\n')}`;
  });
  return sections.join('\n\n');
}

const stableErrorCode = z.enum(ERROR_CODE_LIST);

/** `problemError` with the code narrowed to the stable codes. */
const problemErrorDoc = problemError.extend({ code: stableErrorCode });

/** RFC 9457 problem as rendered by `ProblemDetailsFilter`, with the documented extension members. */
const problemDetailsDoc = z.looseObject({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(problemErrorDoc).optional(),
  reason: invitationMismatchReason.optional(),
  idp_alias: z.string().optional(),
});

/** Inline upload result (201), `csvUploadInlineResponse` with the codes narrowed. */
const csvUploadInlineResponseDoc = csvUploadInlineResponse.extend({
  warnings: z.array(problemErrorDoc),
});

/** Extension members of a failed inline upload (422), next to the standard problem members. */
const csvUploadProblemMembers = z.looseObject({
  sync_run_id: uuid,
  run_status: z.literal('failed'),
  processed_inline: z.literal(true),
  error_count: z.int().min(0),
  warning_count: z.int().min(0),
});

interface ComponentDef {
  id: string;
  schema: z.ZodType;
  description?: string;
}

const list = (values: readonly string[]) => values.map((v) => `\`${v}\``).join(', ');

/** Enumerations and labels: identical as input and output, shared by both conversions. */
const SHARED: readonly ComponentDef[] = [
  {
    id: 'LocalizedLabel',
    schema: localizedLabel,
    description:
      'Short label keyed by BCP 47 language tag; always contains `en`. Clients show `label[locale] ?? label.en`.',
  },
  { id: 'CourseKind', schema: courseKind },
  {
    id: 'CourseLevel',
    schema: courseLevel,
    description: 'Study cycle (`levels[0]` is the primary one).',
  },
  { id: 'LifecycleStatus', schema: lifecycleStatus },
  {
    id: 'SourceChannel',
    schema: sourceChannel,
    description:
      'Ingestion channel: `oeapi` (A, harvester), `csv` (B, upload), `form` (C, web form).',
  },
  { id: 'SyncRunStatus', schema: syncRunStatus },
  { id: 'OrgType', schema: orgType },
  { id: 'AdminRole', schema: adminRole },
  { id: 'AttributeValueType', schema: attributeValueType },
  { id: 'InvitationStatus', schema: invitationStatus },
  { id: 'NetworkHealth', schema: networkHealth },
  { id: 'MaintenanceTrigger', schema: maintenanceTrigger },
  { id: 'MaintenanceRunStatus', schema: maintenanceRunStatus },
  {
    id: 'InvitationMismatchReason',
    schema: invitationMismatchReason,
    description:
      'Which check of `POST /invitations/accept` failed (problem member `reason` of `oecp.invitation.mismatch`): `email` (signed-in e-mail is not the invited address, 403), `idp` (not signed in through the organization IdP, 403), `home_organization` (the IdP did not assert the schacHomeOrganization, 403), `organization` (the account already administers another organization, 409).',
  },
  {
    id: 'ErrorCode',
    schema: stableErrorCode,
    description: `Stable error code (spec §6.6, Appendix A; \`packages/schemas/errors.json\`). Codes are never renamed, reused or repurposed; new codes may be added in any release, so clients must tolerate unknown values.\n\n${errorCodeCatalogue()}`,
  },
];

const RESPONSES: readonly ComponentDef[] = [
  {
    id: 'ProblemError',
    schema: problemErrorDoc,
    description:
      'One error or warning: CSV problems carry `file`, `row` (1-based, header = 1) and `column`; JSON bodies an RFC 6901 `pointer`.',
  },
  {
    id: 'ProblemDetails',
    schema: problemDetailsDoc,
    description:
      'RFC 9457 `application/problem+json`, the body of every error response. `errors[]` lists stable codes; `instance` is the request path. Extension members: `reason` on `oecp.invitation.mismatch` (see `InvitationMismatchReason`), `idp_alias` on `oecp.invitation.idp_not_enabled`, `sync_run_id`/`run_status`/`error_count`/`warning_count`/`processed_inline` on failed inline uploads. Problems raised by the framework itself (e.g. a malformed UUID in the path) carry `title` and `status` without `errors`.',
  },
  // Public catalogue (spec §7).
  { id: 'PublicOrganizationRef', schema: publicOrganizationRef },
  { id: 'PublicAttributeValue', schema: publicAttributeValue },
  {
    id: 'PublicAttribute',
    schema: publicAttribute,
    description:
      'An alliance attribute of a course, resolved with its definition; ordered by the definition `sort_order`, then key.',
  },
  { id: 'PublicNextOffering', schema: publicNextOffering },
  {
    id: 'PublicCourseImage',
    schema: publicCourseImage,
    description:
      'Course image (decision 27): `url` (lg, inside 1600×1600) and `thumbnail_url` (sm, inside 640×640) are paths on the portal origin, `/media/courses/{id}/{key}.{lg|sm}.webp`; `alt` is keyed by language (empty alternative text when `decorative`); `width`/`height` of the lg file.',
  },
  { id: 'PublicCourseCard', schema: publicCourseCard, description: 'One search result.' },
  {
    id: 'CourseSearchFacets',
    schema: courseSearchFacets,
    description:
      'Disjunctive facet counts: each facet ignores its own filter. Keys are the query parameter names; `attributes` is keyed by attribute key (parameter `attr_<key>`).',
  },
  {
    id: 'CourseSearchResponse',
    schema: courseSearchResponse,
    description: '`GET /api/public/v1/courses`.',
  },
  { id: 'PublicCourseText', schema: publicCourseText },
  {
    id: 'PublicOffering',
    schema: publicOffering,
    description:
      'Seats (DL 8): show `alliance_seats` when set and `seats_available` "as of `seats_updated_at`" when set; never compute remaining alliance seats.',
  },
  {
    id: 'PublicCourseDetail',
    schema: publicCourseDetail,
    description: '`GET /api/public/v1/courses/{courseId}`.',
  },
  { id: 'SuggestResponse', schema: suggestResponse },
  { id: 'PublicAttributeDefinition', schema: publicAttributeDefinition },
  { id: 'ReferenceResponse', schema: referenceResponse },
  // Admin API (spec §8).
  {
    id: 'AdminMe',
    schema: adminMe,
    description: 'The signed-in administrator; `roles` is empty before an invitation is accepted.',
  },
  {
    id: 'Invitation',
    schema: invitation,
    description: 'An invitation; the token and its hash are never returned.',
  },
  { id: 'InvitationList', schema: invitationList },
  { id: 'AcceptInvitationResponse', schema: acceptInvitationResponse },
  { id: 'AdminOrganization', schema: adminOrganization },
  { id: 'AdminOrganizationList', schema: adminOrganizationList },
  { id: 'OrganizationAdmin', schema: organizationAdmin },
  { id: 'OrganizationAdminList', schema: organizationAdminList },
  { id: 'ResendSetupResponse', schema: resendSetupResponse },
  {
    id: 'SyncRun',
    schema: syncRun,
    description: 'A sync run of any channel (harvest, CSV upload, form save).',
  },
  { id: 'SyncRunList', schema: syncRunList },
  { id: 'SyncError', schema: syncError },
  { id: 'SyncRunDetail', schema: syncRunDetail },
  {
    id: 'PartnerIntegration',
    schema: partnerIntegration,
    description: 'Channel A settings; the credential is never returned (`secret_configured`).',
  },
  {
    id: 'TestConnectionResult',
    schema: testConnectionResult,
    description: 'Remote failures are `ok: false` with `error`, not HTTP errors.',
  },
  { id: 'SyncNowResponse', schema: syncNowResponse },
  {
    id: 'CsvUploadResponse',
    schema: csvUploadResponse,
    description: 'Queued upload (202): `status: "queued"`, `processed_inline: false`.',
  },
  {
    id: 'CsvUploadInlineResponse',
    schema: csvUploadInlineResponseDoc,
    description: 'Upload processed in the request (201): the finished run and its warnings.',
  },
  { id: 'AttributeDefinition', schema: attributeDefinition },
  { id: 'CourseCompleteness', schema: courseCompleteness },
  {
    id: 'CourseImage',
    schema: courseImage,
    description:
      'The stored course image (decision 27). `source_url` is the CSV `image_url` it was fetched from (null for an upload). Never harvested, never an override.',
  },
  { id: 'AdminReference', schema: adminReference },
  {
    id: 'AdminCsvReference',
    schema: adminCsvReference,
    description:
      'The lists the server validates a CSV upload of the organization against, for the browser validator (`csvReferenceDataFromAdminCsvReference` of `@oecp/schemas`).',
  },
  {
    id: 'SyncRunFiles',
    schema: syncRunFiles,
    description: 'Original names of the files of a CSV upload, per file kind.',
  },
  {
    id: 'AdminOffering',
    schema: adminOffering,
    description:
      'Effective values plus `overrides`, `override_meta` (`{by, at}` per key) and `source_values` (the harvested or uploaded value of each overridden key).',
  },
  {
    id: 'AdminCourse',
    schema: adminCourse,
    description:
      'Effective values plus `overrides`, `override_meta` and `source_values`; `completeness` applies the IT Handbook publication rule to the effective values.',
  },
  { id: 'AdminCourseListItem', schema: adminCourseListItem },
  { id: 'AdminCourseList', schema: adminCourseList },
  { id: 'AdminHistoryEntry', schema: adminHistoryEntry },
  { id: 'AdminCourseHistory', schema: adminCourseHistory },
  { id: 'NetworkStatusItem', schema: networkStatusItem },
  { id: 'NetworkStatus', schema: networkStatus },
  { id: 'MaintenanceRun', schema: maintenanceRun },
  { id: 'MaintenanceRunList', schema: maintenanceRunList },
  { id: 'MaintenanceJobRunResponse', schema: maintenanceJobRunResponse },
];

const overrideKeys = (fields: readonly string[], texts: boolean) =>
  `Keys: ${list(fields)}${texts ? `, and \`texts.<lang>.<field>\` with field ${list(TEXT_OVERRIDE_FIELDS)} (a new language needs its \`title\`)` : ''}. Values have the shape of the same member of the create body; at least one change, at most 100 keys in each of \`set\` and \`clear\`, no key in both.`;

const REQUESTS: readonly ComponentDef[] = [
  { id: 'AcceptInvitationRequest', schema: acceptInvitationRequest },
  {
    id: 'CreateInvitationRequest',
    schema: createInvitationRequest,
    description: '`ttl_hours` defaults to 168 (7 days), the maximum.',
  },
  {
    id: 'CreateOrganizationInvitationRequest',
    schema: createOrganizationInvitationRequest,
    description: 'As `CreateInvitationRequest`; the organization comes from the path.',
  },
  {
    id: 'ResendInvitationRequest',
    schema: resendInvitationRequest,
    description: '`ttl_hours` defaults to the lifetime of the original invitation.',
  },
  {
    id: 'OrganizationInput',
    schema: organizationInput,
    description:
      '`PUT` is a full replace: optional members left out become null. `slug` is immutable after creation. `partner_id`, `id` and timestamps are derived by the API.',
  },
  {
    id: 'IntegrationUpdateRequest',
    schema: integrationUpdateRequest,
    description:
      'Full settings; omitted members take their defaults. `secret` is write-only: omitted keeps the stored credential, `null` deletes it, a string replaces it (`username:password` for `basic`, the token for `bearer`, the header value for `api_key_header`). `enabled` only with `authoritative_channel: oeapi`.',
  },
  {
    id: 'CourseInput',
    schema: courseInput,
    description:
      'Create (default status `draft`; `published` needs `texts.en`) or full replace. `withdrawn`/`cancelled` only through `…/status`. Texts are keyed by primary language subtag; empty optional texts become null.',
  },
  {
    id: 'OfferingInput',
    schema: offeringInput,
    description:
      'Create or full replace of an offering; `timezone` defaults to the organization default; `seats_available` stamps `seats_updated_at`.',
  },
  {
    id: 'CourseOverridesPatch',
    schema: courseOverridesPatch,
    description: `\`set\` stores overrides, \`clear\` removes them (restoring the harvested value). ${overrideKeys(COURSE_OVERRIDE_FIELDS, true)}`,
  },
  {
    id: 'OfferingOverridesPatch',
    schema: offeringOverridesPatch,
    description: `\`set\` stores overrides, \`clear\` removes them (restoring the harvested value). ${overrideKeys(OFFERING_OVERRIDE_FIELDS, false)}`,
  },
  { id: 'StatusChangeRequest', schema: statusChangeRequest },
  {
    id: 'CourseImagePatch',
    schema: courseImagePatch,
    description:
      'At least one member. `alt` replaces the whole map (primary language subtag → 1–300 characters); `credit` `null` or empty removes it.',
  },
];

function stripRoot(schema: JsonSchema): JsonSchema {
  const { $schema: _schema, $id: _id, ...rest } = schema;
  return rest;
}

function convert(
  defs: readonly ComponentDef[],
  io: 'input' | 'output',
): Record<string, JsonSchema> {
  const registry = z.registry<{ id: string; description?: string }>();
  for (const def of defs) {
    registry.add(
      def.schema,
      def.description ? { id: def.id, description: def.description } : { id: def.id },
    );
  }
  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'throw',
    // Ids and descriptions both come from this registry.
    metadata: registry,
    uri: (id) => SCHEMA_REF + id,
  }) as { schemas: Record<string, JsonSchema> };
  return Object.fromEntries(Object.entries(schemas).map(([id, s]) => [id, stripRoot(s)]));
}

/** Converts one Zod schema without registry (query parameters, extension members). */
export function inlineSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): JsonSchema {
  return stripRoot(
    z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'throw' }) as JsonSchema,
  );
}

/**
 * Every component schema of both documents. The shared enumerations are converted
 * in both directions and must come out identical.
 */
export function componentSchemas(): Record<string, JsonSchema> {
  const output = convert([...SHARED, ...RESPONSES], 'output');
  const input = convert([...SHARED, ...REQUESTS], 'input');
  const merged: Record<string, JsonSchema> = { ...output };
  for (const [id, schema] of Object.entries(input)) {
    const existing = merged[id];
    if (existing && JSON.stringify(existing) !== JSON.stringify(schema)) {
      throw new Error(`Component ${id} differs between request and response conversion`);
    }
    merged[id] = schema;
  }
  merged['CsvUploadProblem'] = {
    description:
      'Failed inline upload (422): nothing was written. The run keeps the full error list (`GET /sync-runs/{sync_run_id}?page=…`); `errors` holds the first 1,000 errors and warnings.',
    allOf: [schemaRef('ProblemDetails'), inlineSchema(csvUploadProblemMembers, 'output')],
  };
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}
