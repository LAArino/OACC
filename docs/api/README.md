<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# API descriptions (OpenAPI 3.1)

| File | API | Served at |
|---|---|---|
| [oecp-public-api.openapi.json](oecp-public-api.openapi.json) | Public catalogue API, `/api/public/v1` (spec §7): anonymous, read-only | `GET /api/public/v1/openapi.json` |
| [oecp-admin-api.openapi.json](oecp-admin-api.openapi.json) | Admin API, `/api/admin/v1` (spec §8): bearer tokens from Keycloak | `GET /api/admin/v1/openapi.json` |

The OEAPI v5-compatible read API (`/oeapi/v5`, spec §9) is not described here: it follows the [OEAPI v5.0 standard](https://openonderwijsapi.nl/) and its own OpenAPI document (vendored for the mock partner in `tools/oeapi-mock/spec/`).

## What they are

Both documents are **generated**, never edited by hand. The generator (`apps/api/src/openapi/`) combines:

- `operations.ts`: one entry per route of the catalogue and admin controllers (method, path, operation id, tag, summary and description from the specification, path and query parameters, request body, success responses with their headers, error responses with their stable codes, and the roles in `x-oecp-roles`);
- `components.ts`: the request and response schemas, converted from the Zod contracts of `@oecp/schemas` (the single source of truth the API validates with) by Zod 4's native `z.toJSONSchema` (JSON Schema 2020-12, the dialect of OpenAPI 3.1). Request bodies and query parameters are converted as input types (defaults optional, transforms ignored), responses as output types. Named schemas become `#/components/schemas/<Name>` and are referenced wherever they occur;
- `document.ts`: assembles each document (shared parameters, headers, responses, `bearerAuth`, `ProblemDetails`) and keeps only the components it references.

Conventions in the documents:

- **Errors** are `application/problem+json` (RFC 9457) with the shared `ProblemDetails` schema; `errors[].code` is the `ErrorCode` enumeration of the 138 stable codes (`packages/schemas/errors.json`), listed by prefix in its description. Each operation lists the statuses it can return and the codes behind them. The `reason` member of `oecp.invitation.mismatch`, the `idp_alias` member of `oecp.invitation.idp_not_enabled` and the extension members of a failed inline CSV upload (`CsvUploadProblem`) are documented.
- **Public API:** no security; `Cache-Control` and weak `ETag` on success, 304 for a matching `If-None-Match`; repeatable filters are `style: form, explode: true` arrays; the aliases (`ectsMin`/`ects_min`, `pageSize`/`page_size`, `locale`/`lang` on suggest) are separate parameters; `attr_<key>` filters are described in the search operation (their names are not fixed); the edge rate limits are in the description and as 429 on search and suggest.
- **Admin API:** global security `bearerAuth` (the required JWT claims are in its description); `x-oecp-roles` lists `partner_admin`, `alliance_admin`, `role-less` (a valid token without OECP roles) or `anonymous` (only the document itself); 401 and 403 are shared responses with their codes.
- `info.version` is the release (root `package.json`), `info.license` EUPL-1.2, `info.x-oecp-spec` links the section of [the specification](../spec-v4.1.md).

`apps/api/test/unit/openapi.test.ts` (part of `pnpm test`) fails when the documents are not valid OpenAPI 3.1 (`@seriousme/openapi-schema-validator`, plus every component schema compiled by Ajv 2020), when a route or method registered by the Nest application under `/api/public/v1` or `/api/admin/v1` is missing from a document or a documented one does not exist, when the roles or the success status differ from the controllers' guards and `@HttpCode`, when the error code enumeration differs from `errors.json`, and when the committed files are not what the generator produces.

## How to regenerate

```sh
pnpm openapi:generate   # builds @oecp/schemas and the API, writes docs/api/*.json
pnpm openapi:check      # the same, validates, and fails if the committed files differ (CI)
```

Run `pnpm openapi:generate` after changing a controller route, a Zod contract in `packages/schemas`, an error code or the operation table, and commit both JSON files with the change. A new route must be added to `apps/api/src/openapi/operations.ts`; the coverage test names it otherwise.

## How to view

The API serves the documents built at start-up (`Cache-Control: public, max-age=3600`, anonymous for both APIs: the admin document describes the API, it grants nothing):

```sh
curl -sk https://oecp.localhost/api/public/v1/openapi.json | jq '.info, (.paths | keys)'
curl -sk https://oecp.localhost/api/admin/v1/openapi.json  | jq '.info, (.paths | keys)'
```

There is no HTML viewer in the API: `/api` responses carry the Content-Security-Policy `default-src 'none'` from Traefik (spec §10), which a renderer page would have to relax, and vendoring a renderer is not worth it for two documents. Open a file in any OpenAPI 3.1 viewer instead, for example:

- `npx @redocly/cli build-docs docs/api/oecp-public-api.openapi.json -o public-api.html` (a static Redoc page to open in a browser);
- the Swagger Editor (`docker run -p 8080:8080 swaggerapi/swagger-editor`, then *File > Import file*);
- an editor extension (e.g. *OpenAPI (Swagger) Editor* for VS Code).

A self-hosted viewer under `/api/*/docs` is in the [backlog](../backlog.md).

## Versioning

- **Public API:** additive only. New endpoints, optional parameters and response members may appear in any release; nothing is removed, renamed or given a new meaning. A breaking change means `/api/public/v2`, served alongside v1 for at least one minor release ([RELEASING.md](../RELEASING.md)).
- **Admin API:** consumed by the dashboard of the same release; it may change in a minor version, with a note in the CHANGELOG. External clients are not supported before 1.0.
- **Error codes** are never renamed, reused or repurposed; new codes may be added, so clients must accept values outside the enumeration they were built with.
