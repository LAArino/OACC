<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Specification v4.0 as the implementation baseline (`docs/spec-v4.0.md`).
- Licensing under EUPL-1.2 with REUSE 3.2 metadata (`REUSE.toml`, `LICENSES/`).
- Governance and contribution documents: `README.md`, `CONTRIBUTING.md`
  (DCO sign-off, no CLA), `DCO`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `SECURITY.md`, `GOVERNANCE.md` and `publiccode.yml`.
- Architecture decision records 0001–0006 in `docs/adr/`.
- Admin onboarding (spec §2.1): Keycloak Admin API client for the confidential
  client `oecp-backend`; admin invitations (`POST`/`GET /api/admin/v1/invitations`,
  `DELETE /api/admin/v1/invitations/{id}`, `POST /api/admin/v1/invitations/accept`)
  with SHA-256-only token storage, fragment links, e-mail via SMTP (log fallback)
  and audit log rows; `GET /api/admin/v1/me` for role-less tokens.
- `oecp` CLI (`node dist/cli.js`): `seed-organizations` (upsert by slug; Aurora
  seed in `apps/api/db/seed/`) and `bootstrap-alliance-admin`.
- Docker Compose profile `dev` with Mailpit (`axllent/mailpit:v1.31.5`) as
  SMTP sink for Keycloak and the api (UI on `http://127.0.0.1:8025`), and
  `OECP_SMTP_STARTTLS` for relays without TLS.
- Traefik middleware `security-headers-api`: `Content-Security-Policy:
  default-src 'none'; frame-ancestors 'none'` on `/api` and `/oeapi`.
- Channel A, scheduled OEAPI v5 harvester (spec §6.2), in `apps/api`:
  - `packages/schemas`: Zod schemas of the OEAPI v5.0 resources the harvester
    reads (`oeapi-v5.ts`: page envelope, Organization, Course, CourseOffering,
    AcademicSession, Service), admin contracts of integrations and sync runs
    (`integrations.ts`) and their stable error codes (`oecp.oeapi.*`,
    `oecp.integration.*`, `oecp.secrets.unavailable`).
  - `SecretsService` (`secret_ref` `db:<uuid>`): AES-256-GCM in the `secrets`
    table with the master key from `OECP_MASTER_KEY_FILE`, `key_version` 1, AAD
    bound to row and purpose; CLI `oecp store-secret --purpose <label>` (secret
    on stdin, prints the reference, e.g. for `SURFEDUHUB_SECRET_REF`).
  - OEAPI v5 client: `direct` (none/basic/bearer/API-key header) and
    `surfeduhub` (`X-Route`) access, `consumer` on every request, `pageNumber`
    paging until `hasNextPage = false` (1,000-page cap), 30 s timeout, 5 retries
    with exponential backoff and jitter honouring `Retry-After`, token bucket at
    `max_requests_per_second`, 20 MB bodies, SSRF protection (https:443 only,
    approved host, DNS resolved, checked and pinned per request, no loopback,
    private, link-local, CGNAT, ULA or multicast addresses, same-origin
    redirects only, at most 3).
  - Mapping v5 → canonical (spec §6.2.4) with JSON-Pointer warnings and
    rejections, ISO 639-2/B and /T → ISO 639-1 normalisation, `CanonicalWriter`
    (RFC 8785 + SHA-256 `content_hash`, overrides, `ext_metadata_history`,
    `sync_errors`, withdrawal by absence with the 30% mass-absence guard) and
    `HarvestService` (run status, completeness, counters, 2 h limit).
  - Worker: BullMQ job scheduler per enabled partner (`schedule_cron` in
    `schedule_timezone`, re-registered at start and every 15 minutes) feeding
    deduplicated `harvest-{organization_id}` jobs.
  - Admin API: `GET`/`PUT /api/admin/v1/organizations/{orgId}/integration`,
    `POST …/integration/approve-host` (alliance_admin), `…/test-connection`,
    `…/sync-now` (once per 15 minutes), `GET …/sync-runs?limit=` and
    `GET /api/admin/v1/sync-runs/{id}` with paginated errors; audited.
  - Environment: `SURFEDUHUB_GATEWAY_URL`, `SURFEDUHUB_SECRET_REF`,
    `OECP_ALLOW_INSECURE_PARTNER_HTTP` (development only: http, other ports and
    private addresses for partner endpoints such as the OEAPI mock).
  - Integration tests against a throwaway PostgreSQL (`DATABASE_URL_TEST`; the
    suites are skipped without it).
