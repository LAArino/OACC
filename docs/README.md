<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# OECP documentation

| Document | Description | Language |
|---|---|---|
| [spec-v4.0.md](spec-v4.0.md) | **Specification v4.0**, the implementation baseline (2026-10-14). Start here. | English |
| [spec-v3.0-original.md](spec-v3.0-original.md) | Original specification v3.0, superseded by v4.0; kept for reference. | Spanish |
| [review/](review/) | Critical reviews of specification v3.0 that led to v4.0, cited as [R00]–[R03]. | Spanish |
| [research/](research/) | Background research, cited as [RP]. | English |
| [decisions-log.md](decisions-log.md) | Owner decisions answering the open questions of the reviews, cited as [DL n]; prevails over the reviews. | Spanish |
| [adr/](adr/) | Architecture decision records (MADR). | English |

## Reviews

- [00-consolidado-decisiones-pendientes.md](review/00-consolidado-decisiones-pendientes.md) — [R00] consolidated review and pending decisions.
- [01-identidad.md](review/01-identidad.md) — [R01] identity layer.
- [02-modelo-datos-ingesta.md](review/02-modelo-datos-ingesta.md) — [R02] data model and ingestion.
- [03-arquitectura-stack-licencias.md](review/03-arquitectura-stack-licencias.md) — [R03] architecture, stack and licences.

## Research

- [partner-oeapi-endpoints.md](research/partner-oeapi-endpoints.md) — [RP] what is publicly discoverable about the partners' OEAPI endpoints and how eduXchange consumes them.

## Architecture decision records

See the [ADR index](adr/README.md) for the process and template.

- [0001 — Modular monolith on NestJS](adr/0001-modular-monolith-on-nestjs.md)
- [0002 — Vue 3 + Nuxt with a server-rendered catalogue](adr/0002-vue3-nuxt-ssr-catalogue.md)
- [0003 — Traefik as edge proxy](adr/0003-traefik-edge-proxy.md)
- [0004 — Keycloak-only identity, one SAML IdP per partner](adr/0004-keycloak-only-identity-one-saml-idp-per-partner.md)
- [0005 — Pull-only OEAPI harvesting into a canonical model](adr/0005-pull-only-oeapi-harvesting-canonical-model.md)
- [0006 — Tooling: pnpm, Node 22, node-pg-migrate, Kysely](adr/0006-tooling-pnpm-node-pg-migrate-kysely.md)

## Project documents

- [README](../README.md) · [CONTRIBUTING](../CONTRIBUTING.md) · [GOVERNANCE](../GOVERNANCE.md) · [SECURITY](../SECURITY.md) · [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) · [CHANGELOG](../CHANGELOG.md)
