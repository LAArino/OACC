<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Screenshots

The public portal and administration panel screenshots were taken on 2026-10-14
from the reference Docker Compose stack (release 0.3.0) with simulated data: a
mock OEAPI partner (Universität Innsbruck slice) and the Aurora Virtual Campus
CSV fixture; `admin-maintenance.png` shows the Maintenance page, built after
0.3.0 and released in 0.4.0. The three operations and API screenshots were
added on 2026-10-15 from release 0.5.0 (development stack, `observability`
profile). They illustrate the documentation; the product may change. None
contains credentials.

They are not retaken for every change, so some show an earlier state: since
0.6.0 the home page and the course list show the deployment's header image and
the site header its alliance logo when branding is configured
([deploy/compose/branding/README.md](../../deploy/compose/branding/README.md)),
which `public-home.png` and `public-catalogue-filters.png` predate; after 0.6.0
the alert rules grew to 26 (group `oecp-certificates`), "OECP overview" gained
a *Certificates* row and a second dashboard, "OECP logs", shows the container
logs shipped to Loki; none of these has a screenshot.

## Public portal

| File | Shows |
|---|---|
| `public-home.png` | Home page with the search box and quick links. |
| `public-catalogue-filters.png` | Catalogue filtered by an alliance attribute ("free course"), sorted by application deadline, with hub and SDG tags on the cards. |
| `public-course-page.png` | Course page: key facts incl. instructors, texts per language (methods, remarks), offerings with "How to apply". |
| `public-catalogue-mobile.png` | Catalogue at phone width. |

## Administration panel

| File | Shows |
|---|---|
| `admin-invitation-accept.png` | Invitation acceptance page before sign-in (token removed from the URL). |
| `admin-invitation-accepted.png` | Acceptance result: role and organization granted, re-login hint. |
| `admin-dashboard.png` | Dashboard after a page reload (session restored silently), modules by role. |
| `admin-invitations.png` | Invitations: create, list with status, revoke and resend. |
| `admin-integration-settings.png` | Integration settings of a partner with an OEAPI endpoint, host approval, test connection, sync now. |
| `admin-organizations.png` | Organizations list. |
| `admin-organization-detail.png` | Organization detail with administrators (incl. last login) and invitations. |
| `admin-network-status.png` | Network status: health per organization and last run. |
| `admin-maintenance.png` | Maintenance page: job cards with Run now, runs table with a dormancy dry-run review. |
| `admin-csv-console-validated.png` | CSV console after the browser-side validation (template 1.2). |
| `admin-csv-console-uploaded.png` | CSV console after an upload processed inline. |
| `admin-courses-list.png` | Courses list with the completeness column (IT Handbook rule). |
| `admin-course-editor-completeness.png` | Course editor, review step, completeness card listing missing obligatory fields. |
| `admin-course-editor-overrides.png` | Course editor in overrides mode on a harvested course: source values and per-field "Override". |

## Operations and API

| File | Shows |
|---|---|
| `ops-grafana-overview.png` | Grafana dashboard "OECP overview" of the `observability` profile (kiosk mode, light theme, last 3 hours), rows: Status (api and worker up and ready, database and uploads backup age, last WAL archived, firing alerts), HTTP (api), Harvests (worker), Maintenance jobs (worker), Backups and disk. The "IdP metadata: last refresh" panel shows "No data" because the development stack has no eduGAIN aggregate configured. |
| `ops-prometheus-rules.png` | Prometheus "Rule health" page with the OECP alert rules (19 rules, every one OK and inactive on the development stack); the groups `oecp-availability`, `oecp-backup` and `oecp-harvest` are visible, the others below the fold. |
| `api-openapi-redoc.png` | The public catalogue API OpenAPI document (release 0.5.0) rendered with Redoc, a static page built with `npx @redocly/cli build-docs docs/api/oecp-public-api.openapi.json` ([docs/api/README.md](../api/README.md#how-to-view)). |
