<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# OECP documentation

| Document | Description |
|---|---|
| [spec-v4.1.md](spec-v4.1.md) | **Specification v4.1**, v4.0 synchronised with the implementation; updated through release 0.7.0. Start here. |
| [spec-v4.0.md](spec-v4.0.md) | Specification v4.0, the implementation baseline (2026-10-14), superseded by v4.1; cited by ADR-0001 to ADR-0015. |
| [review/](review/) | Critical reviews of specification v3.0 that led to v4.0, cited as [R00]–[R03]; translated from Spanish on 2026-10-15. |
| [research/](research/) | Background research, cited as [RP]. |
| [decisions-log.md](decisions-log.md) | Owner decisions answering the open questions of the reviews, cited as [DL n]; prevails over the reviews. |
| [archive/](archive/README.md) | The owner's original Spanish documents, never updated: specification v3.0 (superseded by v4.0) and the decisions log as it stood on 2026-10-15 (row 26). |
| [adr/](adr/) | Architecture decision records (MADR). |
| [backlog.md](backlog.md) | Owner-requested items not yet scheduled, with their trigger. |
| [RELEASING.md](RELEASING.md) | Versioning, contract and migration policy, release procedure and checklist. |
| [api/](api/README.md) | OpenAPI 3.1 documents of the public catalogue API (`/api/public/v1`) and the admin API (`/api/admin/v1`), generated from the Zod contracts; how to regenerate, view and version them. |
| [data/](data/aurora-virtual-campus-2026-27/README.md) | Real course data transcribed into CSV template 1.2: the 13 courses of the Aurora Virtual Campus 2026–27 (a snapshot for the first upload, not a maintained dataset). |
| [images/](images/README.md) | Annotated screenshots of the public portal, the administration panel and the operations stack, used by the guides. |
| [screenshots/](screenshots/) | Screenshots of the development stack taken while verifying features (identity, catalogue, admin console, course wizard). Illustrative only: not kept in sync with every change. |

## Onboarding

Guides for alliances and partner universities joining an OECP deployment [DL 17]; start with the decision tree in the index.

- [onboarding/README.md](onboarding/README.md) — which guide to read, and the model on one page (organizations, roles, channels, overrides).
- [onboarding/alliance.md](onboarding/alliance.md) — Guide A: governance, deployment, identity, organizations, attributes, first alliance admin, operation.
- [onboarding/hosting-operator.md](onboarding/hosting-operator.md) — Guide E: the hosting operator's ordered path from an empty server to the pilot (day 0 requests, installation with a check at every step, go-live checklist, day-2 schedule), with the URV pilot as worked example.
- [onboarding/administrator-lifecycle.md](onboarding/administrator-lifecycle.md) — the administrator lifecycle on one page: invitation, sign-in mode, removal, dormancy, account clean-up, recertification; the defaults and the choices [DL 26].
- [onboarding/partner-with-oeapi.md](onboarding/partner-with-oeapi.md) — Guide B: a university with an OEAPI v5 endpoint (direct harvesting).
- [onboarding/partner-with-integration-capacity.md](onboarding/partner-with-integration-capacity.md) — Guide C: build an OEAPI endpoint or automate the CSV files.
- [onboarding/partner-manual.md](onboarding/partner-manual.md) — Guide D: web form and hand-made CSV files.

## Data-provider guides

Technical reference for whoever supplies course data, accurate to release 0.7.0; the onboarding guides above cover process and roles.

- [guides/README.md](guides/README.md) — overview of the three guides and the data-quality rules shared by every channel (English title, ISCED-F, ECTS, dates, language tags, delivery modes, status lifecycle).
- [guides/api-integration.md](guides/api-integration.md) — for partner IT: the OEAPI v5 requests OECP sends, authentication, network requirements, the full v5 → OECP mapping, harvester codes, withdrawal by absence, testing and the mock partner.
- [guides/csv-authoring.md](guides/csv-authoring.md) — template 1.2 column reference for `courses.csv` and `offerings.csv`, the handbook publication rule, limits, processing, browser validation, the `oecp.csv.*`/`oecp.content.*` code table and a worked example.
- [guides/web-form.md](guides/web-form.md) — the course wizard, offerings, status actions, overrides on harvested records, history and the admin API equivalents.

## Production

Templates and drafts for the alliance's legal and operations staff before go-live, written for the Aurora deployment (Aurora Foundation controller, URV processor [DL 2], partner universities independent controllers [DL 24]); every value to supply is marked `[TO COMPLETE: …]`.

- [production/README.md](production/README.md) — purpose of the set, who completes what (controller, processor, DPOs, hosting operator) and in which order.
- [production/ropa.md](production/ropa.md) — record of processing activities (GDPR art. 30), one entry per processing activity, with retention as implemented.
- [production/dpia.md](production/dpia.md) — DPIA outline (art. 35): screening, data flows, necessity, risk register mapped to the implemented controls, sign-off.
- [production/art28-processor-checklist.md](production/art28-processor-checklist.md) — controller–processor contract checklist (art. 28(3) a–h, sub-processors, breaches) and the partner access-agreement items [DL 14].
- [production/accessibility-statement.md](production/accessibility-statement.md) — accessibility statement template (Directive (EU) 2016/2102, EN 301 549, WCAG 2.1 AA).
- [production/accessibility-audit-2026-10.md](production/accessibility-audit-2026-10.md) — accessibility audit of October 2026 (axe-core on complete pages, keyboard, accessibility tree, reflow): findings, fixes and the screen-reader script still to run.
- [production/runbook.md](production/runbook.md) — production runbook: secrets and rotation, backups and restore drill, upgrades, identity operations, monitoring, incidents, housekeeping.

