<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Accessibility audit (WCAG 2.1 AA), `docs/production/accessibility-audit-2026-10.md`:
  axe-core 4.14 on 39 page states of the portal and the admin panel in
  Chromium, desktop and mobile (2 serious issues before, none after),
  scripted keyboard checks, an accessibility-tree review and reflow at 320 px
  and 200 % zoom; findings with fixes, the open items, and a 10-step
  screen-reader script for the session still to run (backlog). The
  accessibility statement template lists what was checked and the known
  limitations. `SkipLink` component; `apps/web/test/a11y-css.test.ts` guards
  the stylesheet rules found in the audit.
- Data: `docs/data/aurora-virtual-campus-2026-27/`, the 13 courses of the
  Aurora Virtual Campus website (2026-10-15) transcribed into CSV template
  1.2, one `courses.csv` and `offerings.csv` per offering university, with a
  README listing what the website does not state (instructors, several
  assessments and prerequisites, functional contact addresses). Uploaded to
  the development stack as the first real test of the template: 5 uploads,
  26 records created, Handbook warnings only.
- CI: shellcheck (`koalaman/shellcheck` 0.11, `-S style`) over every shell
  script of `deploy/` and `tools/` (entrypoints, pgBackRest wrappers, restore
  drill, OEAPI mock scripts) in the job "Validate Docker Compose file"; the
  mock smoke test quotes its curl arguments. Closes the last CI row of the
  backlog.
- Docs: every README and documentation page audited against the code,
  Compose and seeds after 0.6.0 and the unreleased work (32 files): module
  and service tables, environment variables, alert tables, counts (138 error
  codes, 26 alert rules), release references, the production templates
  (RoPA, DPIA, art. 28 checklist) and the spec's status tags; stale
  "not yet" statements removed; the attribute seed comment and the Compose
  header now cite the confirmed list and spec v4.1.
- Certificate expiry alerts (spec §10). The worker exports
  `oecp_idp_certificate_expiry_timestamp_seconds{alias,enabled}` (latest
  `notAfter` among each Keycloak IdP's SAML signing certificates; read at
  start, after every IdP metadata refresh and hourly) and
  `oecp_idp_certificate_check_last_success_timestamp_seconds`. The blackbox
  exporter probes Traefik's certificate on `https://traefik:443/` (module
  `http_tls`, job `tls`; `blackbox-exporter` joins the `edge` network). New
  alert group `oecp-certificates`: `OecpIdpCertificateExpiring` (30 d
  warning, 7 d critical), `OecpIdpCertificateExpired`,
  `OecpIdpCertificateCheckStale` (24 h), `OecpTlsCertificateExpiring` (21 d
  warning, 7 d critical), `OecpTlsProbeFailing`. Grafana row *Certificates*.
  Alertmanager's critical-over-warning inhibition also matches `alias` and
  `instance`. In production the ACME certificate must be Traefik's default
  certificate for the probe to watch it (Compose README, Alerting).
- Deployment: container logs shipped to Loki (spec §10), so log retention is
  time-based. Profile `observability` gains Grafana Alloy 1.20.1
  (`observability/alloy.alloy`: every container of the Compose project,
  labelled `service`, `container`, `project`; Traefik lines `log_type` `access`
  or `app`; pino levels named) and a read-only Docker socket proxy
  (`tecnativa/docker-socket-proxy` 0.5.0: GET containers, events and networks
  only, on the internal network `docker-api`). Loki keeps the Traefik access
  log 30 days (`retention_stream`) and everything else 90 days. New Grafana
  dashboard *OECP logs* (volume by service and level, logs by service, Traefik
  access log). The json-file rotation stays as the local fallback.

### Fixed

- Accessibility defects found in the audit (`apps/web`): danger-text buttons
  (*Delete organization*, *Remove*, *Revoke*, *Delete course*, *Delete
  offering*) were dark red on the primary blue (1.05:1); error pages had no
  `<html lang>` and no skip link; admin tables, the course review step, the
  CSV file input and the course page's offerings scrolled the whole page
  sideways at 320 px (visually hidden cell texts positioned against the page,
  fact lists and the apply button not wrapping); pagination links, filter
  chips and *Clear all* were all announced as the current page (router
  `aria-current` ignores the query); *Refresh* buttons on the network,
  organizations, maintenance and invitations pages dropped the keyboard focus
  while loading (`disabled` replaced by `aria-disabled`); date fields lost
  the focus outline on their calendar button.

## [0.6.0] - 2026-10-15

Deployment branding (header images and alliance logo served from a branding directory), invitations refused when the organization's identity provider is not enabled, the sign-in mode per organization recorded as decision 22, the Aurora attribute seed aligned with the Aurora website, guides and index synchronised with the implementation, a developer guide in CONTRIBUTING.md.

### Added

- API and admin panel: invitations to an organization whose identity provider
  (`keycloak_idp_alias`) is missing or disabled in the Keycloak realm are
  refused with 409 `oecp.invitation.idp_not_enabled` (extension member
  `idp_alias`), since Keycloak would ignore the `idp` hint and the invitee could
  not sign in; when Keycloak does not answer the check is skipped and logged.
  The invitations panel warns beforehand when the organization has an alias
  that the public reference does not publish, with a link to the organization.
- Web: deployment branding. The home page and the course list show an optional header image
  (`NUXT_PUBLIC_HERO_IMAGE`, with `NUXT_PUBLIC_HERO_IMAGE_ALT`; decorative
  `alt=""` by default; the course list may have its own,
  `NUXT_PUBLIC_HERO_IMAGE_COURSES` and `_ALT`; also the `og:image` link preview) and the site header an
  optional alliance logo instead of the text brand (`NUXT_PUBLIC_LOGO_IMAGE`,
  alt text = alliance name). The images are deployment configuration, never
  repository content: the web app serves the directory `NUXT_BRANDING_DIR` at
  `/branding/<file>` (lower-case names, image extensions only, GET/HEAD, weak
  `ETag`, one-day cache, no cookies). Compose mounts
  `deploy/compose/branding/` (or `OECP_BRANDING_DIR`) read-only and passes
  `OECP_HERO_IMAGE`, `OECP_HERO_IMAGE_ALT` and `OECP_LOGO_IMAGE`; see
  `deploy/compose/branding/README.md`. The CSP is unchanged.
