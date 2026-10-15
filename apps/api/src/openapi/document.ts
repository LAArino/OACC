// SPDX-License-Identifier: EUPL-1.2
/**
 * Builds the OpenAPI 3.1 documents of `/api/public/v1` and `/api/admin/v1` from
 * the operation table (`operations.ts`) and the Zod contracts (`components.ts`).
 * Pure and deterministic: the API serves the result (built once at start-up) and
 * `pnpm openapi:generate` writes the same documents to `docs/api/`.
 */
import { readFileSync } from 'node:fs';
import { MAINTENANCE_JOB_NAME_PATTERN } from '@oecp/schemas';
import type { z } from 'zod';
import { ON_DEMAND_JOBS } from '../maintenance/maintenance.constants.js';
import { componentSchemas, inlineSchema, type JsonSchema, schemaRef } from './components.js';
import {
  ADMIN_OPERATIONS,
  API_BASE,
  type ApiName,
  type HeaderName,
  type OperationSpec,
  PUBLIC_OPERATIONS,
  type PathParameter,
  type QuerySpec,
  type ResponseSpec,
} from './operations.js';

export type OpenApiDocument = Record<string, unknown> & {
  info: { version: string };
  paths: Record<string, Record<string, Record<string, unknown>>>;
};

export interface OpenApiDocuments {
  public: OpenApiDocument;
  admin: OpenApiDocument;
}

export const OPENAPI_FILE_NAMES: Readonly<Record<ApiName, string>> = {
  public: 'oecp-public-api.openapi.json',
  admin: 'oecp-admin-api.openapi.json',
};

const SPEC_URL = 'https://github.com/LAArino/AURORA-OECP/blob/main/docs/spec-v4.1.md';
const PROBLEM_JSON = 'application/problem+json';
/** `Cache-Control` of the served documents. */
export const OPENAPI_CACHE = 'public, max-age=3600';

/** `version` of the repository root `package.json` (src/openapi and dist/openapi alike). */
export function rootPackageVersion(): string {
  const file = new URL('../../../../package.json', import.meta.url);
  const { version } = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
  if (typeof version !== 'string') throw new Error(`No version in ${file.pathname}`);
  return version;
}

/* ------------------------------------------------------------- shared objects */

const uuidParam = (name: string, description: string): JsonSchema => ({
  name,
  in: 'path',
  required: true,
  description: `${description} A malformed UUID answers 400.`,
  schema: { type: 'string', format: 'uuid' },
});

const PATH_PARAMETERS: Readonly<Record<PathParameter, JsonSchema>> = {
  PublicCourseId: {
    name: 'courseId',
    in: 'path',
    required: true,
    description: 'Course id (UUID). Malformed, unknown, unpublished or deleted ids answer 404.',
    schema: { type: 'string', format: 'uuid' },
  },
  OrgId: uuidParam('orgId', 'Organization id.'),
  OrganizationId: uuidParam('id', 'Organization id.'),
  InvitationId: uuidParam('id', 'Invitation id.'),
  CourseId: uuidParam('id', 'Course id.'),
  OfferingId: uuidParam('id', 'Offering id.'),
  SyncRunId: uuidParam('id', 'Sync run id.'),
  AdminSub: {
    name: 'sub',
    in: 'path',
    required: true,
    description: 'Keycloak user id (`sub` claim).',
    schema: { type: 'string', pattern: '^[A-Za-z0-9-]{1,64}$' },
  },
  MaintenanceJobName: {
    name: 'name',
    in: 'path',
    required: true,
    description: 'On-demand job name; other names answer 404.',
    schema: {
      type: 'string',
      pattern: MAINTENANCE_JOB_NAME_PATTERN.source,
      enum: [...ON_DEMAND_JOBS],
    },
  },
};

const HEADERS: Readonly<Record<HeaderName, JsonSchema>> = {
  'Cache-Control': {
    description:
      'Set on successful responses only: `public, max-age=60` (search, suggest), `public, max-age=300` (course, reference, sitemap), `public, max-age=3600` (OpenAPI documents). Errors are never cached.',
    schema: { type: 'string' },
  },
  ETag: {
    description: 'Weak entity tag of the body; send it back in `If-None-Match` to get a 304.',
    schema: { type: 'string' },
  },
  Location: {
    description:
      'Path of the created resource (uploads: the sync run, `/api/admin/v1/sync-runs/{id}`).',
    schema: { type: 'string' },
  },
  'Retry-After': {
    description: 'Seconds to wait before retrying.',
    schema: { type: 'integer', minimum: 0 },
  },
  'Content-Disposition': {
    description: 'Suggested file name (`attachment` for templates, `inline` for the JSON Schema).',
    schema: { type: 'string' },
  },
  'X-Content-Type-Options': { description: '`nosniff`.', schema: { type: 'string' } },
};