## Reviews

Critical reviews of specification v3.0 (2026-10-14), translated into English on 2026-10-15; the Spanish originals are in the Git history of each file.

- [00-consolidated-pending-decisions.md](review/00-consolidated-pending-decisions.md) — [R00] consolidated review and pending decisions.
- [01-identity.md](review/01-identity.md) — [R01] identity layer.
- [02-data-model-and-ingestion.md](review/02-data-model-and-ingestion.md) — [R02] data model and ingestion.
- [03-architecture-stack-licences.md](review/03-architecture-stack-licences.md) — [R03] architecture, stack and licences.

## Research

- [partner-oeapi-endpoints.md](research/partner-oeapi-endpoints.md) — [RP] what is publicly discoverable about the partners' OEAPI endpoints and how eduXchange consumes them.
- [aurora-virtual-campus-draft.md](research/aurora-virtual-campus-draft.md) — what the Aurora "Virtual Campus" listing shows today; basis of decision 18 and ADR-0012.
- [aurora-it-handbook-data-model.md](research/aurora-it-handbook-data-model.md) — the catalogue data model of the Aurora IT Handbook §3.4 compared with OECP; basis of decision 21 and ADR-0016.

## Architecture decision records

See the [ADR index](adr/README.md) for the process and template.

- [0001 — Modular monolith on NestJS](adr/0001-modular-monolith-on-nestjs.md)
- [0002 — Vue 3 + Nuxt with a server-rendered catalogue](adr/0002-vue3-nuxt-ssr-catalogue.md)
- [0003 — Traefik as edge proxy](adr/0003-traefik-edge-proxy.md)
- [0004 — Keycloak-only identity, one SAML IdP per partner](adr/0004-keycloak-only-identity-one-saml-idp-per-partner.md)
- [0005 — Pull-only OEAPI harvesting into a canonical model](adr/0005-pull-only-oeapi-harvesting-canonical-model.md)
- [0006 — Tooling: pnpm, Node 22, node-pg-migrate, Kysely](adr/0006-tooling-pnpm-node-pg-migrate-kysely.md)
- [0007 — Full-text search in PostgreSQL](adr/0007-full-text-search-in-postgresql.md)
- [0008 — Partner credentials encrypted in PostgreSQL behind `secret_ref`](adr/0008-partner-credentials-encrypted-in-postgresql.md)
- [0009 — Direct access to partner OEAPI endpoints with host approval](adr/0009-direct-partner-oeapi-access-with-host-approval.md)
- [0010 — Per-field overrides on harvested records, one authoritative channel per organization](adr/0010-overrides-on-harvested-records.md)
- [0011 — All-or-nothing CSV uploads with a shared validator and versioned templates](adr/0011-csv-uploads-all-or-nothing-shared-validator.md)
- [0012 — Alliance course attributes as validated JSONB with per-deployment definitions](adr/0012-alliance-course-attributes-as-validated-jsonb.md)
- [0013 — Admin session tokens kept in memory only](adr/0013-admin-tokens-in-memory-only.md)
- [0014 — Strict `consumer` semantics on the OEAPI read API](adr/0014-strict-consumer-semantics-on-oeapi-read-api.md)
- [0015 — Withdrawal by absence after N complete harvests, with a mass-absence guard](adr/0015-withdrawal-by-absence-with-mass-absence-guard.md)
- [0016 — Handbook publish rule with `warn` and `enforce` modes](adr/0016-handbook-publish-rule-with-warn-and-enforce.md)
- [0017 — IdP metadata refresh from a pinned-signature aggregate](adr/0017-idp-metadata-refresh-from-pinned-signature-aggregate.md)

## Project documents

- [README](../README.md) · [CONTRIBUTING](../CONTRIBUTING.md) · [GOVERNANCE](../GOVERNANCE.md) · [SECURITY](../SECURITY.md) · [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) · [CHANGELOG](../CHANGELOG.md) · [RELEASING](RELEASING.md)
- Deployment: [deploy/compose/README.md](../deploy/compose/README.md) (Docker Compose reference deployment, quick start and smoke test).
- Operations (release 0.7.0):
  - Compose README: [Backups](../deploy/compose/README.md#backups-profile-backup) (profile `backup`: pgBackRest, WAL archiving, 35-day retention, uploads archive, backup metrics), [Restore drill and restore](../deploy/compose/README.md#restore-drill-and-restore), [Alerting](../deploy/compose/README.md#alerting) (profile `observability`: alert rules including partner IdP and TLS certificate expiry, Alertmanager, Grafana dashboards *OECP overview* and *OECP logs*), [Log retention](../deploy/compose/README.md#log-retention) (container logs shipped to Loki by Grafana Alloy through a read-only Docker socket proxy: 90 days, Traefik access log 30 days) and [Branding](../deploy/compose/README.md#branding) (header images and alliance logo, [branding/README.md](../deploy/compose/branding/README.md)).
  - [production/runbook.md](production/runbook.md): backups and point-in-time recovery (section 3), restore drill (4), monitoring and alerts (7), log and data retention (10).
  - [deploy/compose/scripts/restore-drill.sh](../deploy/compose/scripts/restore-drill.sh): the quarterly restore drill into a scratch container.
  - [api/README.md](api/README.md): the OpenAPI 3.1 documents of the public and admin APIs (`pnpm openapi:generate`, `pnpm openapi:check`).

## Screenshots

- [images/README.md](images/README.md): annotated screenshots of the public portal and the administration panel (release 0.3.0, simulated data), and of the operations stack and the API description (release 0.5.0); branding, the certificate alerts and the logs dashboard came later and have none.
