<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0007: Full-text search in PostgreSQL

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R00] `docs/review/00-consolidated-pending-decisions.md`, [R02] `docs/review/02-data-model-and-ingestion.md`, [R03] `docs/review/03-architecture-stack-licences.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

The public catalogue needs free-text search with typo-tolerant title
suggestions, multi-select filters with facet counts, and ranking (spec §5
"Search", §7). Course texts are multilingual: English is mandatory and every
partner may add its own languages [DL 5]. The Aurora partners write in
English, German, Dutch, Italian, French, Danish, Spanish, Catalan, Czech and
Icelandic [DL 4]. The data review left the choice open between PostgreSQL
(`tsvector` per language, `pg_trgm`, `unaccent`) and a dedicated engine such
as OpenSearch or Meilisearch, which improves relevance and facets but adds a
service and its synchronisation [R02 §2; R00 §2.2].

The catalogue is small: tens to a few thousand courses per alliance, with a
design target of p95 below 300 ms at 50 requests per second over 20,000
courses (spec §10). The project has one maintainer [DL 10] and already runs
PostgreSQL, Valkey, Keycloak and Traefik ([ADR-0001](0001-modular-monolith-on-nestjs.md)).
Every channel writes through one `CanonicalWriter` transaction (spec §6.1); a
separate index would have to follow those writes, including withdrawals and
overrides.

Which search technology should back `/api/public/v1/courses` and
`/api/public/v1/suggest`?

## Decision drivers

- Correct multilingual matching with stemming where PostgreSQL has a stemmer.
- Facet counts and results computed from exactly the same filters.
- No index lag: a published, withdrawn or overridden course is searchable
  (or not) as soon as the write commits.
- Minimum number of services to operate, back up and secure [DL 10].
- Room to move to a dedicated engine later without changing the public API.

## Considered options

1. PostgreSQL full-text search: per-language `tsvector`, `unaccent`, `pg_trgm`.
2. A dedicated engine (OpenSearch, Meilisearch or Typesense) fed from the
   canonical model.
3. PostgreSQL with one language-agnostic `simple` configuration for all texts.

## Decision outcome

Chosen option: **PostgreSQL full-text search with one configuration per
language**, because it meets the scale with no extra service and stays
transactionally consistent with the canonical model [R02 §2].

As built (migrations `0001_init` and `0004_search`,
`apps/api/src/catalogue/search-sql.ts`, `catalogue.repository.ts`):

- Text search configurations `oecp_en`, `oecp_de`, `oecp_nl`, `oecp_it`,
  `oecp_fr`, `oecp_da`, `oecp_es` and `oecp_ca` apply `unaccent` and then the
  Snowball stemmer; `oecp_simple` (unaccent, no stemming) serves Czech,
  Icelandic and every other language. `oecp_ts_config(lang)` maps the primary
  language subtag. Migration 0004 fails if Snowball `catalan` is missing.
- `course_texts.search_vector` is a stored generated column, weighted A
  title; B keywords and abstract; C description, learning outcomes,
  prerequisites and assessment; GIN-indexed.
- A query ORs one branch per configuration
  (`oecp_ts_config(t.lang) = cfg AND search_vector @@ websearch_to_tsquery(cfg, q)`)
  so the GIN index serves every branch. A single word also matches as a
  prefix (`word:*`) and, from 3 to 30 characters, by trigram word similarity
  on `oecp_search_fold(title)` = `lower(unaccent(title))`, an IMMUTABLE
  function with its own trigram index.
- Rank = `ts_rank_cd` + 0.3 × title trigram similarity; the best text of a
  course wins. Suggestions are accent- and case-insensitive title matches.
- Facets are disjunctive: each facet count omits its own filter and applies
  the others, in the same SQL builder as the result list.

### Consequences

- Good, because there is no second datastore: one backup, one access-control
  model, no synchronisation job and no index lag.
- Good, because the SQL builders are pure functions with unit tests
  (`apps/api/test/unit/catalogue-search-sql.test.ts`) plus integration tests against a
  real database (`apps/api/test/integration/catalogue.int.test.ts`).
- Bad, because relevance is basic: no BM25, synonyms, cross-language matching
  or semantic search; Czech and Icelandic get no stemming.
- Bad, because typo tolerance applies to single-word queries only.
- Bad, because changing the vector expression needs a migration that drops
  and re-adds the generated column, which rewrites `course_texts`.
- Neutral, because the §10 performance target has not been load-tested yet
  (no k6 suite exists).

### Confirmation

Unit and integration tests above; the k6 load test of spec §10 before
go-live. Migration 0004's catalan assertion runs on every install.

## Pros and cons of the options

### PostgreSQL per-language full-text search

- Good, because it is already in the stack and consistent with every write.
- Bad, because of limited ranking features and per-language configuration work.

### Dedicated engine

- Good, because of better relevance, typo tolerance and faceting out of the box.
- Bad, because it adds a service, an indexing pipeline from `CanonicalWriter`
  (outbox or change capture), eventual consistency and another backup.

### One `simple` configuration

- Good, because it is the simplest index.
- Bad, because without stemming "courses" does not match "course" and
  "Kurse" does not match "Kurs", which hurts every language.

## More information

- Spec §5 "Search", §7, §10; [R02 §2].
- Revisit when the §10 target is missed in a load test, when synonyms,
  cross-language or semantic search are required, or when an alliance needs
  stemming for languages PostgreSQL lacks. A dedicated engine would sit
  behind the same `/api/public/v1` contract (spec §12, v1 "search engine only
  if needed").