- Channel B, CSV upload (spec §6.3, §6.5, §6.6, §10):
  - `packages/schemas`: browser-safe shared validator `csv-validate.ts`
    (`decodeCsvBytes`, `parseCsvText` RFC 4180 reader with BOM stripping,
    comma/semicolon detection and limits, `validateCsvRows`/`validateCsvText`/
    `validateCsvFiles` with header, cross-row and reference checks and
    normalized rows, `formatCsv`/`neutralizeCsvCell` CSV-injection-safe output,
    `csvTemplate`, `csvIssuesReport`); row schemas now also enforce the row-local
    DDL rules (calendar dates, date order, seats, IANA time zone, BCP 47 tags,
    duplicate ISCED codes) and report one issue per cell; limits and column
    lists exported; new codes `oecp.csv.duplicate_column`, `field_count`,
    `empty_file`, `text_without_title`, `language_deleted`, `no_data_rows`,
    `no_files`, `unexpected_file`, `write_failed`.
  - `POST /api/admin/v1/organizations/{orgId}/uploads` (multipart `courses`
    and/or `offerings`; partner_admin of the organization or alliance_admin):
    refused (409 `oecp.sync.channel_disabled`) for organizations whose
    authoritative channel is `oeapi`; 5 MB per file, 10 uploads per hour (429
    with `Retry-After`); files kept under `OECP_UPLOADS_DIR/<orgId>/<uploadId>/`;
    one `sync_runs` row (`csv`/`upload`, `csv-1.0`); up to 500 rows processed in
    the request (201, or 422 problem+json with file/row/column errors), larger
    uploads queued as BullMQ job `csv-{syncRunId}` (202). Processing revalidates
    with database reference data and is all-or-nothing: any error writes only
    `sync_errors`; otherwise sessions, courses then offerings are upserted
    through `CanonicalWriter` in one transaction. Audit rows `upload.create`,
    `upload.processed`.
  - `GET /api/admin/v1/csv-template/{courses,offerings}.csv` and
    `…/csv-template/schema.json`.
  - Worker: daily retention job deleting upload files older than 90 days
    (`upload_object_key` cleared, `upload.purge` audit row), unreferenced upload
    directories, and failing CSV runs stuck in `running` for 2 hours.
  - Environment: `OECP_UPLOADS_DIR` (default `/data/uploads`).
  - Test fixture `apps/api/test/fixtures/csv/aurora-virtual-campus.*.csv`: eight
    courses of the public Aurora Virtual Campus listing as a first real upload.
