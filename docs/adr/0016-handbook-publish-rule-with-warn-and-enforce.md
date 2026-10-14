<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0016: Handbook publish rule with `warn` and `enforce` modes

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: `docs/research/aurora-it-handbook-data-model.md` (Aurora IT Handbook D6.1 §3.4), [DL 21] `docs/decisions-log.md`, `docs/spec-v4.1.md` §6.1

## Context and problem statement

The Aurora IT Handbook §3.4 defines the data model of the joint course
catalogue and a publication rule: a course that misses any obligatory field
is not shown. Obligatory are, among others, the English content, learning
outcomes, requirements and assessment, ECTS, study cycle, a contact, the
instructors, and an offering with start and end dates, application start,
application deadline, language of instruction and mode of delivery
(research note above). Until decision 21 OECP required only an English title
to publish, and it did not store instructors at all.

Applied strictly from day one, the rule would hide most of the catalogue:
harvested courses usually have no instructors (OEAPI endpoints rarely
return `coordinators` expanded with names, and OECP never looks persons up
[DL 21 a]), many partner records lack application dates or assessment
texts, and the 13 current Aurora Virtual Campus entries have not been
migrated yet. The owner decided to implement the rule with a transition
period in which it only warns, and a switch to enforce it per deployment
[DL 21 c].

How does OECP apply the handbook's publication rule without emptying the
catalogue, and without making one channel stricter than another?

## Decision drivers

- One definition of "complete", identical in the browser, the API and every
  ingestion channel.
- Never lose data: an incomplete record must still be stored, so partners can
  complete it, and harvests or uploads must not fail because of it.
- Partners and administrators must see what is missing, per course.
- The alliance decides when the rule bites, without a code change or a
  migration.
- Never show an incomplete course once the rule is enforced.

## Considered options

1. A pure completeness function applied by the writer to the status each
   channel requests, with a deployment switch `OECP_PUBLISH_RULE=warn|enforce`
   (warn: publish and report; enforce: store as `draft` and report).
2. Reject incomplete courses as validation errors (harvest: entity rejected;
   CSV: upload fails; form: 422).
3. Filter at read time: store and publish as requested, and hide incomplete
   courses in the public catalogue and read API.
4. Report only (admin completeness indicator), never act on the status.

## Decision outcome

Chosen option: **"pure completeness function, applied by the writer with
`warn` and `enforce` modes"**, because it keeps a single rule for every
channel, never rejects or loses data, gives the alliance a transition period
and, once enforced, guarantees that no incomplete course is visible anywhere.

As built (spec §6.1):

- `completeness(course, offerings)` in `packages/schemas/src/handbook.ts` is
  pure and browser-safe and returns `{complete, missing[]}` with the handbook's
  field names (`texts.en.description`, `instructors`, `offerings`,
  `offerings.application_deadline`, …). The contact is satisfied by the
  organization's contact address when the course has none.
- `CanonicalWriter` evaluates it on stored, effective values (overrides
  included) once a channel has written a course **and** its offerings: after
  each harvested course's offerings, after a whole CSV upload, after every
  form save. Only courses whose requested status is `published` are checked.
- `warn` (default): the course is published as before and the run gets the
  warning `oecp.content.handbook_incomplete` with the missing fields in its
  message. `enforce`: the course is stored as `draft` with the same warning.
  Status changes made by the rule are audited (`course.status`,
  `publish_rule`).
- The admin API exposes `completeness` on each course and `complete` on list
  items; the course wizard shows a Completeness card and the courses list a
  Completeness column; the sync run detail lists the incomplete courses.
- `api` and `worker` both read `OECP_PUBLISH_RULE` (form and inline uploads
  in the api, harvests and queued uploads in the worker) and must be set
  alike.

### Consequences

- Good, because one function defines the rule for all channels and for the
  admin UI, and the browser can show the same result before a save.
- Good, because nothing is rejected: harvests and uploads keep their
  all-or-nothing and per-entity semantics ([ADR-0011](0011-csv-uploads-all-or-nothing-shared-validator.md),
  [ADR-0015](0015-withdrawal-by-absence-with-mass-absence-guard.md)).
- Good, because switching to `enforce` is a configuration change, reversible
  at any time.
- Bad, because in `warn` mode the public catalogue shows courses the handbook
  would hide; the alliance has to watch the `handbook_incomplete` counts and
  decide when to enforce.
- Bad, because in `enforce` mode an offering write can unpublish a course (its
  only published offering goes) but never republishes it: publishing again
  needs a course write (harvest of the course, its `courses.csv` row or
  "Publish" in the form).
- Bad, because harvested courses will mostly lack instructors until partners
  return named coordinators or `ext.oecp.instructors`, or administrators add
  overrides; enforcing early would hide them.
- Neutral, because the public catalogue code is unchanged: it still shows
  published courses only.

### Confirmation

`packages/schemas/test/handbook.test.ts` (the pure rule),
`apps/api/test/unit/publish-rule.test.ts`, and the integration tests
`apps/api/test/integration/handbook.int.test.ts` and `csv-upload.int.test.ts`
(both modes across channels); `apps/web/test/admin-courses.test.ts` and
`admin-course-form.test.ts` cover the Completeness column and card.

## Pros and cons of the options

### Pure function, writer applies `warn` or `enforce`

- Good, because it is consistent, data-preserving and switchable.
- Bad, because it adds a second notion of "publishable" next to the English
  title rule enforced by the database.

### Reject incomplete courses

- Good, because the catalogue only ever holds complete records.
- Bad, because whole CSV uploads would fail and harvested courses would be
  lost until fixed at the source; partners could not complete data in OECP.

### Hide at read time

- Good, because no write path changes.
- Bad, because a course would be "published" yet invisible, and the public
  API, the read API, the sitemap and search would each need the same filter.

### Report only

- Good, because it is the least intrusive.
- Bad, because the agreed rule could never be applied.

## More information

- Spec §5.2 (instructors and handbook texts), §6.1 (publication rule), §6.3
  (CSV template 1.2), §8.2 (admin API); [DL 21 a–c].
- Revisit the default once the 13 Aurora Virtual Campus entries are migrated
  and the first partner harvests run: the owner then sets
  `OECP_PUBLISH_RULE=enforce` in the deployment.