- Docs: decision 22 in the decisions log: the sign-in mode is chosen per
  organization by `keycloak_idp_alias` (local Keycloak accounts with password
  and TOTP for the alliance organization and for universities outside eduGAIN
  or not yet connected; the university's IdP plus TOTP otherwise), with the
  migration path from local to federated; a mixed mode within one
  organization is not supported (backlog row, revisited only on a real case).
- Docs: decisions 23 to 25 in the decisions log: administrators' e-mail
  addresses stay in the audit log for 36 months as implemented; partner
  universities and the Aurora Foundation are independent controllers (art. 28
  checklist, section B); the portal's branding images are the deployment's own
  (own generated photographs, the Aurora logo with the Foundation's permission).
- Docs: "Development environment" section in `CONTRIBUTING.md`: prerequisites,
  the `dev` Compose stack, lint, type check and tests (including the database
  suites with `DATABASE_URL_TEST`), OpenAPI generation, the identity E2E
  scripts, the Compose and alerting checks CI runs, REUSE, and where the
  development credentials live.
- Docs: three operations screenshots in `docs/images/` (Grafana dashboard
  "OECP overview", Prometheus alert rules, public API OpenAPI document in
  Redoc).

### Changed

- Seed: the Aurora attribute definitions follow the filters of the Aurora
  Virtual Campus website (confirmed by the owner on 2026-10-15): educational
  hubs keep their six values with the website's labels plus `other`;
  `target_audience` is now `students`, `academics`, `administrative_staff`,
  `other` (was `students`, `phd_candidates`, `staff`); `competence_framework`
  lists the three Aurora frameworks `louis`, `seizmic`, `bevi` and `none`; the
  17 SDGs are unchanged. The CSV guide and the Virtual Campus sample follow.
  Deployments that already loaded the old definitions re-run
  `oecp seed-attribute-definitions` and replace `phd_candidates` with
  `academics` (and `staff` with `administrative_staff`) on existing courses.
- Docs: onboarding guides, data-provider guides, documentation index and
  production README synchronised with release 0.5.0: backups (profile
  `backup`, restore drill) and alerting (profile `observability`) replace the
  interim `pg_dump` advice, release references read 0.5.0, the login model
  per organization is explained in Guide A step 3; backlog cleaned of the
  items already done (onboarding and data-provider guides, GDPR set, spec
  v4.1, ADRs 0007–0017, developer guide and release process; the CI item is
  reduced to shellcheck).
- Docs: `docs/RELEASING.md` and the Compose README no longer say that CI
  skips the database suites and the promtool/amtool checks (it runs both since
  0.5.0); the RoPA backup entry describes the 35-day pgBackRest window as
  built and notes that the secret files are not in the backups.
- Observability: the Grafana panel "5xx ratio" pins its axis to 0–100 %
  (`min` 0, `max` 1), so an all-zero series no longer autoscales to 10 000 %.
- Seed: Paris-East Créteil University (`upec`) has `keycloak_idp_alias: null`
  in `apps/api/db/seed/organizations.aurora.json` (and the default seed), so
  its administrators get local Keycloak accounts (decision 22) instead of a
  federated login that no realm IdP serves.

## [0.5.0] - 2026-10-15

Operations release: pgBackRest backups with WAL archiving, 35-day retention and a restore drill script; Prometheus metrics on the api and the worker with Alertmanager, alert rules and a Grafana dashboard in the observability profile; a strict nonce-based Content-Security-Policy on the portal; OpenAPI 3.1 documents for the public and administration APIs; README rewrite.

### Added

- API: OpenAPI 3.1 documents of the public catalogue API and the admin API,
  generated from the Zod contracts of `@oecp/schemas` with Zod 4's native
  `z.toJSONSchema` and an operation table per route
  (`apps/api/src/openapi/`). Served anonymously, built once at start-up, at
  `GET /api/public/v1/openapi.json` and `GET /api/admin/v1/openapi.json`
  (`Cache-Control: public, max-age=3600`, weak `ETag`); committed as
  `docs/api/oecp-public-api.openapi.json` (6 operations) and
  `docs/api/oecp-admin-api.openapi.json` (47 operations) with a README (how to
  regenerate, view and version them). Every error is `application/problem+json`
  with a shared `ProblemDetails` whose `errors[].code` lists the 137 stable
  codes; the admin document has the `bearerAuth` scheme with the required
  claims and the roles of each operation in `x-oecp-roles`. No HTML viewer:
  the `/api` Content-Security-Policy forbids it (backlog).
- Tooling: `pnpm openapi:generate` (writes `docs/api/*.json`) and
  `pnpm openapi:check` (validates them and fails when the committed files are
  out of date), run in the CI job "Lint, type check, test". A unit test checks
  that the documents are valid OpenAPI 3.1 (`@seriousme/openapi-schema-validator`
  2.11.0, MIT, development dependency) and cover exactly the routes the Nest
  application registers under `/api/public/v1` and `/api/admin/v1`, with the
  roles of the guards and the success status of each handler.
- API and worker: Prometheus metrics (spec §10) with `@prometheus-io/client`
  0.16.1, the successor of the deprecated `prom-client` (Apache-2.0, a
  permissive licence compatible with EUPL-1.2 as ADR 0001 and ADR 0006
  require). `GET /metrics` (text format, no authentication) on the api
  (port 3000) and on the worker's internal health server (port 3001), for the
  internal network only (Traefik routes neither); `OECP_METRICS_ENABLED`
  (default `true`) turns both off (404). Both processes export the Node.js and
  process defaults with the `oecp_` prefix and
  `oecp_build_info{version,commit}` (`OECP_GIT_COMMIT`, else `unknown`). The
  api adds `oecp_http_requests_total{method,route,status}` and
  `oecp_http_request_duration_seconds{method,route}`, labelled with the route
  template (`unmatched` for 404s; `/metrics`, `/health`, `/ready` not
  measured). The worker adds `oecp_sync_runs_total{channel,status}`,
  `oecp_sync_run_last_success_timestamp_seconds{organization_slug,channel}`,
  `oecp_sync_runs_consecutive_failures{organization_slug}`,
  `oecp_harvest_in_progress`, `oecp_maintenance_runs_total{job,status}`,
  `oecp_maintenance_run_last_success_timestamp_seconds{job}` and
  `oecp_idp_metadata_refresh_last_success_timestamp_seconds`; the gauges
  derived from `sync_runs` and `maintenance_runs` are loaded at worker start
  (a restart does not blank them), after every sync run and every 5 minutes.
- Web: strict, nonce-based Content-Security-Policy on every HTML response of
  the portal (spec §10; backlog item closed), set by a Nitro plugin
  (`apps/web/server/plugins/csp.ts`) because only the application knows the
  nonce; Traefik keeps the other headers. Each rendered page (SSR catalogue,
  client-rendered `/admin` shell, silent-callback, error pages) gets a fresh
  128-bit nonce on the script, style and link tags Nuxt and unhead generate
  (never on the rendered body) and `default-src 'self'; script-src
  'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; img-src 'self'
  data: https:; font-src 'self'; connect-src 'self' {auth}; frame-src 'self'
  {auth}; worker-src 'self'; form-action 'self' {auth}; frame-ancestors
  'self'; base-uri 'self'; object-src 'none'` (+ `upgrade-insecure-requests`
  over HTTPS in production builds), `{auth}` being the origin of
  `NUXT_PUBLIC_OIDC_AUTHORITY` (the silent-restore iframe is first pointed at
  the authorize endpoint, so `frame-src` needs it). No `'unsafe-inline'`,
  `'unsafe-eval'` or `blob:`. `NUXT_CSP_MODE` = `enforce` | `report-only` |
  `off` and optional `NUXT_CSP_REPORT_URI` (`report-uri`, `report-to`,
  `Reporting-Endpoints`). Zod runs `jitless` in the browser (client plugin;
  `zod` 4.6.7 is now a direct dependency of `@oecp/web`), because its eval
  probe was reported as a violation. Tests: policy builder and tag rewriting
  (21), and a production build rendering `/en`, the catalogue, a course page
  (JSON-LD), `/en/admin` and the silent-callback page with the nonce on every
  tag (5, `test/csp.render.test.ts`, run after the unit tests by `pnpm test`).
  Verified with Playwright on the dev stack: public pages, filters and
  suggestions, course page, sign-in, silent restore after reload, CSV console
  (worker validation, template and report downloads) and course editor save,
  without a single violation.
- Deploy: pgBackRest backups (spec §10). The `postgres` service now runs
  `oecp/postgres`, built from `postgres:16.15` plus pgBackRest 2.59.3 and jq
  (`deploy/compose/dockerfiles/postgres.Dockerfile`, non-root uid 999, same
  PostgreSQL minor and data volume), with continuous WAL archiving
  (`archive_mode=on`, `archive_command` → `pgbackrest archive-push`,
  `archive_timeout=300`; `OECP_WAL_ARCHIVE` = `auto`, `on`, `off`). New service
  `backup` (profile `backup`, `postgres/bin/oecp-backup`): one stanza for the
  whole cluster (`oecp` and `keycloak`), full backup on Sundays and
  differential on the other days at 02:00 UTC, catch-up at start, 35-day
  time-based retention, daily `uploads-YYYY-MM-DD.tar.gz` of the uploads volume
  (35 days), repository repo1 on the new volume `pgbackrest-repo`, optional
  encrypted repo2 (second site, S3/MinIO or SFTP) from `.env.pgbackrest`
  (`postgres/pgbackrest-repo2.env.example`) and Docker secrets
  `pgbackrest_repo2_*`. Backup metrics for alerting through node-exporter's
  textfile collector (`oecp_backup_last_success_timestamp_seconds{type}`,
  `oecp_backup_last_duration_seconds{type}`, `oecp_wal_archive_*`, …).
- Deploy: restore drill `deploy/compose/scripts/restore-drill.sh`: restores
  the latest backup, a point in time (`--target-time`) or one set into a
  scratch container (no network, read-only repository, no archiving), waits
  for recovery, checks both databases and prints a report with the restore
  and recovery times; quarterly (runbook §4).
- Deploy: alerting in the `observability` profile. Prometheus scrapes the api
  and worker `/metrics`, their `/ready` (new `blackbox-exporter`
  v0.29.0) and the new `node-exporter` v1.12.1 (disk of the data volumes,
  backup metrics); rules `observability/alert-rules.yml` with promtool unit
  tests (`alert-rules.test.yml`) for the alerts of spec §10 (two consecutive
  failed harvests, backup older than 26 h, disk > 80 %, IdP metadata refresh
  failure, 5xx > 1 %) plus service down or not ready, WAL archiving, maintenance
  jobs and backup health; new `alertmanager` v0.34.1 with e-mail
  (`OECP_ALERT_EMAIL_TO`, `OECP_ALERT_EMAIL_FROM`, `OECP_ALERT_SMTP_HOST`,
  `_PORT`, `_REQUIRE_TLS`, `_USER`, `_PASSWORD_FILE`, defaulting to the
  application relay) and webhook (`OECP_ALERT_WEBHOOK_URL`) receivers and
  inhibition rules; Grafana dashboard "OECP overview" and an Alertmanager data
  source, provisioned. Compose passes `OECP_METRICS_ENABLED` and
  `OECP_GIT_COMMIT` to api and worker.

### Changed

- Deploy: the `postgres` service is built locally (`docker compose build
  postgres`, or `docker compose up -d --build`); an existing data volume is
  used as is. `docker compose down -v` now also deletes the local backup
  repository (`pgbackrest-repo`). Runbook §3, §4 and §7 describe the backups,
  the restore drill and the alerts that now exist (no more interim
  `pg_dump`).

## [0.4.0] - 2026-10-15

Maintenance page in the administration panel, account clean-up job (dry run), scheduled IdP metadata refresh recorded, log retention and privacy hardening (no client addresses in application logs, invitation links never logged in production, SMTP authentication, raw payload minimisation, soft-delete purge), the consistency fixes from the guides review (severity rule, 422 for content rules, revive of soft-deleted codes, delete rule, invitation mismatch reasons, missing-field counts, tri-state attributes, status revert), and the production document set (RoPA, DPIA, art. 28 checklist, accessibility statement, runbook).

### Added

- Web: Maintenance page (`/admin/maintenance`, alliance administrators; new
  dashboard module "Maintenance"). A card per worker job (history partitions,
  retention, dormancy, account clean-up, CSV upload retention, IdP metadata
  refresh) with its description, schedule, latest run and "Run now"
  (`POST /api/admin/v1/maintenance/jobs/{name}/run`; queued or already queued
  announced in a live region). A runs table (`GET …/maintenance/runs`, filter by
  job, latest 50 or 200, refresh) with start, job, trigger, status badge,
  duration, counters as chips and an error excerpt; each row expands
  (`aria-expanded`) into the run's details as a definition list and, for the
  dormancy and account clean-up runs, a table of the listed accounts (account,
  roles or when they were removed, organization, last activity, days inactive,
  action) to review dry runs. A notice explains dry-run mode, the state read
  from the latest run's `details.dry_run` and the switches
  `OECP_DORMANCY_DRY_RUN` and `OECP_ACCOUNT_CLEANUP_DRY_RUN`.

- API: worker job `account-cleanup` (daily 05:15 UTC, maintenance queue,
  advisory lock, `maintenance_runs`, on demand
  `POST /api/admin/v1/maintenance/jobs/account-cleanup/run`): Keycloak accounts
  whose OECP roles were removed (`admin.revoke`, `admin.dormant_revoke`) more
  than `OECP_ACCOUNT_DELETE_MONTHS` (12) months ago are deleted through the
  Admin API, never accounts with a role, service accounts, accounts younger
  than the period or with later activity, sign-in, re-grant or pending
  invitation; audit `admin.account_deleted` by `system:account-cleanup`, the
  `admin_activity` row removed. Dry run by default
  (`OECP_ACCOUNT_CLEANUP_DRY_RUN=true`) with candidates and kept accounts in
  `details`. Also removes idle `admin_activity` rows of role-less subs.
- API: the `retention` job purges records soft-deleted more than
  `OECP_RETENTION_SOFT_DELETED_MONTHS` (12) months ago: offerings, courses
  (texts, ISCED codes, offerings) and organizations nothing refers to any more
  (counters `soft_deleted_*` in `maintenance_runs`).
- API: optional SMTP authentication (`SMTP_USER`, `SMTP_PASSWORD_FILE`) and
  `SMTP_STARTTLS` (require STARTTLS); Compose passes `OECP_SMTP_USER`,
  `OECP_SMTP_PASSWORD_FILE` (secret `smtp_password`) and `OECP_SMTP_STARTTLS`.
- API: `oecp.invitation.mismatch` problems carry the extension member `reason`
  (`email`, `idp`, `home_organization`, `organization`); admin course list
  items carry `missing_count`; `CONTENT_RULE_CODES`,
  `invitationMismatchReason`, `ErrorSeverityCode` and `WarningSeverityCode` in
  `@oecp/schemas`.
- API: error codes `oecp.oeapi.english_missing`, `oecp.oeapi.unknown_isced_field`,
  `oecp.oeapi.delivery_mode_dropped`, `oecp.oeapi.multiple_roots`,
  `oecp.oeapi.invalid_coordinators` and `oecp.content.session_ignored` (warnings;
  137 codes).
- Compose: log retention. Every service rotates its json-file logs
  (`OECP_LOG_MAX_SIZE` × `OECP_LOG_MAX_FILE`, Traefik
  `OECP_TRAEFIK_LOG_MAX_SIZE` × `OECP_TRAEFIK_LOG_MAX_FILE`); Loki of the
  `observability` profile keeps 90 days (`observability/loki.yaml`); README
  section "Log retention" on sizing for 90 / 30 days.

### Changed

- API: `idp-metadata-refresh` runs on the `maintenance` queue at 04:15 UTC and
  after worker start, like the other jobs: every run holds the advisory lock
  and is recorded in `maintenance_runs` (counters per IdP status, aggregate and
  per-IdP details). The 0.3.0 queue `idp-metadata-refresh` is removed at worker
  start. The maintenance queue's lock lasts 10 minutes.
- API: one severity per error code. The harvester reports with the catalogue's
  severity and uses its own warning codes where it is lenient (no English
  name: `oecp.oeapi.english_missing`, course stored as draft; unknown ISCED
  broad field; some unmapped delivery modes; several roots; malformed
  coordinators; unknown or invalid academic session:
  `oecp.content.session_ignored`); `page_cap_reached` stays a warning; a natural
  key repeated in a run is ignored with the warning `duplicate_entity` instead
  of being counted as rejected.
- API: CSV uploads revive soft-deleted course and offering codes as the form
  does (old overrides dropped, audit `course.revive` / `course_offering.revive`),
  for every channel through `CanonicalWriter`.
- API: course and offering bodies that break only content rules (English to
  publish, dates, seats, ISCED list) answer 422 instead of 400.
- API: a published course cannot be deleted (409
  `oecp.content.published_not_deletable`), as in the console.
- API: upload responses that have a run carry `Location` also on 503 (queue
  unavailable).
- API: `PUT …/integration` with a credential and `POST …/test-connection` answer
  503 `oecp.secrets.unavailable` when the master key is missing or invalid.
- API: a `title_en` over 500 characters in `courses.csv` reports
  `oecp.content.invalid_value` (was `english_missing`); the message of
  `oecp.csv.invalid_template_version` names template 1.2.
- Compose: the Traefik access log is off by default
  (`OECP_TRAEFIK_ACCESS_LOG=true` enables it; request headers dropped).
- Web: boolean course attributes are tri-state in the course editor (Not set,
  Yes, No), so `false` can be stored from the wizard; the CSV console is
  unchanged.
- Web: on harvested courses and offerings with a status override, "Revert status
  to the partner's value" shows the partner's status and sends
  `PATCH …/overrides {clear: ["status"]}` after confirmation.
- Web: the Delete course and Delete offering buttons follow the API rule: hidden
  for harvested records, organizations in overrides mode, published records and
  courses with published offerings, with the reason shown instead.
- Web: the invitation acceptance page explains the causes of
  `oecp.invitation.mismatch` from the problem's `reason` (e-mail address; not
  signed in through the organization's IdP, with "Sign in through your
  university", which signs out first and keeps the invitation; home
  organization; and, for the 409, an account that already administers another
  organization), and keeps the generic text when `reason` is absent.
- Web: the courses list shows "n missing" in the Completeness column when the
  API sends `missing_count`, else the "Incomplete" badge.

### Removed

- `oecp.csv.english_delete` (never raised: `title_en` is required).

### Security

- API: the api refuses to start with `NODE_ENV=production` and an empty
  `SMTP_HOST` unless `OECP_MAIL_LOG_LINKS=true`; without SMTP the invitation
  text and link are logged at debug level only (one warning line otherwise).
- API: request logs no longer contain headers, the client address, port or
  User-Agent; `OECP_LOG_CLIENT_ADDRESSES=true` adds a salted SHA-256 of the
  address. Admin requests log the JWT `sub`.
- API: harvested raw payloads are stored without person data
  (`coordinators`, `persons`, `ext` members about persons).

## [0.3.0] - 2026-10-14

Maintenance jobs (history partitions, retention, dormancy dry run, worker health), IdP metadata refresh from a pinned-signature aggregate, test SAML IdP in the dev profile with the brokered sign-in verified, and the IT Handbook data-model alignment (instructors, five optional texts, CSV template 1.2, publish rule warn/enforce, completeness in the admin panel).

### Added

- Web: Aurora IT Handbook alignment (decision 21). The public course page shows
  an "Instructors" fact (hidden when empty), the optional texts Methods, Mode of
  repetition, Literature and Remarks after Assessment, and the Privacy notice
  last in small muted print, all as plain text with line breaks in the selected
  text language; the JSON-LD names the instructors as schema.org `Person` on each
  `CourseInstance`. The course editor gains an "Instructors" field on Basics (one
  per line, at most 50 names of 200 characters, overridable on harvested
  courses), a collapsed "More texts" group per language on Texts, and a
  Completeness card on Review listing the obligatory fields the saved course
  lacks; the courses list shows a Completeness column. The CSV console offers
  template 1.2 (`oecp-csv-1.2.schema.json`) and mentions its new columns. All of
  it degrades gracefully when the API does not send the new members.
- API: Aurora IT Handbook alignment (decision 21, spec §5–§9). Migration
  `0007_handbook_alignment`: `courses.instructors text[]` (names or role
  descriptions as the university publishes them; ≤ 50 entries of 1–200
  characters) and five optional multilingual texts in `course_texts`
  (`mode_of_repetition`, `methods`, `literature`, `privacy_notice`, `remarks`);
  methods, literature and remarks are searchable (weight C). Canonical model,
  admin course API (`instructors`, the texts, overrides `instructors` and
  `texts.<lang>.<field>`), public course page (`instructors`, texts) and the
  OEAPI read API (`ext.oecp.instructors`, `ext.oecp.texts.*`; v5 `coordinators`
  are not emitted) carry them; the content hash includes them, so the first
  harvest or upload after the upgrade reports every course as updated once.
  The harvester maps v5 `coordinators` to instructors only when the endpoint
  returns them expanded with a name (no extra request, no person lookup), and
  reads the OECP extensions `ext.oecp.instructors` and `ext.oecp.texts`.
- CSV template 1.2 (`json/csv/oecp-csv-1.2.schema.json`; 1.0 and 1.1 stay
  accepted and their schemas frozen): optional `instructors` (`|`-separated)
  and `mode_of_repetition_<lang>`, `methods_<lang>`, `literature_<lang>`,
  `privacy_notice_<lang>`, `remarks_<lang>` in `courses.csv`; a column newer
  than the row's `template_version` fails the row. Runs record
  `schema_version` `csv-1.2`.
- Handbook publication rule (decision 21c): `completeness(course, offerings)` in
  `@oecp/schemas` (`{complete, missing}`), applied by the writer on harvests, CSV
  uploads and form saves once a course's offerings are written.
  `OECP_PUBLISH_RULE=warn` (default) publishes an incomplete course as before
  with the warning `oecp.content.handbook_incomplete` (missing fields in the
  message); `enforce` stores it as `draft` with the same warning; neither
  rejects anything. `AdminCourse.completeness`, `complete` on admin list items,
  `handbook_incomplete` (courses with the warning) on the sync run detail.
- Test SAML IdP for local development (compose profile `dev`, service
  `test-saml-idp`, SimpleSAMLphp 1.19.9) playing partner URV, and realm IdP
  `urv` pointing at it, enabled only with `OECP_DEV_IDP_ENABLED=true`
  (spec §2.1, §4). `tools/e2e-identity/brokered-accept.js` and
  `brokered-negative.js` verify the brokered partner-admin path end to end:
  invitation link with `idp=urv`, `kc_idp_hint`, first-broker-login without
  account linking, post-broker TOTP (`acr=mfa`), acceptance, re-login through
  the university chooser, administrators list with `idp: "urv"`, and the
  e-mail, IdP and schacHomeOrganization mismatches (403
  `oecp.invitation.mismatch`).
- Daily `idp-metadata-refresh` job (spec §4): downloads the federation
  aggregate (`OECP_IDP_METADATA_URL`, 50 MiB / 60 s limits), verifies its
  signature against a pinned certificate (`OECP_IDP_METADATA_SIGNING_CERT_FILE`;
  exclusive c14n, RSA-SHA256, xml-crypto) and `validUntil`, keeps the last good
  copy (`OECP_IDP_METADATA_CACHE_DIR`, usable for 7 days), and updates each
  partner IdP's signing certificates (expired ones dropped, 30-day expiry
  warning), SSO/SLO endpoints and binding flags through the Keycloak Admin API,
  writing only changed keys and one `idp.metadata_refresh` audit row per
  updated IdP. BullMQ queue and scheduler `idp-metadata-refresh` (04:15 UTC,
  plus a start-up run), and CLI `oecp idp-metadata-refresh [--dry-run]
  [--alias <a>] [--file <xml> [--no-verify]]`.
