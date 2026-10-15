<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0006: Tooling — pnpm, Node 22, node-pg-migrate, Kysely

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R03] `docs/review/03-architecture-stack-licences.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

OECP is a TypeScript monorepo (`apps/api`, `apps/web`, `packages/schemas`;
spec §11) built by a single maintainer [DL 10] on NestJS and Nuxt
([ADR-0001](0001-modular-monolith-on-nestjs.md),
[ADR-0002](0002-vue3-nuxt-ssr-catalogue.md)). The specification defines the
database in PostgreSQL DDL that relies on features beyond what ORMs model
well: domains, enums, deferred constraint triggers, generated `tsvector`
columns with custom text-search configurations, partial and trigram indexes,
and range-partitioned history (spec §5). Validation of CSV uploads and form
input must run identically in browser and server from one JSON Schema
(spec §6.3, §6.4) [R03 §1].

Which package manager, runtime, database migration and query tools, and
quality tooling should the repository use?

## Decision drivers

- One language and toolchain end to end [R03 §1; DL 10].
- The spec DDL must remain the source of truth for the database, readable by
  DBAs and reviewers as plain SQL.
- Type safety from the database to the API without hiding SQL.
- Reproducible installs and strict dependency boundaries in a monorepo.
- Fast feedback in CI and locally; tooling shared between NestJS and Nuxt.
- Permissive licences for all build and runtime dependencies [R03 §2].

## Considered options

- **Package manager:** pnpm workspaces · npm workspaces · Yarn.
- **Runtime:** Node.js 22 LTS · Node.js 24 LTS.
- **Migrations:** node-pg-migrate with plain SQL files · Flyway · Prisma Migrate · Kysely's migrator (TypeScript migrations).
- **Data access:** Kysely · Prisma · TypeORM · Drizzle · raw `pg`.
- **Validation:** Zod alongside the normative JSON Schemas · JSON Schema only.
- **Tests:** Vitest · Jest.
- **Lint and format:** ESLint + Prettier · Biome.

## Decision outcome

Chosen options:

1. **pnpm workspaces** for the monorepo: strict, non-flat `node_modules`
   that reject undeclared dependencies, a content-addressed store, the
   `workspace:` protocol and one lockfile.
2. **Node.js 22 LTS** as runtime and build platform for `api`, `worker` and
   `web`, pinned through `engines` and the container base image.
3. **TypeScript in strict mode** (`"strict": true`) in every package; no
   implicit `any`.
4. **Plain SQL migrations with node-pg-migrate.** Migrations are forward-only
   `.sql` files run by node-pg-migrate. **Migration 0001 is the DDL of
   spec §5 verbatim**, so the specification and the database cannot drift at
   the start. Later schema changes are new migrations, accompanied by updates
   to the specification (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).
5. **Kysely** as type-safe SQL query builder, with database types generated
   from the migrated schema. No ORM: repositories write explicit queries,
   which suits scoped repositories for `org_id` authorisation (spec §4) and
   PostgreSQL-specific search queries (spec §5).
6. **Zod** for runtime validation of environment configuration, query
   parameters and internal DTOs. The canonical and CSV **JSON Schemas in
   `packages/schemas` stay normative** for published contracts (validated
   with Ajv in browser and server, spec §6.3); any Zod schema covering the
   same data must be derived from, or tested against, those JSON Schemas.
7. **Vitest** for unit and integration tests in all packages; Playwright for
   end-to-end tests (spec §10).
8. **ESLint** (flat config, typescript-eslint) for linting and **Prettier**
   for formatting, enforced in CI.

### Consequences

- Good, because the database schema is reviewable SQL identical to the
  specification, and every PostgreSQL feature the spec uses is available
  without workarounds.
- Good, because Kysely gives compile-time checking of table and column names
  while keeping queries explicit and close to SQL.
- Good, because pnpm's strictness catches undeclared dependencies between
  workspace packages early.
- Good, because Vitest is fast and shares configuration style with the Vite
  tooling under Nuxt.
- Bad, because generated database types must be regenerated after each
  migration; CI should check that they are up to date.
- Bad, because NestJS relies on decorator metadata, which Vitest's default
  esbuild transform does not emit; the `api` package needs an SWC-based
  transform for tests.
- Bad, because two validation libraries (Ajv/JSON Schema and Zod) coexist;
  the rule above keeps JSON Schema authoritative for shared contracts.
- Neutral: Node.js 22 reaches end of life in April 2027. An upgrade to the
  next LTS line (Node.js 24) must be planned before then and recorded in a
  superseding ADR or a changelog entry.

### Confirmation

CI runs `pnpm install --frozen-lockfile`, type checking in strict mode,
ESLint, Prettier check, Vitest, and applies all migrations to an empty
PostgreSQL 16 database before the tests.

## Pros and cons of the options

### Migrations: node-pg-migrate with SQL files

- Good, because migrations are plain SQL and the spec DDL can be used as is.
- Good, because it runs on Node.js, so no JVM or extra binary in the toolchain.
- Bad, because there is no automatic diffing; changes are written by hand.

### Migrations: Flyway

- Good, because it is mature and SQL-first.
- Bad, because it adds a Java runtime to a TypeScript-only toolchain [R03 §0].

### Migrations: Prisma Migrate / Kysely migrator

- Good, because they integrate with their query layers.
- Bad, because Prisma's schema language cannot express several features of
  the spec DDL, and Kysely's migrator uses TypeScript instead of plain SQL.

### Data access: Kysely

- Good, because it is type-safe, explicit and supports raw SQL fragments for
  full-text search and JSONB.
- Bad, because there are no entity relations or lazy loading; joins are
  written explicitly.

### Data access: Prisma / TypeORM / Drizzle

- Good, because they offer schema-driven models; TypeORM is NestJS's
  traditional default.
- Bad, because each defines the schema in its own language or decorators,
  duplicating or conflicting with the hand-written DDL, and partitioning,
  domains and constraint triggers are poorly supported.

### Tests: Jest

- Good, because it is NestJS's default.
- Bad, because it is slower and its ESM support is weaker than Vitest's.

### Lint and format: Biome

- Good, because one fast tool replaces two.
- Bad, because the ESLint plugin ecosystem (typescript-eslint, Vue/Nuxt
  rules, accessibility rules) is broader.

## More information

- Specification §5 (DDL), §6.3 (CSV validation), §10 (testing), §11 (layout).
- Revisit when upgrading the Node.js LTS line or if Kysely type generation
  proves unreliable for the partitioned or generated columns.
