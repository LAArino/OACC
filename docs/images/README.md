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

## User manuals (release 0.8.0, 2026-10-16)

Taken on 2026-10-16 from the development stack (release 0.8.0) at 1200 pixels wide with Playwright, signed in as the development alliance administrator, and cropped to the relevant part of the page; used by the [partner administrator manual](../manuals/partner-admin.md) and the [alliance administrator manual](../manuals/alliance-admin.md). Data: the simulated University of Innsbruck harvest, the Aurora Virtual Campus courses of the University of Iceland and the development test accounts. Nothing was saved, uploaded, sent or run to take them; the CSV check report shows the Aurora Virtual Campus fixture files with one date deliberately reformatted, checked in the browser only. The sign-in form is empty and no one-time code is shown.

| File | Shows |
|---|---|
| `manual-admin-signin.png` | Sign-in prompt of the administration panel, signed out: *Sign in* and the *Sign in through your university* box. |
| `manual-login-form.png` | Login page of the login service (Keycloak) with empty e-mail and password fields. |
| `manual-dashboard.png` | Dashboard of an alliance administrator: *Your account*, the organization list (University of Iceland), the organization modules and the *Alliance administration* tiles. |
| `manual-courses-list.png` | Courses list of the University of Iceland: filters and the table with the *Completeness* column. |
| `manual-course-wizard-step1.png` | Course wizard of a new course, step 1 *Basics*, with example values typed in (not saved). |
| `manual-course-wizard-attributes.png` | Course wizard, step 3 *Attributes* of a real BIP: educational hub, SDGs, competence framework, yes/no flags, target audience. |
| `manual-course-image-card.png` | Course wizard, step 4: the *Completeness* card (one field missing) and the *Image* card with the current image and its buttons. |
| `manual-course-status.png` | *Summary and status* box of a published course with *Withdraw*, *Cancel*, *Back to draft* and why it cannot be deleted; the step buttons. |
| `manual-offering-form.png` | Offering page: status actions, offering code, academic session, dates, time zone, the start of the teaching languages. |
| `manual-csv-console.png` | CSV upload page: limits, what templates 1.2 and 1.3 add, template and JSON Schema 1.3 downloads, drop area. |
| `manual-csv-check-report.png` | CSV upload page after choosing two files: detected types and the browser check report with one `oecp.csv.invalid_date` error; *Upload* disabled. |
| `manual-sync-history.png` | Sync history of the University of Innsbruck: harvest and form runs with trigger, status and counters. |
| `manual-sync-run.png` | One harvest run (*Partly succeeded*): summary, counters and the errors and warnings with codes and JSON Pointers. |
| `manual-integration.png` | Integration settings of the University of Innsbruck: current settings, host approval (*Approved*), authoritative channel. |
| `manual-integration-test-run.png` | Lower part of the Integration settings page: stored credential (never shown), schedule, limits, *Harvest on the schedule*, *Save settings*, *Test connection*, *Sync now*. |
| `manual-organizations-list.png` | Organizations list with filters and the identity provider alias column. |
| `manual-organizations-detail.png` | Organization page of Rovira i Virgili University: section links and the start of the details form. |
| `manual-organization-identifiers.png` | *Identifiers and login* of an organization: SCHAC home organization and identity provider alias. |
| `manual-organization-administrators.png` | *Administrators* panel: a development test administrator signing in through the university login, last sign-in, *Remove*. |
| `manual-invitations-warning.png` | Invitations of Copenhagen Business School: the warning that its identity provider is not enabled in the login service, the form and a revoked test invitation. |
| `manual-network.png` | Network status: health counters and the table, problems first (the right-hand columns are cut at 1200 pixels). |
| `manual-maintenance.png` | Maintenance page: the dry-run notice and the six job cards with *Run now*. |
| `manual-maintenance-dormancy-run.png` | Maintenance runs filtered on *Dormancy*, details of the latest dry run open (nobody listed). |