- Maintenance jobs in the worker (queue `maintenance`, spec §5.4, §10), each
  run recorded in the new `maintenance_runs` table under a PostgreSQL advisory
  lock:
  - `history-partitions` (at worker start and daily 00:10 UTC): monthly
    partitions `ext_metadata_history_YYYY_MM` for the current month and the next
    three; rows that fell into the default partition are moved into their month
    (batched, in one transaction); partitions older than
    `OECP_RETENTION_HISTORY_MONTHS` (12) are detached and dropped.
  - `retention` (daily 04:45 UTC, batched deletes): `sync_errors` 12 months,
    `sync_runs` 24 months, `audit_log` 36 months
    (`OECP_RETENTION_SYNC_ERRORS_MONTHS`, `_SYNC_RUNS_MONTHS`, `_AUDIT_MONTHS`),
    settled `admin_invitations`, `maintenance_runs` and idle `admin_activity`
    12 months.
  - `dormancy` (daily 05:00 UTC, spec §2.2): administrators without activity
    for `OECP_DORMANCY_DAYS` (180) days lose their OECP roles and
    `oecp_org_id` and are logged out (audit `admin.dormant_revoke`,
    `system:dormancy`); never the last alliance_admin, never accounts younger
    than the threshold, never inactivity before the upgrade. **Dry run by
    default** (`OECP_DORMANCY_DRY_RUN=true`): the run lists the candidates.
  - The daily `csv-retention` is now recorded in `maintenance_runs` too.
