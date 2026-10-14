<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0010: Per-field overrides on harvested records, one authoritative channel per organization

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R00] `docs/review/00-consolidado-decisiones-pendientes.md`, [R02] `docs/review/02-modelo-datos-ingesta.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

Partners with an OEAPI endpoint are harvested daily; partners without one
use CSV or the web form [DL 3, DL 4]. The review asked whether one
organization may combine channels and what wins when someone edits harvested
data by hand [R00 §4 q12; R02 §3]. Typical cases: a partner's SIS lacks an
English abstract, carries a wrong ECTS value, or the alliance wants to hide
one course without waiting for the partner. If such edits were written into
the record, the next harvest would silently undo them; if harvested values
were frozen, the catalogue would drift from the source.

The owner decided one authoritative channel per organization, with manual
edits over harvested data kept as explicit overrides that survive the next
harvest [DL 12]. Spec v4.0 stored overrides as `{value, by, at}` and said that
removing one restores the last harvested value (spec §5 "Overrides"), but the
column holds only the effective value, so the source value was lost until the
next harvest rewrote the record.

How are manual edits on harvested records stored, and how do channels
coexist?

## Decision drivers

- Manual corrections survive every harvest; source changes to other fields
  still flow in [DL 12].
- Removing an override restores the source value at once.
- Content hashing stays idempotent: an override must not make every harvest
  look like a change (spec §6.1).
- No ambiguity about which channel owns a record.
- Every manual change audited with its author.

## Considered options

1. Per-field overrides in a `jsonb` column of each record, with the hidden
   source value, plus one authoritative channel per organization.
2. Last writer wins across channels.
3. A separate overrides table keyed by entity and field.
4. Shadow copy: store the full source record next to the effective record.

## Decision outcome

Chosen option: **per-field overrides with the hidden source value, one
authoritative channel per organization** [DL 12; spec §5, §6.5].

As built (`apps/api/src/ingestion/overrides.ts`,
`canonical-writer.service.ts`, `apps/api/src/admin/courses/`):

- `courses`, `course_texts` and `course_offerings` have
  `overrides jsonb`: `{"<field>": {"value", "by", "at", "source"}}`. Natural
  keys are never overridable; the overridable fields are listed in the
  writer (`COURSE_OVERRIDABLE`, `OFFERING_OVERRIDABLE`, text fields).
- Columns hold the effective value (source merged with overrides).
  `content_hash` is computed on the source payload before overrides, so an
  unchanged source stays `unchanged`.
- `source` is the value the harvester or CSV last delivered for that field;
  `CanonicalWriter` refreshes it on every changed payload, so clearing an
  override restores the latest source value immediately. Entries without
  `source` (written before this member existed) wait for the next harvest.
- A language the source drops while overrides keep it becomes override-only:
  it exists through its `title` override and disappears when that is cleared.
- A `status` override always wins over withdrawal by absence
  ([ADR-0015](0015-withdrawal-by-absence-with-mass-absence-guard.md)).
- `partner_integrations.authoritative_channel` is `oeapi`, `csv` or `form`
  (default `form`). The admin reference reports `form_mode`:
  - `overrides` when the channel is `oeapi`: the form may only
    `PATCH /api/admin/v1/courses/{id}/overrides` and
    `/offerings/{id}/overrides` with `set`/`clear` (text keys
    `texts.<lang>.<field>`); record writes and CSV uploads return 409
    `oecp.sync.channel_disabled`.
  - `write` otherwise: CSV and form create, replace and soft-delete the same
    records (`source_channel` = last writer); override requests return 409
    `oecp.content.override_not_allowed`; the harvester is off.
- Every save goes through `CanonicalWriter` in one transaction with a
  single-entity `sync_runs` row, `ext_metadata_history` and an audit row.
- The wizard shows each harvested field's source value with an "Override"
  toggle and sends only toggled fields.

### Consequences

- Good, because corrections persist across harvests and are reversible at
  once, with author and time on every field.
- Good, because idempotency holds: overrides never change `content_hash`.
- Good, because the channel rule makes ownership explicit; switching channels
  keeps `ext_id`s, and overrides persist (spec §6.5).
- Bad, because the writer is more complex: every upsert merges overrides and
  refreshes sources, and text overrides interact with languages the source
  adds or drops.
- Bad, because an override can hide a later correction made at the source;
  the admin sees the source value next to it but is not alerted.
- Neutral, because `csv` and `form` organizations still use last-writer-wins
  between those two channels, which both belong to the same partner.

### Confirmation

Unit tests `apps/api/test/unit/overrides.test.ts`; integration tests
`apps/api/test/integration/canonical-writer.int.test.ts` and
`admin-courses.int.test.ts` (override survives a harvest, clear restores the
source, 409 codes per mode).

## Pros and cons of the options

### Per-field overrides with source values

- Good, because of field granularity and immediate revert.
- Bad, because of writer complexity.

### Last writer wins

- Good, because it is trivial.
- Bad, because the next harvest silently reverts manual edits [R02 §3].

### Separate overrides table

- Good, because overrides can be queried across entities.
- Bad, because every catalogue read and every upsert needs another join, and
  the effective value would have to be computed or denormalised anyway.

### Shadow copy of the source record

- Good, because any field can be restored.
- Bad, because it doubles storage and still needs per-field override markers.

## More information

- Spec §5 "Overrides", §6.5, §8.1 "Course wizard"; [DL 12].
- Refines the override rule of [ADR-0005](0005-pull-only-oeapi-harvesting-canonical-model.md).
