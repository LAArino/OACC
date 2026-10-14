<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0012: Alliance course attributes as validated JSONB with per-deployment definitions

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: `docs/research/aurora-virtual-campus-draft.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

OECP is alliance-agnostic: everything specific to an alliance is
configuration, not code (spec §1). The Aurora alliance already lists its
offer on a hand-curated "Virtual Campus" page with 13 courses. Each detail
page shows fields that no standard covers: educational hub, Sustainable
Development Goals, Aurora competence framework, micro-credential, free
course, only for enrolled students, open to all Aurora universities, target
audience. It also lists several study cycles per course ("Bachelor, Master")
and lists BIPs and lecture series next to courses. Students apply through a
nomination process described in free text, not an application form
(`docs/research/aurora-virtual-campus-draft.md`).

To replace that page, OECP needs these fields as tags and filters, yet
another alliance will have different ones. The owner decided [DL 18]:
(a) a JSONB `course_attributes` per course, validated against a schema each
alliance defines in its deployment, shown as configurable tags and filters;
(b) `course_kind` (course, bip, lecture_series, other); (c) multilingual
`application_instructions` on the offering next to `application_url`, with
functional, not personal, contacts; (d) multi-valued level; (e) sorting by
application deadline. All in the MVP.

How are alliance-specific course data modelled without forking the schema
per alliance?

## Decision drivers

- One code base and one schema for every alliance (spec §1).
- Attributes validated on every channel, not free-form JSON.
- Fast containment filters and facet counts in the public catalogue.
- OEAPI v5 compatibility: what v5 cannot express goes into `ext.oecp`.
- Existing data and CSV files keep working.

## Considered options

1. `courses.attributes` JSONB validated against an `attribute_definitions`
   table seeded per deployment; dedicated columns for kind, levels and
   application instructions.
2. A fixed column per Aurora attribute.
3. An entity-attribute-value table (`course_attribute_values`).
4. Free-text tags without definitions.

## Decision outcome

Chosen option: **validated JSONB with per-deployment definitions**, plus
first-class columns for the parts every alliance shares [DL 18].

As built (migration `0005_alliance_attributes`,
`packages/schemas/src/attributes.ts`, `canonical-writer.service.ts`):

- `attribute_definitions` (one alliance per deployment, so no
  `organization_id`): `key`, `value_type` (`enum`, `multi_enum`, `boolean`,
  `text`), multilingual `label` and `description` (English required),
  `options` for enums, `filterable`, `show_as_tag`, `sort_order`.
  `oecp seed-attribute-definitions [--file] [--dry-run]` upserts by key and
  keeps definitions missing from the file. Aurora's set is in
  `apps/api/db/seed/attribute-definitions.aurora.json`, pending confirmation
  by the Aurora Foundation.
- `courses.attributes` jsonb keyed by attribute key: a CHECK constraint
  enforces the shape (string, boolean or non-empty string array) and a GIN
  `jsonb_path_ops` index serves `@>` filters. `CanonicalWriter` validates
  values against the definitions on every channel; unknown keys, wrong types
  and unknown options are rejected (`oecp.content.unknown_attribute`,
  `invalid_attribute_value`, `unknown_attribute_option`).
- `courses.kind` (`course`, `bip`, `lecture_series`, `other`; default
  `course`); `courses.levels` text[] (up to five study cycles, primary
  first), backfilled from `level`, which stays the primary level that OEAPI
  v5 can express; `course_offerings.application_instructions` jsonb
  `{lang: text}`.
- CSV template 1.1 adds `kind`, `levels` (pipe-separated; not together with
  `level`), `attr_<key>` per definition and
  `application_instructions_<lang>`; 1.0 files stay valid
  ([ADR-0011](0011-csv-uploads-all-or-nothing-shared-validator.md)).
- `/api/public/v1` filters `kind`, `attr_<key>` and `level` (any of
  `levels`), sorts by `deadline`, returns facets per filterable definition
  and resolved labels; `/reference` lists the definitions.
- `/oeapi/v5` carries `ext.oecp.kind`, `levels`, `attributes` and
  `applicationInstructions`. The harvester maps `kind = course`,
  `levels = [level]`, no attributes, and reads
  `ext.oecp.applicationInstructions` when a partner sends it.

### Consequences

- Good, because a new alliance defines its attributes in a seed file, with no
  migration and no code change, and gets tags, filters and facets.
- Good, because invalid values are refused at write time on every channel.
- Good, because all fields are overridable per field
  ([ADR-0010](0010-overrides-on-harvested-records.md)).
- Bad, because the database checks only the shape; the meaning is enforced
  by the writer, so manual SQL can store values the definitions refuse.
- Bad, because harvested partners cannot send attributes through standard
  OEAPI v5; they are set by overrides or by OECP's `ext.oecp` extension.
- Bad, because removing a definition or an option does not clean existing
  values; that needs an explicit data migration.
- Neutral, because the content hash covers the new fields, so the first
  harvest or upload after the upgrade reports records as `updated`.

### Confirmation

`packages/schemas/test/attributes.test.ts`; api integration tests
`migration-0005`, `canonical-writer`, `catalogue` and `csv-upload`.

## Pros and cons of the options

### Validated JSONB with definitions

- Good, because it is alliance-agnostic and indexable.
- Bad, because validation lives in application code.

### Fixed columns per attribute

- Good, because of database-level types.
- Bad, because every alliance would need a schema fork (spec §1).

### Entity-attribute-value table

- Good, because definitions and values are relational.
- Bad, because every facet and filter needs extra joins.

### Free-text tags

- Good, because it is the simplest.
- Bad, because there are no labels per language, no options and no reliable filters.

## More information

- [DL 18]; `docs/research/aurora-virtual-campus-draft.md`; spec §5, §7, §9.
- The Aurora attribute list is agreed with the Aurora Foundation before the
  13 current entries are migrated (`docs/backlog.md`).
