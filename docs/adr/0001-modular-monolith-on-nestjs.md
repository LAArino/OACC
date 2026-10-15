<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0001: Modular monolith on NestJS

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R00] `docs/review/00-consolidated-pending-decisions.md`, [R03] `docs/review/03-architecture-stack-licences.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

Specification v3.0 described "independent containers" for each layer while
placing the anti-corruption layer inside a single "Backend Core", and left the
backend framework open between NestJS and FastAPI [R03 §0, §1]. It also
omitted components the described features need: a job queue for CSV
processing, a harvest scheduler, file storage and mail [R03 §0]. The review
noted that running Java, PHP, Node or Python and PostgreSQL at once is a high
operational load for a small team [R03 §0]. The owner develops the project
alone with AI assistance [DL 10].

How should the backend be structured, and in which language and framework?

## Decision drivers

- One team of one: minimise languages, runtimes, images and pipelines [DL 10; R03 §0].
- The same validation rules must run in the browser and on the server for CSV
  uploads and the web form (spec §6.3, §6.4) [R03 §1].
- Clear module boundaries so that contributors from several universities can
  work on separate areas [R03 §1].
- Scheduled harvesting, retries and per-partner deduplication need a job
  queue and a separate process (spec §3, §6.2).
- Only permissive or weak-copyleft licences in the deployed stack [R03 §2].

## Considered options

1. Modular monolith on NestJS (TypeScript), two processes from one image.
2. Modular monolith on FastAPI (Python).
3. Microservices: separate services for ingestion, catalogue, admin and identity.

## Decision outcome

Chosen option: **modular monolith on NestJS**, because it gives one language
end to end, shares schemas between the Nuxt front end and the backend, and
avoids the operational cost of distributed services for a single-maintainer
project [R03 §0, §1; DL 10].

The backend is one NestJS 12 (ES modules only) codebase built into one image that runs as two
processes (spec §3):

- `api` — HTTP: public catalogue API, `/oeapi/v5` read API, admin API;
- `worker` — BullMQ processors and repeatable schedules (harvests,
  metadata refresh, partition maintenance).

Modules: `catalogue`, `oeapi-read`, `admin`, `ingestion` (harvester, CSV,
form, sharing one `CanonicalWriter`), `organizations`, `identity`, `audit`,
`storage`, `mail`. The job queue is BullMQ 5 on Valkey 8 rather than pg-boss:
TypeScript-native through `@nestjs/bullmq`, repeatable jobs with time zones,
backoff, rate limiting and `jobId = harvest:{organization_id}` deduplication;
Valkey is BSD-licensed, unlike current Redis [R03 §2; spec §3].

### Consequences

- Good, because a single language, toolchain and CI pipeline serve the whole
  application, and canonical schemas in `packages/schemas` are shared by
  browser and server [R03 §1].
- Good, because the anti-corruption layer is an in-process module with one
  write path (`CanonicalWriter`), which keeps every channel idempotent
  (spec §6.1).
- Good, because NestJS's opinionated module structure gives consistency when
  several universities contribute [R03 §1].
- Good, because `api` and `worker` scale and fail independently while sharing
  code and one release artefact.
- Bad, because modules share one database and one deployable: boundaries must
  be enforced by code review and lint rules rather than by the network.
- Bad, because Valkey adds one service to operate; its state is rebuildable
  because the worker re-registers schedules at start (spec §3).
- Neutral: Python expertise in partner IT teams is not leveraged; FastAPI was
  judged equally valid for a Python team, and the key point was to decide
  [R03 §1].

### Confirmation

Module boundaries are checked in code review; cross-module imports go through
each module's public providers. The Compose deployment runs `api` and
`worker` from the same image (spec §10).

## Pros and cons of the options

### Modular monolith on NestJS

- Good, because TypeScript end to end, with the same schemas in Nuxt and NestJS [R03 §1].
- Good, because of dependency injection, guards and module structure suited to
  RBAC scoping (`partner_admin` per `org_id`, spec §4).
- Bad, because Node.js is less common than Python in some university IT teams.

### Modular monolith on FastAPI

- Good, because it is equally valid for a Python team [R03 §1].
- Bad, because it splits the code base into two languages, duplicating
  validation logic between browser and server.

### Microservices

- Good, because of independent deployment and scaling per service.
- Bad, because it contradicts the single "Backend Core" holding the ACL, and
  multiplies images, networks and failure modes for a small team [R03 §0].
- Bad, because the ingestion pipeline and the canonical writer would need
  distributed transactions or messaging for what is a single upsert.

## More information

- Specification §3 (architecture) and §6 (ingestion).
- Related: [ADR-0005](0005-pull-only-oeapi-harvesting-canonical-model.md),
  [ADR-0006](0006-tooling-pnpm-node-pg-migrate-kysely.md).
- Revisit if a module needs an independent release cadence or a different
  scaling profile that two processes cannot provide.
