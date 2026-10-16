<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Screenshots

The **public portal** screenshots were retaken on 2026-10-16 from the reference
Docker Compose stack (release 0.7.0) with the deployment branding of the
development stack (alliance logo in the header, a header image on the home
page and another on the course list, all three the deployment's own files, see
[deploy/compose/branding/README.md](../../deploy/compose/branding/README.md))
and the real course data of the Aurora Virtual Campus 2026-27 next to the
simulated Innsbruck partner. The **administration panel** screenshots date
from 2026-10-14 (release 0.3.0, simulated data; `admin-maintenance.png` from
the Maintenance page released in 0.4.0) and the three **operations and API**
screenshots from 2026-10-15 (release 0.5.0). They illustrate the
documentation; the product may change. None contains credentials.

Not retaken since: in 0.7.0 the alert rules grew to 26 (group
`oecp-certificates`), "OECP overview" gained a *Certificates* row and a second
dashboard, "OECP logs", shows the container logs shipped to Loki; the admin
panel refuses invitations to an organization whose identity provider is not
enabled and shows a warning first. None of these has a screenshot.

## Public portal

| File | Shows |
|---|---|
| `public-home.png` | Home page: alliance logo, header image, search box, number of courses with upcoming offerings, quick links by field and by university. |
| `public-catalogue-filters.png` | Course list with its own header image, filtered by an alliance attribute ("free course") and sorted by application deadline; filter chips, facet counts, hub and SDG tags on the cards. |
| `public-course-page.png` | Course page of a real BIP: key facts, alliance attributes (hub, SDGs, competence framework, flags), texts, the offering with dates, application period, "How to apply" and the apply button. |
| `public-catalogue-mobile.png` | Course list at phone width (header image, search, filters). |

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
