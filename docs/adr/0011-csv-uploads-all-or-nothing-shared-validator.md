<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0011: All-or-nothing CSV uploads with a shared validator and versioned templates

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R02] `docs/review/02-modelo-datos-ingesta.md`, [R03] `docs/review/03-arquitectura-stack-licencias.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

Six Aurora members have no OEAPI endpoint and several have declared no
technical capacity, so CSV upload is a main channel, not an exception [DL 4].
The people preparing these files are staff working in spreadsheet programs,
often with semicolon-separated exports in EU locales. They need precise
feedback (file, row, column, code) before anything is published, and a
failed upload must not leave the catalogue half-updated: a course published
without its offerings, or offerings pointing at a course that was rejected.

Spec v4.0 §6.3 defined template 1.0, server revalidation and "any error
writes nothing", and planned Papa Parse plus Ajv against a JSON Schema in the
browser. Building the console showed that several rules cannot be expressed in
JSON Schema (calendar dates, date order, seats, IANA time zones, BCP 47 tags,
duplicate ISCED codes, cross-row and reference checks), so a JSON-Schema-only
validator in the browser would accept files the server then refuses.
Decision 18 later added columns (`kind`, `levels`, `attr_<key>`,
`application_instructions_<lang>`) while files in the 1.0 layout must keep
working [DL 18].

How are CSV uploads validated and applied, and how does the template evolve?

## Decision drivers

- The browser and the server give the same verdict for the same file.
- No partial writes: one upload is one consistent change.
- Clear, stable error codes per cell (spec §6.6).
- Existing files keep working when the template grows.
- No heavy parsing dependency in the browser bundle or the API image.

## Considered options

1. One TypeScript validator in `@oecp/schemas` used by browser and server;
   all-or-nothing transactional apply; `template_version` per row.
2. JSON Schema with Ajv on both sides (spec v4.0 plan), extra checks on the
   server only.
3. Best-effort apply: write valid rows, report the rest.

## Decision outcome

Chosen option: **a shared validator, all-or-nothing apply, versioned
templates** (spec §6.3, §6.6).

As built (`packages/schemas/src/csv.ts`, `csv-validate.ts`;
`apps/api/src/ingestion/csv/`; `apps/api/src/admin/uploads/`;
`apps/web/app/workers/csv-validate.worker.ts`):

- **One validator.** `decodeCsvBytes` (UTF-8, BOM) → `parseCsvText` (RFC 4180,
  comma or semicolon detection, limits) → `validateCsvRows`/`validateCsvFiles`
  (header rules, Zod row schemas including the row-local DDL rules,
  cross-row and reference checks) → normalised rows. It depends only on Zod
  and runs in a Web Worker in the admin console (main-thread fallback) and in
  the api. Every issue carries file, row (header = row 1), column and an
  `errors.json` code.
- **JSON Schema as a published artefact.** `oecp-csv-<version>.schema.json`
  (2020-12) is generated from the Zod schemas by
  `packages/schemas/scripts/generate-json.mjs` and committed, for partners who
  generate CSV automatically; the rules it cannot express are documented.
- **All-or-nothing.** `POST /api/admin/v1/organizations/{orgId}/uploads`
  revalidates with database reference data. Any error fails the run and
  writes only `sync_errors`; otherwise academic sessions, courses and then
  offerings are upserted through `CanonicalWriter.transaction()` in one
  database transaction. Warnings pass. Up to 500 rows run in the request
  (201 or 422); larger uploads run as BullMQ job `csv-{syncRunId}` (202).
  Omitting a record never withdraws it; `status` does.
- **Template versions.** Each row declares `template_version`. Generated
  templates are 1.1 (`CSV_TEMPLATE_VERSION`); 1.0 and 1.1 are accepted
  (`CSV_TEMPLATE_VERSIONS`), and a 1.0 file may not use 1.1 columns
  (`oecp.csv.invalid_template_version`). Runs record `schema_version`
  `csv-1.1`. A published schema file is never edited; CONTRIBUTING requires a
  version to stay accepted for at least one release after its successor.
- **CSV injection.** Values are stored verbatim; every CSV OECP generates
  neutralises cells starting with `=`, `+`, `-`, `@`, TAB or CR.

### Consequences

- Good, because the console's verdict matches the server's, so "valid in the
  browser" means the upload will be accepted unless reference data changed.
- Good, because a failed upload changes nothing and can be fixed and
  re-uploaded as a whole.
- Good, because template growth is additive and old files stay valid.
- Bad, because one bad row blocks the whole file; large partners must fix
  every error before anything is published.
- Bad, because the generated JSON Schema is weaker than the validator; a
  partner validating only against it can still be refused.
- Bad, because the CSV JSON Schema does not yet `$ref` the canonical schema
  (`docs/backlog.md`).

### Confirmation

`packages/schemas/test/csv.test.ts`, `csv-validate.test.ts`; api
`apps/api/test/unit/csv.adapter.test.ts` and `apps/api/test/integration/csv-upload.int.test.ts`
(rollback on error, inline and queued runs); `apps/web/test/admin-csv.test.ts`.

## Pros and cons of the options

### Shared validator, all-or-nothing, versioned templates

- Good, because of one rule set and consistent writes.
- Bad, because a TypeScript validator is not reusable outside JavaScript.

### JSON Schema and Ajv on both sides

- Good, because the schema is language-neutral.
- Bad, because cross-row, reference and calendar rules would run on the
  server only, so browser and server would disagree.

### Best-effort apply

- Good, because valid rows publish at once.
- Bad, because offerings can land without their course and partners cannot
  tell which state the catalogue is in.

## More information

- Spec §6.3, §6.6, §10 (CSV injection); [DL 4], [DL 18].
- Related: [ADR-0012](0012-alliance-course-attributes-as-validated-jsonb.md),
  [ADR-0010](0010-overrides-on-harvested-records.md).
