<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Architecture decision records

An architecture decision record (ADR) captures one significant decision: the
context that forced it, the options considered, the choice made and its
consequences. OECP writes ADRs in the [MADR](https://adr.github.io/madr/)
(Markdown Architectural Decision Records) format, in English.

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-modular-monolith-on-nestjs.md) | Modular monolith on NestJS | Accepted | 2026-10-14 |
| [0002](0002-vue3-nuxt-ssr-catalogue.md) | Vue 3 + Nuxt with a server-rendered catalogue | Accepted | 2026-10-14 |
| [0003](0003-traefik-edge-proxy.md) | Traefik as edge proxy | Accepted | 2026-10-14 |
| [0004](0004-keycloak-only-identity-one-saml-idp-per-partner.md) | Keycloak-only identity, one SAML IdP per partner | Accepted | 2026-10-14 |
| [0005](0005-pull-only-oeapi-harvesting-canonical-model.md) | Pull-only OEAPI harvesting into a canonical model | Accepted | 2026-10-14 |
| [0006](0006-tooling-pnpm-node-pg-migrate-kysely.md) | Tooling: pnpm, Node 22, node-pg-migrate, Kysely | Accepted | 2026-10-14 |
| [0007](0007-full-text-search-in-postgresql.md) | Full-text search in PostgreSQL | Accepted | 2026-10-14 |
| [0008](0008-partner-credentials-encrypted-in-postgresql.md) | Partner credentials encrypted in PostgreSQL behind `secret_ref` | Accepted | 2026-10-14 |
| [0009](0009-direct-partner-oeapi-access-with-host-approval.md) | Direct access to partner OEAPI endpoints with host approval | Accepted | 2026-10-14 |
| [0010](0010-overrides-on-harvested-records.md) | Per-field overrides on harvested records, one authoritative channel per organization | Accepted | 2026-10-14 |
| [0011](0011-csv-uploads-all-or-nothing-shared-validator.md) | All-or-nothing CSV uploads with a shared validator and versioned templates | Accepted | 2026-10-14 |
| [0012](0012-alliance-course-attributes-as-validated-jsonb.md) | Alliance course attributes as validated JSONB with per-deployment definitions | Accepted | 2026-10-14 |
| [0013](0013-admin-tokens-in-memory-only.md) | Admin session tokens kept in memory only | Accepted | 2026-10-14 |
| [0014](0014-strict-consumer-semantics-on-oeapi-read-api.md) | Strict `consumer` semantics on the OEAPI read API | Accepted | 2026-10-14 |
| [0015](0015-withdrawal-by-absence-with-mass-absence-guard.md) | Withdrawal by absence after N complete harvests, with a mass-absence guard | Accepted | 2026-10-14 |

## When to write an ADR

Write an ADR for decisions that are hard to reverse or that affect several
modules, deployments or partners: architecture, major dependencies, the
canonical data model and schemas, public API contracts, identity and
security, licensing and governance. Routine implementation choices do not
need one.

## Process

1. Copy the template below into `docs/adr/NNNN-short-title.md`, with the next
   free four-digit number and a lower-case, hyphenated title.
2. Set `Status: Proposed` and open a pull request containing the ADR.
3. The ADR is discussed on the pull request and accepted by lazy consensus
   after at least 7 days without reasoned objection
   (see [GOVERNANCE.md](../../GOVERNANCE.md)). On acceptance, set
   `Status: Accepted` and the date, add it to the index above, and merge.
4. A rejected ADR may be merged with `Status: Rejected` so that the
   reasoning is kept.
5. Accepted ADRs are not rewritten. A new ADR supersedes an old one; the old
   one's status becomes `Superseded by [ADR-NNNN](NNNN-....md)` and this is
   the only edit allowed to it (besides typo fixes).

Cite sources: sections of the specification (`docs/spec-v4.0.md §n`), the
reviews (`docs/review/*.md`, cited as [R00]–[R03]), the research notes
([RP]) and rows of the decisions log ([DL n]).

## Status values

`Proposed` · `Accepted` · `Rejected` · `Deprecated` · `Superseded by ADR-NNNN`

## Template

The SPDX header must stay on the first lines, so status metadata is written
as a list under the title instead of YAML front matter.

```markdown
<!-- SPDX-FileCopyrightText: <year> <name> -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-NNNN: <short title of the problem and solution>

- Status: Proposed
- Date: YYYY-MM-DD
- Deciders: <names>
- Consulted: <names or documents>

## Context and problem statement

<Describe the context and the problem in two or three sentences, possibly
as a question. Cite sources.>

## Decision drivers

- <driver, e.g. a force or a concern>
- …

## Considered options

1. <option 1>
2. <option 2>
3. …

## Decision outcome

Chosen option: "<option>", because <justification>.

### Consequences

- Good, because …
- Bad, because …
- Neutral, because …

### Confirmation

<How compliance with the decision is checked: review, test, CI rule…>

## Pros and cons of the options

### <option 1>

- Good, because …
- Bad, because …

### <option 2>

- …

## More information

<Links, related ADRs, conditions under which the decision should be
revisited.>
```
