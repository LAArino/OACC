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
the Maintenance page released in 0.4.0) and the **operations and API** screenshots
from 2026-10-15 (release 0.5.0, now only `api-openapi-redoc.png`; the others
were retaken on 2026-10-18, release 0.9.0). They illustrate the
documentation; the product may change. None contains credentials.

Not retaken since 0.5.0: `api-openapi-redoc.png`. The 26 alert rules (group
`oecp-certificates` included) and the *Certificates* row of "OECP overview"
are now captured in `ops-prometheus-rules.png` and `ops-grafana-overview.png`.
The second dashboard, "OECP logs" (the container logs shipped to Loki), and the
admin panel's warning for an organization whose identity provider is not
enabled have their own screenshots below (`ops-grafana-logs.png`,
`manual-invitations-warning.png`).

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
| `ops-grafana-overview.png` | Retaken on 2026-10-18 (release 0.9.0), 1400 x 1750 pixels. Grafana dashboard "OECP overview" of the `observability` profile (kiosk mode, light theme, last 3 hours), rows: Status (api and worker up, /ready up, database and uploads backup age, last WAL archived, firing alerts), HTTP (api), Harvests (worker) with the Innsbruck partner at 0 consecutive failures, Maintenance jobs (worker), Backups and disk, and the Certificates row (days to IdP and TLS certificate expiry) at the bottom. The backup panels show "No data" because the backup profile is not running on the development stack. |
| `ops-grafana-logs.png` | Grafana dashboard "OECP logs" of the `observability` profile (kiosk mode, light theme, last 3 hours), taken on 2026-10-18 from the development stack (release 0.9.0): the *Service* and *Line contains (regex)* filters, the Volume row (log lines by service and by level, errors and warnings by service and level), the Logs panel with the api JSON lines and Grafana's own lines, and the Traefik access log panel, which shows "No data" on the development stack. |
| `ops-prometheus-rules.png` | Retaken on 2026-10-18 (release 0.9.0), 1400 x 1000 pixels. Prometheus "Status > Rule health" page with the groups `oecp-availability` (3 rules), `oecp-backup` (6) and the start of `oecp-certificates`, every rule OK; the stack has 26 rules in 7 groups (availability, backup, certificates, harvest, host, http, maintenance), the rest below the fold. |
| `ops-alertmanager.png` | Alertmanager "Alerts" page (release 0.9.0, 2026-10-18, 1400 x 800 pixels) with the filter and group controls and one group for the receiver `oecp-operators` holding the delivery test `OecpTestAlert` (component=monitoring, severity=warning) with its Silence and Link actions. |
| `ops-keycloak-idp-certificate.png` | Keycloak admin console, realm `oecp`, Identity providers > `urv` (the development test IdP) > settings, scrolled to the SAML settings (release 0.9.0, 2026-10-18, 1400 x 620 pixels): Validate Signatures on, Metadata descriptor URL, "Validating X509 certificates" with the certificate value, Sign service provider metadata on, Allowed clock skew. |
| `api-openapi-redoc.png` | The public catalogue API OpenAPI document (release 0.5.0) rendered with Redoc, a static page built with `npx @redocly/cli build-docs docs/api/oecp-public-api.openapi.json` ([docs/api/README.md](../api/README.md#how-to-view)). |

Three more, taken on 2026-10-18 from the development stack (release 0.9.0, profiles `dev` and `observability`, Mailpit as the SMTP relay for Keycloak and Alertmanager) at 1400 pixels wide with Playwright, for the [hosting operator guide](../onboarding/hosting-operator.md) (Guide E, steps 2.7, 2.10 and 2.12). The e-mails show only example addresses; the account update link is shown as link text, its token is not on screen.

| File | Shows |
|---|---|
| `ops-setup-email.png` | Mailpit with the Keycloak "Update Your Account" e-mail of the first alliance admin open: sender, recipient, the Update Password and Configure OTP actions, the account update link and the two-day expiry. |
| `ops-alert-email.png` | Mailpit with the Alertmanager delivery test open: subject "[OECP local] FIRING:1 OecpTestAlert (warning)", the firing alert with its three labels and the *View In Alertmanager* button. |
| `ops-keycloak-admin-console.png` | Keycloak admin console, `master` realm, Users list with the single `admin` service account (warning icon, no e-mail) and the "temporary admin user" banner. |

## Repository README (release 0.9.0, 2026-10-18)

Taken on 2026-10-18 from the development stack (release 0.9.0) at 1200 pixels wide with Playwright, viewport only, with no branding images and a neutral alliance name (`OECP_ALLIANCE_NAME=European University Alliance`), so that the product looks generic; the data is the Aurora Virtual Campus 2026-27 CSV snapshot of `docs/data/` next to the simulated Innsbruck partner. Used by the repository [README](../../README.md) and listed as `screenshots` in `publiccode.yml`.

| File | Shows |
|---|---|
| `readme-catalogue.png` | Course list filtered by the educational hub "Social Entrepreneurship & Innovation": filter sidebar with facet counts, the active filter chip, and course cards (a BIP and a course from different universities) with key facts and alliance tags. |
| `readme-home.png` | Home page: text brand, search box, "Browse 30 courses with upcoming offerings", quick links by field of study and by university with course counts. |

## Data-provider guides (release 0.9.0, 2026-10-18)

Taken on 2026-10-18 from the development stack (release 0.9.0) at 1400 pixels wide, for the [web form guide](../guides/web-form.md). The data is the simulated University of Innsbruck partner harvested from the OEAPI mock (`tools/oeapi-mock`); a status override was set on one harvested course and reverted for the capture, so nothing was left changed.

| File | Shows |
|---|---|
| `guide-status-override.png` | Course page of a harvested course (University of Innsbruck, code 609010) in overrides mode, 1400 x 499 pixels: the "Summary and status" card with code, type, source "OEAPI harvest", last updated, last seen in a harvest and Status "Withdrawn" with the Publish and Back to draft buttons, then the "Status override" box ("The status Withdrawn is set here as an override. The partner's value is Published.") with the button "Revert status to the partner's value" and the note that harvested records cannot be deleted here. |
| `guide-course-history.png` | The "History" card at the end of the same course page, 1400 x 424 pixels: "Latest 4 changes, newest first", columns When, By (account id), Type, Action and Summary, with an Ingestion `ingest.accepted` entry, an Admin change `course.status` "Status published → withdrawn", and two Ingestion entries for the accepted OEAPI payloads of the course and its offering. |

## Onboarding guides (release 0.9.0, 2026-10-18)

Ten new screenshots, taken on 2026-10-18 from the development stack (release 0.9.0) at 1400 pixels wide with Playwright, for the [onboarding guides](../onboarding/README.md) (A to D, Guide E steps 2.13 and 3, and the [sign-in paths](../onboarding/identity-paths.md) page): the nine `onboarding-*` files below and `ops-grafana-logs.png`, which is listed in the operations table above. They use development test accounts and example addresses. The QR code and the invitation link are masked and no token is on screen. The University of Innsbruck is the simulated partner of the development stack, reached over plain http against the OEAPI mock (`tools/oeapi-mock`).

| File | Shows |
|---|---|
| `onboarding-test-idp-login.png` | SimpleSAMLphp "Enter your username and password" form of the development test identity provider (Rovira i Virgili University), empty, reached from the university chooser on the portal sign-in prompt. |
| `onboarding-keycloak-set-password.png` | Keycloak *Update password* page with the empty *New Password* and *Confirm password* fields, the *Sign out from other devices* box and *Submit*. The token of the link is not on screen. |
| `onboarding-keycloak-totp.png` | Keycloak *Mobile Authenticator Setup*: the warning that the account needs it, the list of apps, the barcode step with the QR code masked as a black square, *Unable to scan?*, the empty *One-time code* and *Device Name* fields and *Submit*. On release 0.9.0 Keycloak asks for the authenticator first and the password second. |
| `onboarding-invitation-email.png` | Mailpit, *Text* tab (the invitation is plain text), with the invitation e-mail open: subject "Invitation: Aurora European Universities Alliance administrator, Open European Campus Portal" to `deputy@alliance.example`, the invitation sentence, the link line masked with a black bar, the expiry and the note about the separate set-up e-mail for organizations without institutional login. |
| `onboarding-administrators-resend.png` | *Administrators* panel of the alliance organization, "1 administrator": `platform@alliance.example` (you), signs in with OACC account, *Set-up pending: set a password*, and the *Resend set-up e-mail* button with the note "You cannot remove yourself". The button appears only while a local account has a pending set-up. |
| `onboarding-host-waiting-approval.png` | *Integration settings* of the University of Innsbruck: current settings (OEAPI harvest, Direct, harvesting No, last run None) and the *Host approval* card with host `oeapi-mock:8090`, *Waiting for approval* and the button *Approve host oeapi-mock:8090*. |
| `onboarding-integration-test-ok.png` | The same page after the approval, full page: *Approved* with the approval time, the *Settings* form (base URL `http://oeapi-mock:8090`, consumer `eduxchange`, a stored Basic credential, daily schedule, limits, *Harvest on the schedule* unchecked), *Test and run* with *Test connection* and *Sync now*, and the result "The connection works" (target, 17 ms, service contact, specification and documentation links, courses available, first course code `201420`). |
| `onboarding-course-wizard-texts.png` | Course wizard of Rovira i Virgili University, "Step 2 of 4: Texts": *Add a language* and the English (required) tab with the example title "Introduction to Sustainable Urban Planning", abstract and description typed in (not saved). |
| `onboarding-course-wizard-review.png` | Course wizard, "Step 4 of 4: Review and status" of course `URB-301` (Course, Bachelor, 5 ECTS, ISCED-F 0731): the *Image* card ("Save the course first"), the summary, the status choice (*Draft* selected, *Published*) and the *Back* and *Create course* buttons, not pressed. |

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