- Admin activity tracking: the admin guard upserts `admin_activity (sub,
  organization_id, last_seen_at)` at most once an hour per administrator (no
  IP address, no user agent).
- Admin API (alliance_admin): `GET /api/admin/v1/maintenance/runs?limit=&job=`
  and `POST /api/admin/v1/maintenance/jobs/{name}/run` (202 `queued` /
  `already_queued`, 404 for unknown jobs, audited
  `maintenance.run_requested`); contracts in `@oecp/schemas`
  (`admin-maintenance.ts`).
- Worker health endpoints on `WORKER_HEALTH_PORT` (3001, internal):
  `GET /health` with the registered repeatable jobs, `GET /ready` (PostgreSQL
  and Valkey); Compose healthcheck for `worker`.
- Migration `0006_maintenance`: `maintenance_runs`, `admin_activity`, indexes
  for the retention deletes and for `ext_metadata_history.sync_run_id`.

## [0.2.0] - 2026-10-14

Administration panel completed: invitations, integration settings with host approval, test connection and sync now, organizations and administrators management, network status, federated sign-in chooser, silent session restore on reload. Realm: backend service account gains `view-events`; Traefik frame options SAMEORIGIN.

### Added

- Organizations admin API (spec §2, §8; alliance_admin writes, partner_admin
  reads its organization and sub-units): `GET /api/admin/v1/organizations`
  (`include_deleted`), `GET`/`PUT`/`DELETE /organizations/{id}`,
  `POST /organizations` (201 + `Location`) and `POST /organizations/{id}/restore`.
  Same derived rules as `oecp seed-organizations` (`partner_id = id` for
  partners, inherited by sub-units and recomputed below an organization whose
  partner changes); parent checks (exists, not deleted, no cycle, depth ≤ 32);
  immutable slug; soft delete only without courses, sub-units, administrators,
  pending invitations or an enabled harvest. Every write is audited
  (`organization.create|update|delete|restore`); an IdP alias change carries a note.