const problemContent = (schema = 'ProblemDetails') => ({
  [PROBLEM_JSON]: { schema: schemaRef(schema) },
});

const RESPONSES: Readonly<Record<string, JsonSchema>> = {
  NotModified: {
    description: 'The `If-None-Match` entity tag matches: no body.',
    headers: { ETag: { $ref: '#/components/headers/ETag' } },
  },
  BadRequest: {
    description:
      'Malformed request: query, path or body shape (`oecp.request.validation_failed`, with a JSON pointer per error), or a malformed UUID in the path.',
    content: problemContent(),
  },
  Unauthorized: {
    description:
      'No usable token: `oecp.auth.missing_token`, `oecp.auth.invalid_token` (signature, issuer, audience, `azp`, expiry), `oecp.auth.insufficient_acr` (no MFA; RFC 9470 step-up challenge in `WWW-Authenticate`).',
    headers: {
      'WWW-Authenticate': {
        description:
          '`Bearer`, `Bearer error="invalid_token"`, or `Bearer error="insufficient_user_authentication", acr_values="mfa"`.',
        schema: { type: 'string' },
      },
    },
    content: problemContent(),
  },
  Forbidden: {
    description:
      'Authenticated but not allowed: `oecp.auth.no_role`, `oecp.auth.unknown_organization` (`org_id` claim missing or not an active organization), `oecp.auth.idp_mismatch` (the `idp` claim is not the organization IdP), `oecp.auth.forbidden_role` (role not in `x-oecp-roles`), `oecp.auth.forbidden_organization` (organization outside the caller scope).',
    content: problemContent(),
  },
  TooManyRequests: {
    description:
      'Per-client rate limit of the edge proxy (Traefik); plain text, not problem+json. Retry later.',
    content: { 'text/plain': { schema: { type: 'string' } } },
  },
};

const IF_NONE_MATCH: JsonSchema = {
  name: 'If-None-Match',
  in: 'header',
  required: false,
  description: 'Entity tag of a cached copy; a match answers 304 without a body.',
  schema: { type: 'string' },
};

/* ------------------------------------------------------------- operations */

function unwrapObject(schema: z.ZodType): Record<string, z.ZodType> {
  const def = schema._zod.def as unknown as {
    type: string;
    in?: z.ZodType;
    out?: z.ZodType;
    shape?: Record<string, z.ZodType>;
  };
  if (def.type === 'object' && def.shape) return def.shape;
  if (def.type === 'pipe' && def.in && def.out) {
    // z.preprocess(fn, object): the input side is the transform, the shape is `out`.
    const inType = (def.in._zod.def as { type: string }).type;
    return unwrapObject(inType === 'transform' ? def.out : def.in);
  }
  throw new Error(`Query schema is not an object (${def.type})`);
}

function queryParameters(query: QuerySpec, operationId: string): JsonSchema[] {
  const shape = unwrapObject(query.schema);
  const names = Object.keys(shape).filter((name) => !query.skip?.includes(name));
  for (const name of Object.keys(query.descriptions)) {
    if (!names.includes(name)) throw new Error(`${operationId}: no query parameter ${name}`);
  }
  return names.map((name) => {
    const field = shape[name] as z.ZodType;
    const description = query.descriptions[name];
    if (!description) throw new Error(`${operationId}: query parameter ${name} has no description`);
    const schema = inlineSchema(field, 'input');
    const parameter: JsonSchema = {
      name,
      in: 'query',
      required: !field.safeParse(undefined).success,
      description,
      schema,
    };
    if (schema['type'] === 'array') {
      parameter['style'] = 'form';
      parameter['explode'] = true;
    }
    return parameter;
  });
}

function headerRefs(headers: readonly HeaderName[] | undefined): JsonSchema | undefined {
  if (!headers?.length) return undefined;
  return Object.fromEntries(
    headers.map((name) => [name, { $ref: `#/components/headers/${name}` }]),
  );
}