- Public catalogue in `apps/web` (spec §7, §10), server-rendered, no cookies,
  English UI with every string in `i18n/locales/en.json`:
  - Home `/{locale}`: intro with `NUXT_PUBLIC_ALLIANCE_NAME` (default "the
    alliance"), search with title suggestions (APG combobox/listbox, debounced,
    ≥ 2 characters, aborted when stale, nothing stored), quick links by ISCED
    broad field and by partner from `/reference` with facet counts, and the
    number of courses with upcoming offerings. It answers 200 even when the API
    is down (it is the web container's health probe).
  - Catalogue `/{locale}/courses`: GET form that works without JavaScript
    (filters: partner, delivery mode, teaching language, ISCED broad field,
    level, ECTS range, "include past offerings" = `upcoming=false`; sort;
    pagination links), all state in the URL using the API parameter names;
    with JavaScript, checkbox and sort changes apply in place, the result count
    is announced in a live region and focus moves to the results after chip
    removal or paging. Result cards, removable filter chips, empty state.
  - Course page `/{locale}/courses/{id}`: breadcrumb, back link to the previous
    results (same-origin `history.state.back` or referrer), key facts, course
    texts per language as tabs (`?text_lang=` links without JavaScript, `lang`
    on the panel), offerings with enrolment window, deadline (flagged when
    passed in the offering time zone), seats [DL 8], "Apply at {partner}" in a
    new tab showing the host, or a contact note; `<title>`, meta description,
    canonical URL and schema.org `Course`/`CourseInstance` JSON-LD.
  - `useCatalogueApi()` (typed, defensive normalisation, `locale` sent only for
    non-English UIs), `app/types/catalogue.ts`, error page `app/error.vue`
    (API 404 → 404; 501, 5xx and network errors → 503 "catalogue temporarily
    unavailable"), self-hosted base styles `app/assets/css/main.css` (AA
    contrast tokens, 16 px gutters, forced-colours and reduced-motion support).
  - `/robots.txt` (catalogue allowed; `/admin`, `/*/admin`, `/api/admin`
    disallowed; absolute `Sitemap:`) and `/sitemap.xml` proxied from
    `/api/public/v1/sitemap.xml`.
  - Tests: utilities, composable, components and pages with fixture-backed
    `useApi()`, axe-core checks of rendered markup (new dev dependency
    `axe-core` 4.14.0), colour-token contrast, and a contract test of the
    fixtures against `@oecp/schemas` response schemas. Development fixture
    server `apps/web/test/fixtures/server.mjs`.
- Public read APIs (spec §5 "Search", §7, §9, §10), in `apps/api`:
  - Migration `0004_search`: `course_texts.search_vector` regenerated per
    language configuration (`oecp_ts_config`: en, de, nl, it, fr, da, es, ca
    Snowball stemmers with `unaccent`; cs, is and others `oecp_simple`) with
    weights A title, B keywords and abstract, C description, learning outcomes,
    prerequisites and assessment; IMMUTABLE `oecp_search_fold(text)` =
    `lower(unaccent(text))` and the `pg_trgm` title index rebuilt on it; partial
    indexes for published courses and visible offerings; asserts the Snowball
    `catalan` configuration. Down migration restores 0001.
  - Catalogue API `/api/public/v1` (anonymous, no cookies, weak `ETag`;
    `Cache-Control: public, max-age=60` on `courses` and `suggest`, `300` on
    course pages, `reference` and `sitemap.xml`, none on errors):
    `GET /courses` (cards, `total`, disjunctive facet counts per partner, mode,
    teaching language, ISCED broad field and level; full-text search across all
    languages ranked by `ts_rank_cd` + 0.3 × title trigram similarity, word prefix
    and trigram typo tolerance for single words; filters `partner`, `mode`,
    `lang`, `isced`, `level`, `ectsMin`/`ectsMax`, `upcoming`; sort `relevance`,
    `title`, `start_date`; display language `locale`), `GET /courses/{id}`
    (all texts by language, offerings with sessions and seats, 404
    problem+json for unknown, unpublished or deleted courses), `GET /suggest`
    (up to 10 accent- and case-insensitive title matches), `GET /reference`,
    `GET /sitemap.xml`.
  - `packages/schemas`: additive query parameters in `public-api.ts` (`level`,
    `upcoming`, `locale`, `pageSize`, aliases `ects_min`/`ects_max`/`page_size`,
    `normalizeCourseSearch`; suggest `limit`/`locale`; OEAPI query schemas) and
    the response contracts in `public-responses.ts`.
  - OEAPI v5 read API `/oeapi/v5` replacing the 501 stubs: service document,
    organizations (alliance as `root`, partners and sub-units below),
    organization courses, courses (filters `consumer`, `teachingLanguage` in ISO
    639-2 B or T, `level`, `modeOfDelivery`, `q`; `sort`), course offerings (v5
    `since`/`until`), offerings (`expand=academicSession,course`) and academic
    sessions; reverse vocabularies of spec §9, values v5 cannot express in
    `ext.oecp` (seats, cancelled status, time zone, all teaching languages);
    v5 `Problem` errors; responses contract-tested with Ajv against the vendored
    v5.0 OpenAPI document (`ajv`, `ajv-formats` as dev dependencies).

### Changed

- Migration `0003_partner_base_url_http`: `partner_integrations.base_url` may
  hold an `http` URL; https on port 443 is enforced by the API and the
  harvester unless `OECP_ALLOW_INSECURE_PARTNER_HTTP=true`.
- api: arrays of the `language_tag` domain (`teaching_languages`,
  `ui_languages`) are parsed as string arrays instead of PostgreSQL literals.
- `CanonicalWriter.transaction()` runs several upserts in one transaction
  (CSV all-or-nothing); CSV and form writes set `courses.teaching_unit_id` from
  `teaching_unit_ext_id` (descendant organizations with that `ext_id`).

- Compose quick start verified end to end on Docker Desktop (macOS): default
  hosts `oecp.localhost` and `auth.oecp.localhost`, `up --build --wait`,
  `docker compose wait keycloak-config`; `/health` and `/ready` stay internal
  (api healthcheck now probes `/ready`, web probes `/en`).
- keycloak-config-cli runs with `IMPORT_CACHE_ENABLED=false`, so every run
  enforces `realm-oecp.yaml`; `6.5.1-26.5.5` verified against Keycloak 26.8.1.
- web: the default layout has a site header (name, main navigation as a list
  with `aria-current`) and footer; the placeholder home, catalogue and course
  pages are replaced by the public catalogue (see Added).

### Fixed

- Realm `oecp`: the declarative user profile was never imported (missing
  `userProfileEnabled`), so `oecp_org_id` was dropped and `org_id` never
  reached tokens.
- Realm `oecp`: role-less invited users got tokens without `aud`, `name` and
  `idp` because the role scope was on client scope `oecp`; it is now on client
  `oecp-admin`.
- Realm `oecp`: the `oecp-backend` service account got 403 on every Admin API
  call (realm-management roles not in its role scope).
- api image: `pnpm db:migrate` hung (pnpm 12 downloading its native binary and
  verifying the whole lockfile at run time) and failed on workspace files
  copied with mode 0600.
- web: `NUXT_PUBLIC_API_BASE` is the origin (the app appends `/api/...`);
  `NUXT_PUBLIC_I18N_BASE_URL` set for absolute hreflang links.

[Unreleased]: https://github.com/<org>/oecp/commits/main