- Administrators: `GET /organizations/{orgId}/admins` (Keycloak users with
  `oecp_org_id`, found with the Admin API attribute search `q=oecp_org_id:<id>`,
  re-filtered, with a scan fallback), `DELETE /organizations/{orgId}/admins/{sub}`
  (removes the OECP realm roles and `oecp_org_id`, ends the sessions, audits
  `admin.revoke`; refuses yourself and the last alliance_admin) and
  `POST …/admins/{sub}/resend-setup` (execute-actions e-mail for pending local
  setup, audits `admin.resend_setup`).
- Invitations: `POST /api/admin/v1/invitations/{id}/resend` (revokes and re-sends
  in one transaction, audits `invitation.revoke` + `invitation.resend`),
  `POST /organizations/{orgId}/invitations` (org-scoped alias of
  `POST /invitations`, alliance_admin) and `GET /organizations/{orgId}/invitations`
  with the derived `status`. Links of
  brokered organizations carry the IdP alias: `#token=<t>&idp=<alias>` (also in
  the `bootstrap-alliance-admin` output when the organization has an alias).
- `GET /api/admin/v1/network-status` (alliance_admin): integration, latest run,
  last success, course/offering counts, administrators, pending invitations and
  a documented health verdict (`ok`, `warning`, `error`, `unconfigured`) per
  organization.