function successResponse(spec: ResponseSpec): JsonSchema {
  const response: JsonSchema = { description: spec.description };
  const headers = headerRefs(spec.headers);
  if (headers) response['headers'] = headers;
  if (spec.schema !== undefined) {
    const schema = typeof spec.schema === 'string' ? schemaRef(spec.schema) : spec.schema;
    response['content'] = { [spec.contentType ?? 'application/json']: { schema } };
  }
  return response;
}

function errorResponse(status: number, description: string, operationId: string): JsonSchema {
  const response: JsonSchema = {
    description,
    content: problemContent(
      operationId === 'adminUploadCsv' && status === 422 ? 'CsvUploadProblem' : 'ProblemDetails',
    ),
  };
  const retryAfter = status === 429;
  const location = operationId === 'adminUploadCsv' && (status === 422 || status === 503);
  if (retryAfter || location) {
    response['headers'] = headerRefs([
      ...(retryAfter ? ['Retry-After' as const] : []),
      ...(location ? ['Location' as const] : []),
    ]);
  }
  return response;
}

const CSV_MULTIPART_BODY: JsonSchema = {
  required: true,
  description:
    'At least one of the file parts `courses` and `offerings` (one file each, UTF-8 CSV, template 1.2; 1.0 and 1.1 accepted). No other parts.',
  content: {
    'multipart/form-data': {
      schema: {
        type: 'object',
        properties: {
          courses: { type: 'string', contentMediaType: 'text/csv', description: '`courses.csv`.' },
          offerings: {
            type: 'string',
            contentMediaType: 'text/csv',
            description: '`offerings.csv`.',
          },
        },
        minProperties: 1,
        additionalProperties: false,
      },
      encoding: {
        courses: { contentType: 'text/csv' },
        offerings: { contentType: 'text/csv' },
      },
    },
  },
};

function operationObject(api: ApiName, op: OperationSpec): Record<string, unknown> {
  const anonymous = api === 'public' || op.access?.includes('anonymous') === true;
  const parameters: JsonSchema[] = (op.params ?? []).map((name) => ({
    $ref: `#/components/parameters/${name}`,
  }));
  if (op.query) parameters.push(...queryParameters(op.query, op.operationId));
  if (api === 'public' && op.method === 'get') {
    parameters.push({ $ref: '#/components/parameters/IfNoneMatch' });
  }

  const responses: Record<string, JsonSchema> = {};
  for (const [status, spec] of Object.entries(op.responses)) {
    responses[status] = successResponse(spec);
  }
  if (api === 'public' && op.method === 'get') {
    responses['304'] = { $ref: '#/components/responses/NotModified' };
  }
  const errors: Record<number, string> = { ...op.errors };
  const hasUuidParam = (op.params ?? []).some(
    (p) => p !== 'PublicCourseId' && p !== 'AdminSub' && p !== 'MaintenanceJobName',
  );
  const takesInput = op.query !== undefined || op.body !== undefined || hasUuidParam;
  if (takesInput && errors[400] === undefined)
    responses['400'] = { $ref: '#/components/responses/BadRequest' };
  if (!anonymous) {
    responses['401'] = { $ref: '#/components/responses/Unauthorized' };
    if (errors[403] === undefined) responses['403'] = { $ref: '#/components/responses/Forbidden' };
    else errors[403] = `${errors[403]} Also the authorization failures of \`Forbidden\`.`;
  }
  for (const [status, description] of Object.entries(errors)) {
    responses[status] = errorResponse(Number(status), description, op.operationId);
  }
  if (
    api === 'public' &&
    (op.operationId === 'publicSearchCourses' || op.operationId === 'publicSuggest')
  ) {
    responses['429'] = { $ref: '#/components/responses/TooManyRequests' };
  }

  const operation: Record<string, unknown> = {
    operationId: op.operationId,
    tags: [op.tag],
    summary: op.summary,
  };
  if (op.description) operation['description'] = op.description;
  if (parameters.length) operation['parameters'] = parameters;
  if (op.body === 'csv-multipart') {
    operation['requestBody'] = CSV_MULTIPART_BODY;
  } else if (op.body) {
    operation['requestBody'] = {
      required: op.body.required ?? true,
      content: { 'application/json': { schema: schemaRef(op.body.schema) } },
    };
  }
  operation['responses'] = Object.fromEntries(
    Object.entries(responses).sort(([a], [b]) => Number(a) - Number(b)),
  );
  if (api === 'admin') {
    if (anonymous) operation['security'] = [];
    operation['x-oecp-roles'] = [...(op.access ?? [])];
  }
  return operation;
}

