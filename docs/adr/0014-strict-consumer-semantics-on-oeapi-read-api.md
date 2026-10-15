<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0014: Strict `consumer` semantics on the OEAPI read API

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [RP] `docs/research/partner-oeapi-endpoints.md`, [R03] `docs/review/03-architecture-stack-licences.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

OECP republishes the alliance catalogue as an anonymous, read-only,
OEAPI v5-compatible API under `/oeapi/v5`, so that other platforms can
harvest it (spec §9) [R03 §3]. In OEAPI v5, collection requests take a
`consumer` query parameter, and entities carry a `consumers[]` array whose
`consumerKey` names the consumer a provider has tagged data for. eduXchange
appends `consumer=eduxchange` to every call, and partners tag the courses
they offer through eduXchange with that key [RP].

OECP itself harvests the four OEAPI partners with `consumer=eduxchange`
(spec §6.2.3), and eduXchange keeps harvesting each partner directly. If
`/oeapi/v5` answered `consumer=eduxchange` with the aggregated catalogue,
eduXchange (or any client copying its requests) could ingest the same
courses twice, once from the partner and once from OECP, and OECP would be
redistributing data tagged for eduXchange back to it without an agreement.
Spec §10 already requires partner and SURF consent to reuse such data. The
spec did not say what `/oeapi/v5` should return for a consumer other than
OECP.

What should `/oeapi/v5` return for each value of `consumer`?

## Decision drivers

- Follow the meaning of `consumer` in the OEAPI standard.
- Avoid duplicate courses in eduXchange and other aggregators.
- Do not republish partner data to a third party without agreement.
- Keep the behaviour easy to change if the alliance agrees otherwise.

## Considered options

1. Strict: no `consumer` or `consumer=oecp` returns the published catalogue;
   any other value returns an empty page.
2. Ignore `consumer` and always return the catalogue.
3. Return the catalogue for `consumer=eduxchange` as well, tagged for it.
4. Reject unknown consumers with an error.

## Decision outcome

Chosen option: **strict standard semantics** [DL 19].

As built (`apps/api/src/oeapi/oeapi.service.ts`, `oeapi-v5.mapper.ts`):

- The collection endpoints `/organizations`, `/organizations/{id}/courses`,
  `/courses`, `/courses/{id}/offerings` and `/academic-sessions` return the
  published catalogue when `consumer` is absent or equals `oecp`, and a valid
  empty v5 page (HTTP 200, `items: []`) for any other value, `eduxchange`
  included. `foreignConsumer()` is the single condition.
- Single-resource requests (`/courses/{id}`, `/offerings/{id}`, …) do not
  take `consumer` and are unaffected.
- Every course and offering carries
  `consumers: [{consumerKey: "oecp", alliances: [{name: <alliance slug>}]}]`.
- eduXchange keeps harvesting each partner directly.

### Consequences

- Good, because OECP behaves as the standard describes: a consumer receives
  only data tagged for it.
- Good, because aggregators cannot pick up the alliance catalogue twice by
  reusing their usual `consumer` value.
- Good, because the change is reversible in one condition of `OeapiService`
  if the alliance, the partners and SURF agree to offer the aggregated
  catalogue to eduXchange [DL 19].
- Bad, because a client that always sends its own `consumer` value sees an
  empty catalogue and must learn to send `consumer=oecp` or omit it; the
  empty page gives no hint.
- Neutral, because the alliance slug in `alliances[].name` is OECP's own
  value; `aurora` is not yet a valid alliance in the eduXchange profile [RP].

### Confirmation

`apps/api/test/integration/oeapi-read.int.test.ts` checks `consumer=oecp`,
`consumer=eduxchange` (empty) and the `consumers` member; responses are
validated against the vendored OEAPI v5.0 OpenAPI document.

## Pros and cons of the options

### Strict semantics

- Good, because it follows the standard and avoids duplicates.
- Bad, because the empty answer can surprise clients.

### Ignore `consumer`

- Good, because every client sees data.
- Bad, because eduXchange-style clients would ingest duplicates and
  partner data would be redistributed without agreement.

### Serve `eduxchange` too

- Good, because eduXchange could use one aggregated source.
- Bad, because it needs agreements with partners and SURF that do not exist,
  and eduXchange already harvests the partners [DL 19].

### Error for unknown consumers

- Good, because clients learn at once.
- Bad, because the standard defines `consumer` as a filter, so an error
  breaks generic harvesters that always send it.

## More information

- [DL 19]; spec §6.2.3, §9, §10 "eduXchange data reuse"; [RP].
- Revisit when the alliance decides to offer the aggregated catalogue to
  eduXchange, or when OEAPI v6 (`consumer` instead of `consumers`) is added.