- `KeycloakAdminService`: attribute search, realm role names, federated
  identities and latest LOGIN event (null without `view-events`).
- `@oecp/schemas`: `admin-organizations.ts` (`organizationInput`,
  `adminOrganization`, `organizationAdmin`, …), network status in
  `integrations.ts`, `resendInvitationRequest`; error codes
  `oecp.content.duplicate_slug`, `duplicate_identifier`, `slug_immutable`,
  `invalid_parent`, `organization_in_use`, `oecp.admin.cannot_remove_self`,
  `last_alliance_admin`, `not_local_account`, `setup_complete`.

- Admin UI completion (web, backlog "Admin UI completion (v0.2)"): the
  administration tasks of the onboarding guides no longer need curl.
  - Federated sign-in: on `/{locale}/admin` a "Sign in through your university"
    chooser lists the partner organizations of the public reference that have an
    `idp_alias` and signs in with `kc_idp_hint`; the last choice is preselected
    from `localStorage` (convenience only, alias only). The acceptance page reads
    `#token=…&idp=…`, validates the alias (`IDP_ALIAS_PATTERN` of
    `@oecp/schemas`, `local` refused), parks it in `sessionStorage` with the
    token and sends it as `kc_idp_hint`.
  - Session restore on reload: the admin layout tries once per page load to
    restore the Keycloak session in a hidden iframe (`prompt=none`,
    `silent_redirect_uri` `/en/admin/silent-callback`, 60-second limit),
    holding the page back for at most 3 seconds and re-mounting it on a later
    success; tokens stay in memory. Requires the auth host on the same site as
    the portal and portal pages frameable by themselves; the reference Traefik
    middleware now sends `X-Frame-Options: SAMEORIGIN` (see
    `apps/web/app/composables/useAuth.ts`).
  - `/admin/invitations`: create (role limited to the caller's role, validity
    1–7 days), list with status badges, revoke and resend with confirmation
    (alliance administrators); linked from the dashboard and the organization
    page.
  - `/admin/integration` replaces the read-only placeholder: the full settings
    form (channel, access mode and endpoint, write-only credential with keep /
    replace / delete and a "stored" indicator, schedule presets or cron with
    time zone, limits, enabled), inline validation with an error summary, host
    approval card, "Test connection" and "Sync now" with result cards (202,
    409, 429), last run and sync history links.
  - `/admin/organizations` (list with filters), `/admin/organizations/new` and
    `/admin/organizations/{id}` (details form, delete and restore, administrators
    with removal rules and set-up e-mails, invitations, integration and courses
    links), for alliance administrators.
  - `/admin/network`: network status with health badges, channel, harvesting,
    host approval, last run, courses, upcoming offerings, administrators and
    pending invitations; dashboard modules "Network status", "Organizations"
    and "Invitations".

### Changed

- `/api/public/v1/reference`: organizations carry `idp_alias` for "sign in
  through your university": the organization's alias only while Keycloak has an
  enabled identity provider with it (`GET /identity-provider/instances`, cached
  5 minutes, null when Keycloak does not answer and nothing is cached).
- One IdP alias pattern for API, invitation links and the public reference:
  `IDP_ALIAS_PATTERN` = `^[a-z0-9][a-z0-9._-]{1,99}$`, `local` reserved.
- Web: the organizations placeholder page moved to
  `pages/(admin)/admin/organizations/index.vue`; the integration page is no
  longer read-only.

## [0.1.0] - 2026-10-14

