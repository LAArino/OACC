<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0005: Pull-only OEAPI harvesting into a canonical model

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R00] `docs/review/00-consolidated-pending-decisions.md`, [R02] `docs/review/02-data-model-and-ingestion.md`, [RP] `docs/research/partner-oeapi-endpoints.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

Specification v3.0 defined Channel A as a push route
(`/api/v1/ingest/ooapi/v5`) without saying who would send payloads or under
which contract, and its data model lacked organizations, natural keys,
lifecycle states and the tables the admin UI relies on [R02 §2, §3]. The data
review established that:

- OEAPI (formerly OOAPI) is served by each institution as paginated GETs,
  with no webhooks, callbacks or delta parameter; v5.0 is stable, v6.0 is a
  release candidate that breaks compatibility, v4 is legacy [R02 §1];
- withdrawals can only be detected by absence from a complete harvest, and
  the v5 `since` parameter returns only future offerings by default [R02 §1, §3];
- delivery modes, language codes and text structures differ between OEAPI
  versions and from v3.0's own enums [R02 §1].

Four Aurora partners (UIBK, UICE, VUA, UDE) expose OEAPI — the same endpoints
eduXchange harvests — while six (URV, UNINA, UP, CBS, UPEC and the Aurora
Foundation) have none and several lack technical capacity [DL 4, DL 13]. No
partner publishes a public OEAPI URL; eduXchange reaches them through the
SURFeduhub gateway [RP]. The owner decided pull only, daily by default with a
"sync now" button, withdrawals by absence from complete harvests, and no push
in the MVP [DL 3], with direct access to each partner to minimise dependency
on SURF [DL 14].

How should partner data enter OECP, and in what form is it stored?

## Decision drivers

- Match how OEAPI actually works (pull, paginated, no deltas) [R02 §1].
- Accept heterogeneous sources (OEAPI v5 now, v6 later, CSV, form) without
  leaking their shapes into the catalogue [R02 §1].
- Idempotent ingestion: re-harvesting must never duplicate records [R02 §2].
- Never withdraw courses because a harvest failed or came back empty [R02 §3].
- Manual corrections over harvested data must survive the next harvest [DL 12].
- Minimal dependency on third-party gateways [DL 14].

## Considered options

1. Pull-only scheduled harvester feeding a canonical model through an
   anti-corruption layer, plus CSV and form channels.
2. Push ingestion: partners or middleware send OEAPI-shaped payloads to OECP.
3. Pull plus a "harvest now" notification endpoint in the MVP.
4. Store source payloads as-is and render the catalogue from them.

## Decision outcome

Chosen option: **pull-only harvesting into a canonical model**, because OEAPI
is a pull API, a push contract would have to be invented and authenticated,
and a canonical model is the only way to serve one catalogue from OEAPI, CSV
and form sources [R02 §1, §3; DL 3].

Rules (spec §5, §6):

- **Channels:** A — scheduled OEAPI v5 harvester (daily `0 3 * * *`, "Sync
  now" at most every 15 minutes, one run per partner at a time); B — CSV
  upload; C — web form. All go through adapter → source validation →
  canonical DTO → canonical JSON Schema → SHA-256 of the RFC 8785
  serialisation → `CanonicalWriter.upsert()`.
- **Access:** `direct` to each partner's endpoint under a bilateral
  agreement (default); `surfeduhub` only as fallback [DL 14].
- **Canonical model:** organizations → courses → offerings → academic
  sessions, UUID keys, natural keys `(organization_id, ext_id)` and
  `(course_id, ext_offering_id)`, lifecycle `draft`/`published`/`withdrawn`/
  `cancelled`, soft deletion, multilingual texts in `course_texts` with
  English mandatory to publish [DL 5, DL 6], OEAPI v6 delivery-mode
  vocabulary [DL 7].
- **Idempotency:** a content hash equal to the stored one counts as
  unchanged and writes nothing.
- **Withdrawal by absence:** only in complete runs, with a mass-absence guard
  (under 30% missing); an entity is withdrawn after `withdraw_after_absences`
  (default 3) consecutive absences; failed, empty or incomplete harvests
  never withdraw [DL 3; R02 §3].
- **One authoritative channel per organization;** manual edits over harvested
  data are stored as explicit overrides that survive harvests [DL 12].
- **Out of the MVP:** push ingestion (not planned) and the "harvest now"
  notification (v1); OEAPI v6 input (v1); OEAPI v4 (v2, on demand) (spec §1, §12).

### Consequences

- Good, because the harvester follows the real OEAPI interaction model, and
  partners need to do nothing beyond granting access.
- Good, because every channel is idempotent and auditable, with raw payloads
  kept in a partitioned history for 12 months (spec §5).
- Good, because partners without OEAPI publish through CSV or the form into
  the same model.
- Bad, because data freshness is bounded by the schedule (daily by default),
  mitigated by "Sync now".
- Bad, because absence detection delays withdrawals by several runs; partners
  can withdraw immediately by changing the status.
- Bad, because OECP must hold per-partner credentials and approve outbound
  hosts, requiring encrypted secrets and SSRF controls (spec §6.2.6, §10).
- Neutral, because initial harvests may be sparse while the Aurora catalogue
  on eduXchange is not yet live; the absence rules prevent spurious
  withdrawals [RP; spec §10].

### Confirmation

Unit tests for every transformer (at least 90% line coverage in
`ingestion`), contract tests of harvester fixtures against the OEAPI v5
OpenAPI, and CSV schema corpora (spec §10).

## Pros and cons of the options

### Pull-only harvesting into a canonical model

- Good, because it matches OEAPI and decouples the catalogue from source formats [R02 §1].
- Bad, because of polling latency and per-partner credentials.

### Push ingestion

- Good, because of lower latency.
- Bad, because it needs a new OEAPI-shaped contract (batch or entity,
  verbs, authentication, `Idempotency-Key`) that no partner implements
  [R02 §3].

### Pull plus "harvest now" notification

- Good, because partners could trigger fresh harvests.
- Bad, because it adds machine-to-machine authentication to the MVP for
  little gain; deferred to v1 [DL 3].

### Store source payloads as-is

- Good, because it is quick to start.
- Bad, because CSV and form sources have no OEAPI shape, versions differ, and
  the catalogue would have to understand every source format [R02 §1, §2].

## More information

- Specification §5 (canonical model) and §6 (ingestion).
- The eduXchange data-reuse consent must be recorded in the access agreement
  (spec §10).
