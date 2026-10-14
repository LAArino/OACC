<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# OECP documentation

| Document | Description | Language |
|---|---|---|
| [spec-v4.1.md](spec-v4.1.md) | **Specification v4.1**, v4.0 synchronised with the implementation of release 0.1.0. Start here. | English |
| [spec-v4.0.md](spec-v4.0.md) | Specification v4.0, the implementation baseline (2026-10-14), superseded by v4.1; cited by ADR-0001 to ADR-0015. | English |
| [spec-v3.0-original.md](spec-v3.0-original.md) | Original specification v3.0, superseded by v4.0; kept for reference. | Spanish |
| [review/](review/) | Critical reviews of specification v3.0 that led to v4.0, cited as [R00]–[R03]. | Spanish |
| [research/](research/) | Background research, cited as [RP]. | English |
| [decisions-log.md](decisions-log.md) | Owner decisions answering the open questions of the reviews, cited as [DL n]; prevails over the reviews. | Spanish |
| [adr/](adr/) | Architecture decision records (MADR). | English |
| [backlog.md](backlog.md) | Owner-requested items not yet scheduled, with their trigger. | English |
| [RELEASING.md](RELEASING.md) | Versioning, contract and migration policy, release procedure and checklist. | English |
| [screenshots/](screenshots/) | Screenshots of the development stack taken while verifying features (identity, catalogue, admin console, course wizard). Illustrative only: not kept in sync with every change. | — |

## Reviews

- [00-consolidado-decisiones-pendientes.md](review/00-consolidado-decisiones-pendientes.md) — [R00] consolidated review and pending decisions.
- [01-identidad.md](review/01-identidad.md) — [R01] identity layer.
- [02-modelo-datos-ingesta.md](review/02-modelo-datos-ingesta.md) — [R02] data model and ingestion.
- [03-arquitectura-stack-licencias.md](review/03-arquitectura-stack-licencias.md) — [R03] architecture, stack and licences.

## Research

- [partner-oeapi-endpoints.md](research/partner-oeapi-endpoints.md) — [RP] what is publicly discoverable about the partners' OEAPI endpoints and how eduXchange consumes them.
- [aurora-virtual-campus-draft.md](research/aurora-virtual-campus-draft.md) — what the Aurora "Virtual Campus" listing shows today; basis of decision 18 and ADR-0012.

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

## Project documents

- [README](../README.md) · [CONTRIBUTING](../CONTRIBUTING.md) · [GOVERNANCE](../GOVERNANCE.md) · [SECURITY](../SECURITY.md) · [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) · [CHANGELOG](../CHANGELOG.md) · [RELEASING](RELEASING.md)
- Deployment: [deploy/compose/README.md](../deploy/compose/README.md) (Docker Compose reference deployment, quick start and smoke test).