First pre-production release: identity (Keycloak, eduGAIN-ready, MFA, invitations), the three ingestion channels (OEAPI v5 harvester, CSV upload, web form with overrides), the public catalogue with full-text search and alliance attributes, the OEAPI v5 read API, the reference Docker Compose deployment and the developer tooling. Verified against a simulated partner; no real partner data yet.

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
- Admin dashboard modules for partner and alliance administrators (spec §8.1),
  client-only under `/{locale}/admin`:
  - Dashboard: module navigation by role for the token's `org_id`; alliance
    administrators choose the organization (public `GET /api/public/v1/reference`)
    and the choice travels as `?org=` (`useAdminOrg()`, `AdminOrgPicker`).
  - CSV console `/admin/csv`: bearer-authenticated template and JSON Schema
    downloads (Blob + object URL); keyboard-operable drop zone with a native file
    input fallback (`AdminDropZone`); kind detection from the header columns or
    file name with a per-file selector; 5 MB check; browser validation with the
    shared `@oecp/schemas` validator in a Web Worker
    (`app/workers/csv-validate.worker.ts`, main-thread fallback) against the
    public ISCED broad fields and delivery modes; report with counts, a severity
    filter and an injection-safe CSV download (`AdminIssuesTable`,
    `csvIssuesReport`); upload enabled only without browser-side errors; results
    for 201 (counters, warnings), 202 (run polled every 3 s until it ends), 422
    (server error table with the run link) and 409/413/429 problems.
  - Sync history `/admin/sync-runs` (latest 50 runs) and run page
    `/admin/sync-runs/{id}` with summary (`AdminRunSummary`, `AdminStatusBadge`)
    and server-paginated errors filtered by severity.
  - Placeholders `/admin/integration` (current settings summary when configured)
    and `/admin/organizations`.
  - `useAdminApi()`: `FormData` bodies, `query`, Blob responses and `.raw()` with
    the HTTP status; `AdminApiError` keeps the problem body (extension members)
    and `Retry-After`; messages for `oecp.sync.channel_disabled`,
    `oecp.csv.file_too_large`, `oecp.csv.rate_limited`, `oecp.csv.no_files`,
    `oecp.csv.unexpected_file`, `oecp.request.not_found` and
    `oecp.integration.not_configured`.
- Alliance attributes and Aurora Virtual Campus parity [DL 18], in `apps/api`
  and `packages/schemas`:
  - Migration `0005_alliance_attributes`: `courses.kind` (`course`, `bip`,
    `lecture_series`, `other`), `courses.levels` (every study cycle, primary
    first, backfilled from `level`, which stays the primary level), `courses.attributes`
    (jsonb object keyed by attribute key, shape-checked, GIN `jsonb_path_ops`),
    `course_offerings.application_instructions` (`{lang: text}`) and the table
    `attribute_definitions` (key, value type `enum`/`multi_enum`/`boolean`/`text`,
    labels, options, `filterable`, `show_as_tag`, `sort_order`). The down
    migration restores the 0004 schema exactly.
  - `oecp seed-attribute-definitions [--file] [--dry-run]` (upsert by key,
    definitions missing from the file are kept) with Aurora's set in
    `apps/api/db/seed/attribute-definitions.aurora.json` (educational hub, SDGs,
    competence framework, micro-credential, free course, enrolled only, open to
    the alliance, target audience), to be confirmed by the Aurora Foundation.
  - `packages/schemas`: `attributes.ts` (`attributeDefinition`,
    `buildAttributesSchema()`, `parseAttributeCell()`, `attributeValueLabels()`;
    codes `oecp.content.unknown_attribute`, `oecp.content.invalid_attribute_value`,
    `oecp.content.unknown_attribute_option`); canonical course `kind`, `levels`,
    `attributes`; offering `application_instructions`; `resolveLevels()`.
  - CSV template 1.1 (1.0 files stay valid): `courses.csv` `kind`, `levels`
    (pipe-separated; `level` still accepted, not both: `oecp.csv.conflicting_columns`),
    `attr_<key>` per definition (booleans `true/false/yes/no/1/0`);
    `offerings.csv` `application_instructions_<lang>`; JSON Schema
    `json/csv/oecp-csv-1.1.schema.json` (`attr_*` via `patternProperties`);
    the courses template download lists the deployment's `attr_*` columns;
    reference data gains `attributeDefinitions`; codes `oecp.csv.invalid_kind`.
  - `CanonicalWriter` stores the new fields (overridable per field; level kept
    equal to `levels[0]`), checks attributes against `attribute_definitions`
    before writing (`CanonicalContentRejected`); the OEAPI harvester maps
    `kind = course`, `levels = [level]`, no attributes, and
    `ext.oecp.applicationInstructions` when a partner sends it
    (`oecp.oeapi.invalid_extension` warning otherwise).
  - `/api/public/v1`: cards and course pages gain `kind`, `levels` and resolved
    `attributes` (`[{key, label, values: [{value, label}]}]`; cards only tags),
    offerings `application_instructions`, the card's `next_offering`
    `application_instructions` for `locale`; filters `kind`, `attr_<key>`,
    `level` matching any of `levels`; `sort=deadline`; facets `kind` and
    `attributes`; `/reference` `kinds` and `attribute_definitions`.
  - `/oeapi/v5`: `ext.oecp.kind`, `ext.oecp.levels`, `ext.oecp.attributes` on
    courses, `ext.oecp.applicationInstructions` on offerings.
- Public catalogue parity with the Aurora Virtual Campus [DL 18], in `apps/web`
  (works with the previous API too: absent members render as before):
  - Result cards: badge for non-course kinds ("BIP", "Lecture series",
    "Other"), every level ("Levels: Bachelor, Master"; falls back to `level`),
    tags of the attributes whose definition has `show_as_tag` (booleans show
    the definition label, enums the option labels), at most four plus "+N".
  - Filters: "Type of course" (`kind`), one checkbox group per `filterable`
    `enum`/`multi_enum` definition (`attr_<key>=<value>`, facet counts,
    description as hint) and a "Course features" group with one checkbox per
    boolean (`attr_<key>=true`); without facets the options come from
    `/reference`. All in the GET form and the URL (`utils/catalogue.ts`:
    `kind`, `attrs` in `SearchState`, `attr_*` keys sorted after the list
    filters, `restrictAttributes()` drops keys and values the alliance schema
    does not offer before calling the API); removable chips with labels.
  - Sort "Application deadline" (`sort=deadline`), with the deadline
    emphasised on each card.
  - Course page: "Type" and "Levels" facts, a "Course attributes" list with
    every attribute (booleans as Yes/No), and "How to apply" per offering with
    `application_instructions` in the selected text language (English, then
    any language, as fallback) as plain text with line breaks, above the
    apply link or contact note. JSON-LD `educationalLevel` lists every level.
  - Fixtures extended with kinds, attribute definitions, attributes, levels,
    instructions and the new facets; the fixture server filters by `kind`,
    `level` and `attr_*` and sorts by deadline; the contract test validates the
    full fixtures once `@oecp/schemas` declares the new members.