/* ------------------------------------------------------------- documents */

const COMMON_DESCRIPTION = `**Conventions.** JSON members are snake_case (as the database); multilingual short labels are objects \`{en, <lang>…}\` that always contain \`en\`; dates are \`YYYY-MM-DD\` local to the offering \`timezone\`, timestamps ISO 8601 UTC; absent values are \`null\`, never omitted. Every error is RFC 9457 \`application/problem+json\` (\`ProblemDetails\`) with stable codes in \`errors[].code\` (spec §6.6, Appendix A).

The schemas are generated from the Zod contracts of \`@oecp/schemas\`, the single source of truth the API validates with. The OEAPI v5-compatible read API under \`/oeapi/v5\` (spec §9) is not described here: it follows the OEAPI v5.0 standard and its own OpenAPI document.`;

const PUBLIC_DESCRIPTION = `Anonymous, read-only catalogue API used by the portal (spec §7). No cookies, no authentication.

**Caching.** Successful responses carry \`Cache-Control\` (\`public, max-age=60\` for search and suggest, \`public, max-age=300\` for course pages, reference data and the sitemap) and a weak \`ETag\`; a matching \`If-None-Match\` answers 304. Errors are not cached.

**Rate limits.** Per client address at the edge proxy (spec §10): search 20 requests/s (burst 40), suggest 10/s (burst 20); other paths are not limited. Excess requests get 429 in plain text.

**Versioning.** Additive only: new endpoints, optional parameters and response members may be added; nothing is removed, renamed or given a new meaning. A breaking change means \`/api/public/v2\`, served alongside v1 for at least one minor release (\`docs/RELEASING.md\`).

${COMMON_DESCRIPTION}`;

const ADMIN_DESCRIPTION = `Administration API of the dashboard (spec §8): invitations, organizations and their administrators, Channel A integration settings and sync runs, Channel B CSV uploads, Channel C course and offering writes with overrides, network status and maintenance jobs. Bearer-only (spec §4, \`bearerAuth\`); the roles allowed on each operation are listed in the extension \`x-oecp-roles\` (\`partner_admin\` limited to its organization and sub-units, \`alliance_admin\` everywhere, \`role-less\` a valid token without OECP roles, \`anonymous\` no token).

**Rate limits.** 30 requests/s per client address (burst 60) at the edge proxy (spec §10), plus the application limits of \`sync-now\` and CSV uploads (429 with \`Retry-After\`).

**Versioning.** Consumed by the dashboard of the same release; changes are listed in the CHANGELOG with a minor version note. External clients are not supported before 1.0 (\`docs/RELEASING.md\`).

${COMMON_DESCRIPTION}`;

const BEARER_DESCRIPTION = `Access token (JWT, RS256) issued by the OECP Keycloak realm to the \`oecp-admin\` client, sent as \`Authorization: Bearer <token>\`. The API verifies the signature with the realm JWKS and requires:

- \`iss\` = the realm issuer (\`KEYCLOAK_ISSUER\`); \`exp\`/\`iat\` (30 s clock tolerance);
- \`aud\` contains \`oecp-api\`; \`azp\` = \`oecp-admin\`;
- \`acr\` = \`mfa\` (otherwise 401 \`oecp.auth.insufficient_acr\` with an RFC 9470 step-up challenge);
- \`roles\`: flat array of realm roles, of which \`partner_admin\` and \`alliance_admin\` count; empty only on the operations whose \`x-oecp-roles\` include \`role-less\`;
- \`org_id\` (UUID, from the user attribute \`oecp_org_id\`): required with a role, must be an active organization;
- \`idp\`: Keycloak broker alias of the sign-in (missing = \`local\`), must equal the organization \`keycloak_idp_alias\` (or \`local\`);
- optional \`email\`, \`name\`, \`schac_home_organization\` (checked at invitation acceptance).`;

