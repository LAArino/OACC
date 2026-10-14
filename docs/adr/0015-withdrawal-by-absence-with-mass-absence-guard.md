<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0015: Withdrawal by absence after N complete harvests, with a mass-absence guard

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R02] `docs/review/02-modelo-datos-ingesta.md`, [RP] `docs/research/partner-oeapi-endpoints.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

OEAPI is a pull API without deletions, webhooks or deltas: when a partner
removes a course from its catalogue, the only signal is that the course no
longer appears in a harvest [R02 §1, §3]. The owner decided that harvested
courses are withdrawn when absent from a complete harvest [DL 3]. Taken
literally, one bad run could empty the catalogue of a partner: a listing page
that times out, an endpoint that briefly returns an empty list during a
deployment, a credential that loses access to some courses, or a change in
the partner's `consumer=eduxchange` tagging.

The data is also expected to be sparse at first: the Aurora catalogue on
eduXchange is not live yet, so partners may add and remove tags while they
set it up [RP; spec §10]. And OEAPI v5 returns only future offerings unless
`since` is given, so past offerings would look absent on every run
[R02 §1]. Withdrawing a course from a public catalogue is visible to
students, while a withdrawal that comes a day or two late costs little;
partners who want a course gone at once can change its status.

When does an entity that is missing from a harvest become withdrawn?

## Decision drivers

- Never withdraw because a harvest failed, was cut short or came back empty
  [DL 3; R02 §3].
- Detect partner-side mass changes and ask a human instead of acting.
- A course that reappears is republished automatically.
- Manual decisions (status overrides) always win.
- Per-partner tuning without code changes.

## Considered options

1. Count absences only in complete runs, withdraw after N consecutive
   absences, and skip counting when 30% or more of published courses are
   missing.
2. Withdraw on the first absence from a complete run.
3. Never withdraw automatically; list absent courses for an administrator.

## Decision outcome

Chosen option: **N absences in complete runs with a mass-absence guard**
(spec §6.2.5).

As built (`apps/api/src/ingestion/harvest.service.ts`,
`CanonicalWriter.applyAbsences()` and `reject()` in
`canonical-writer.service.ts`):

- A run is **complete** when every listing page answered 2xx, no fatal
  error occurred and at least one course came back. Absences are counted
  only for complete runs (status `succeeded` or `partial`); failed, empty or
  incomplete runs never count or withdraw.
- **Mass-absence guard.** If the organization has published courses and 30%
  or more of them (`MASS_ABSENCE_RATIO = 0.3`) are missing from the run,
  nothing is counted or withdrawn; the run records warning
  `oecp.oeapi.mass_absence` with the numbers in `sync_errors` and its error
  summary, and the worker logs a warning.
- Otherwise every missing `draft` or `published` course gets
  `absent_count + 1`, and so does every missing offering whose `start_date`
  is inside the harvest window (`since` = today − 365 days, spec §6.2.3).
  At `partner_integrations.withdraw_after_absences` (default 3, allowed 1–30)
  the entity becomes `withdrawn`, with an audit row by `system:harvester`
  (`reason: absence`), unless it has a `status` override.
- Every entity seen in a run, even one rejected for invalid content, gets
  `absent_count = 0` and `last_seen_at`; a course withdrawn by absence that
  comes back with status `published` is republished (audit action
  `…republish`, `reason: seen_again`).
- CSV and form never withdraw by omission; they change `status` explicitly
  ([ADR-0011](0011-csv-uploads-all-or-nothing-shared-validator.md)).

### Consequences

- Good, because transient failures and partial outages cannot remove
  courses, and a partner-wide change stops for human review.
- Good, because withdrawals and republications are automatic, audited and
  visible in the run counters (`n_withdrawn`).
- Bad, because a course removed at the source stays public for N daily runs
  (three days by default) unless the partner changes its status.
- Bad, because a genuine large clean-up by a partner (30% or more) is never
  applied automatically; it needs an administrator, and today the warning is
  only in the run's errors and logs, not sent by e-mail.
- Neutral, because the 30% ratio is a constant in code, while N is per partner.

### Confirmation

`apps/api/test/integration/canonical-writer.int.test.ts` (counting,
withdrawal at N, status overrides, offering window, mass absence) and
`harvest.int.test.ts` (withdraw at N, republish when seen again, mass
absence warning); verified against `tools/oeapi-mock` on the dev stack
(`docs/backlog.md`).

## Pros and cons of the options

### N complete-run absences with a guard

- Good, because it is robust to failures and partner-side mistakes.
- Bad, because withdrawals are delayed.

### Withdraw on first absence

- Good, because the catalogue follows the source at once.
- Bad, because one incomplete or mis-tagged response withdraws real courses.

### Manual withdrawal only

- Good, because no automatic removal can be wrong.
- Bad, because stale courses accumulate and administrators get routine work.

## More information

- Spec §6.2.5, §8.1 "Sync monitor"; [DL 3]; [R02 §3].
- Refines the withdrawal rule of [ADR-0005](0005-pull-only-oeapi-harvesting-canonical-model.md).
- Revisit the ratio and N after the first months of real partner harvests;
  alert e-mails for mass absence belong to the observability work (spec §10).