- Channel C, the web form (spec §6.4, §6.5, §8.1 "Course wizard"), in
  `apps/api` and `packages/schemas`:
  - `packages/schemas` `admin-courses.ts`: `courseInput`, `offeringInput`,
    `statusChangeRequest`, `overridesPatch` (`courseOverridesPatch`,
    `offeringOverridesPatch`, key helpers `parseCourseOverrideKey`,
    `COURSE_OVERRIDE_FIELDS`, `TEXT_OVERRIDE_FIELDS`, `OFFERING_OVERRIDE_FIELDS`),
    responses `adminCourse`, `adminOffering`, `adminCourseList(Item)`,
    `adminCourseHistory`, `adminReference`, the form language list
    `FORM_LANGUAGES` (29 EU/EEA primary subtags) and
    `csvReferenceDataFromAdminReference()` for the CSV console; new codes
    `oecp.content.invalid_code`, `unsupported_language`, `duplicate_ext_id`,
    `ext_id_immutable`, `override_not_allowed`, `has_published_offerings`,
    `published_not_deletable`, `harvested_not_deletable`.
  - `GET /api/admin/v1/organizations/{orgId}/reference` (levels, kinds, delivery
    modes, ISCED broad fields, languages, attribute definitions, academic
    sessions, teaching units, default time zone, authoritative channel and
    `form_mode` `write`/`overrides`).
  - `GET …/organizations/{orgId}/courses` (search, status/kind/channel filters,
    pagination ≤ 100), `POST …/organizations/{orgId}/courses`,
    `GET`/`PUT`/`DELETE /api/admin/v1/courses/{id}`,
    `PATCH …/courses/{id}/overrides`, `POST …/courses/{id}/status`,
    `GET …/courses/{id}/history`, `POST …/courses/{id}/offerings`,
    `GET`/`PUT`/`DELETE /api/admin/v1/offerings/{id}`,
    `PATCH …/offerings/{id}/overrides`, `POST …/offerings/{id}/status`;
    partner_admin of the organization (and sub-units) or alliance_admin.
    Organizations whose authoritative channel is `oeapi` get overrides only
    (409 `oecp.sync.channel_disabled` for record writes); the others create,
    replace and soft-delete records (409 `oecp.content.override_not_allowed` for
    overrides). Every save goes through `CanonicalWriter` in one transaction
    with a single-entity `sync_runs` row (`form`/`form`, `form-1`, triggered by
    the `sub`, counters), `ext_metadata_history` (the request body as raw
    payload) and an audit row; refused saves write nothing.
  - Unknown academic session codes of offerings create a minimal session (as
    CSV uploads do); `seats_available` sets `seats_updated_at` to the save time.
  - JSON request bodies up to 1 MB.

- Course wizard in the admin dashboard (spec §6.4, §8.1), in `apps/web`
  (client-only, bearer token, `@oecp/schemas` admin-courses contracts):
  - `/admin/courses`: courses of the organization with search, status, kind and
    source filters (native checkbox groups, state in the URL), pagination, status
    badge, override indicator and "New course" (hidden, with an explanation,
    when the organization is harvested through OEAPI); "Courses" module on the
    dashboard.
  - `/admin/courses/new` and `/admin/courses/{id}`: stepped wizard (Basics,
    Texts per language with English required, alliance Attributes, Review and
    status) with step navigation (`aria-current="step"`), focus moved to each
    step heading, client validation mirroring the contract and an error summary
    linked to the fields, server `errors[]` mapped to fields by JSON pointer;
    `POST`/`PUT`, status actions (Publish, Withdraw, Cancel, Back to draft) and
    delete confirmed in an accessible `<dialog>`, change history. Harvested
    records (`form_mode` `overrides`) show each field's source value with an
    "Override" toggle and save only toggled fields as `PATCH …/overrides`
    `set`/`clear` (unticking a saved override reverts it).
  - Offerings on the course page and `/admin/courses/{id}/offerings/new|{offeringId}`:
    session select or typed code, dates, IANA time zone (organization default
    first), teaching languages and delivery modes, seats (alliance seats ≤
    maximum), application URL and per-language application instructions; same
    overrides mode, status actions and delete.
  - Components `AdminWizardSteps`, `AdminOverrideField`, `AdminFieldError`,
    `AdminErrorSummary`, `AdminConfirm`, `AdminInputField`, `AdminCheckboxGroup`,
    `AdminLanguageTabs`, `AdminLifecycleBadge`, `AdminStatusActions`,
    `AdminCourseEditor`, `AdminOfferingForm`, `AdminCourseHistory`; composable
    `useAdminCoursesApi()`; form logic in `utils/adminCourseForm.ts`; tests with
    axe checks on every page and a contract test of the request bodies against
    `@oecp/schemas`.

### Changed

- Migration `0003_partner_base_url_http`: `partner_integrations.base_url` may
  hold an `http` URL; https on port 443 is enforced by the API and the
  harvester unless `OECP_ALLOW_INSECURE_PARTNER_HTTP=true`.
- api: arrays of the `language_tag` domain (`teaching_languages`,
  `ui_languages`) are parsed as string arrays instead of PostgreSQL literals.
- Channel B runs record `schema_version` `csv-1.1`; the template downloads are
  version 1.1 and `/api/admin/v1/csv-template/schema.json` serves the 1.1 JSON
  Schema (`oecp-csv-1.0.schema.json` stays as published). Content hashes now
  cover `kind`, `levels`, `attributes` and `application_instructions`, so the
  first harvest or upload after the upgrade reports existing records as updated.
- Overrides record the value they hide (`overrides.<field>.source`), refreshed
  by `CanonicalWriter` on every changed payload, so removing an override
  restores the last harvested value at once; a language the source drops but
  overrides keep becomes override-only (its title an override without source).
  New writer methods `applyCourseOverrides()` and `applyOfferingOverrides()`.
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

[Unreleased]: https://github.com/LAArino/AURORA-OECP/compare/v0.6.0...main
[0.6.0]: https://github.com/LAArino/AURORA-OECP/releases/tag/v0.6.0
[0.5.0]: https://github.com/LAArino/AURORA-OECP/releases/tag/v0.5.0
[0.4.0]: https://github.com/LAArino/AURORA-OECP/releases/tag/v0.4.0
[0.3.0]: https://github.com/LAArino/AURORA-OECP/releases/tag/v0.3.0
[0.2.0]: https://github.com/LAArino/AURORA-OECP/releases/tag/v0.2.0
[0.1.0]: https://github.com/LAArino/AURORA-OECP/releases/tag/v0.1.0