const TAG_DESCRIPTIONS: Readonly<Record<string, string>> = {
  Catalogue: 'Search, course pages, suggestions, reference data and the sitemap (spec §7.1).',
  'API description': 'This OpenAPI document.',
  Account: 'The signed-in administrator (spec §4).',
  Invitations: 'Inviting administrators and accepting invitations (spec §2.1).',
  Organizations: 'Organizations of the alliance and their hierarchy (spec §8.4).',
  Administrators: 'Keycloak accounts administering an organization (spec §2.2, §8.4).',
  Integrations:
    'Channel A: OEAPI harvesting settings, host approval, test and manual runs (spec §6.2).',
  'Sync runs': 'Runs of every channel with their errors and warnings (spec §8.1 sync monitor).',
  'CSV uploads': 'Channel B: CSV uploads, templates and JSON Schema (spec §6.3).',
  Courses:
    'Channel C: courses written through the web form, overrides on harvested ones, history (spec §6.4, §8.3).',
  Offerings: 'Channel C: offerings of a course, overrides on harvested ones (spec §6.4, §8.3).',
  'Network status': 'Health of the data supply of every organization (spec §8.4).',
  Maintenance: 'Runs of the worker maintenance jobs and on-demand runs (spec §10).',
};

function tags(operations: readonly OperationSpec[]): JsonSchema[] {
  return [...new Set(operations.map((op) => op.tag))].map((name) => {
    const description = TAG_DESCRIPTIONS[name];
    if (!description) throw new Error(`Tag ${name} has no description`);
    return { name, description };
  });
}

function collectRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') into.add(item);
      else collectRefs(item, into);
    }
  }
}

/** Keeps the components the document references, transitively. */
function pruneComponents(
  paths: unknown,
  all: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const used = new Set<string>();
  const pending = new Set<string>();
  collectRefs(paths, pending);
  while (pending.size) {
    const [ref] = pending as Set<string>;
    pending.delete(ref as string);
    if (used.has(ref as string)) continue;
    used.add(ref as string);
    const [, , section, name] = (ref as string).split('/');
    const target = all[section as string]?.[name as string];
    if (target === undefined) throw new Error(`Unresolved reference ${ref}`);
    const nested = new Set<string>();
    collectRefs(target, nested);
    for (const r of nested) if (!used.has(r)) pending.add(r);
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [section, entries] of Object.entries(all)) {
    const kept = Object.entries(entries).filter(([name]) =>
      used.has(`#/components/${section}/${name}`),
    );
    if (kept.length) out[section] = Object.fromEntries(kept);
  }
  return out;
}

function buildDocument(
  api: ApiName,
  operations: readonly OperationSpec[],
  version: string,
  schemas: Record<string, JsonSchema>,
): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  const operationIds = new Set<string>();
  for (const op of operations) {
    if (operationIds.has(op.operationId))
      throw new Error(`Duplicate operationId ${op.operationId}`);
    operationIds.add(op.operationId);
    const path = API_BASE[api] + op.path;
    const item = (paths[path] ??= {});
    if (item[op.method]) throw new Error(`Duplicate operation ${op.method.toUpperCase()} ${path}`);
    item[op.method] = operationObject(api, op);
  }
  const sortedPaths = Object.fromEntries(
    Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)),
  );
  const components = pruneComponents(sortedPaths, {
    schemas,
    parameters: { ...PATH_PARAMETERS, IfNoneMatch: IF_NONE_MATCH },
    headers: HEADERS,
    responses: RESPONSES,
  });
  if (api === 'admin') {
    components['securitySchemes'] = {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: BEARER_DESCRIPTION,
      },
    };
  }

  return {
    openapi: '3.1.1',
    info: {
      title: api === 'public' ? 'OECP public catalogue API' : 'OECP admin API',
      version,
      description: api === 'public' ? PUBLIC_DESCRIPTION : ADMIN_DESCRIPTION,
      license: { name: 'EUPL-1.2', identifier: 'EUPL-1.2' },
      'x-oecp-spec': `${SPEC_URL}#${api === 'public' ? '71-routes-and-api' : '82-admin-api-apiadminv1-implemented'}`,
    },
    externalDocs: { description: 'OECP specification v4.1', url: SPEC_URL },
    servers: [{ url: '/', description: 'The portal origin (e.g. `https://campus.example.org`).' }],
    // Public: explicitly no authentication; admin: a bearer token unless an operation says otherwise.
    security: api === 'admin' ? [{ bearerAuth: [] }] : [],
    tags: tags(operations),
    paths: sortedPaths,
    components,
  } as OpenApiDocument;
}

/** Both documents; `version` is the release (root `package.json`). */
export function buildOpenApiDocuments(version: string): OpenApiDocuments {
  const schemas = componentSchemas();
  return {
    public: buildDocument('public', PUBLIC_OPERATIONS, version, schemas),
    admin: buildDocument('admin', ADMIN_OPERATIONS, version, schemas),
  };
}

/** Serialization used for `docs/api/*.json` (stable, two-space indent, final newline). */
export function serializeOpenApiDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
