<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Aurora "Virtual Campus" draft portal: what it shows today

Reviewed 2026-10-14 at https://aurora-universities.eu/study/virtual-campus/ (pointer from the owner).

## What it is

A static listing inside the alliance's WordPress site (YOOtheme). 13 course cards, heading
"Found 13 Results (only courses before a deadline this month are shown)", an "Archive of
courses" link, no search, no filters, no data feed (no eduXchange, SURFeduhub or OOAPI
references). Each card links to a detail page under `/opportunities/<slug>/`. Content is
manually curated.

## Fields on a detail page (labels verbatim)

Category · Educational hub · Target audience · University · ECTS credits · Mode of delivery
(values seen: "Virtual", "Blended") · Contact name / Contact email (two slots) · Language ·
Study cycle ("Bachelor, Master") · Additional info · Start date · End date · Application start ·
Application deadline · SDG (multi-valued) · Course credit (Yes/No) · Free course (Yes/No) ·
Aurora competence framework (e.g. "LOUIS") · Only for enrolled students (Yes/No) · Open for
registration to all Aurora Universities (Yes/No) · Faculty (free text, ISCED-like names) ·
Micro-credential (Yes/No). Learning outcomes, prerequisites, assessment and places appear
only in the free-text body.

## How students apply

No application button or form. The body text describes a **nomination process**: the student
contacts the Aurora office of the home university, which nominates by a deadline; the host
then sends an application form or admits first-come first-served. Contacts are mailto links.

## Universities seen

University of Iceland, Vrije Universiteit Amsterdam, Palacký University Olomouc, and UDE
scholars in a lecture series. Several entries are BIPs (Blended Intensive Programmes).

## Implications for OECP

1. **The canonical model lacks alliance-level attributes** the current portal relies on:
   educational hub, target audience, SDGs, competence framework, micro-credential flag,
   free-course flag, "only for enrolled students", "open to all alliance universities",
   faculty as free text, and course category (course vs BIP vs lecture series). Proposal:
   a `course_attributes` jsonb (schema-validated per alliance, see spec §5) plus a
   `course_kind` enum, rather than widening the OEAPI-aligned core.
2. **Application is a process, not a URL.** Besides `application_url`, offerings need an
   `application_instructions` multilingual text and a contact (the model has
   `contact_email` only; two named contacts are shown today). Person names are personal
   data: prefer functional mailboxes, as spec §10 already recommends.
3. **"Application start" exists** and maps to `enrol_start_date`; "Faculty" maps loosely to
   ISCED broad fields; "Study cycle" maps to `level` but is multi-valued ("Bachelor,
   Master"), which the model does not allow today.
4. **First real CSV dataset.** The 13 current entries plus the archive are the natural first
   Channel B upload for the Aurora Foundation (an organization without OEAPI), and a good
   acceptance test for the CSV template. They also give the public portal realistic content
   before the harvester has partner credentials.
5. **Public portal parity.** To replace this page, the OECP catalogue must at least show:
   deadline-driven listing (upcoming deadlines first), hub/SDG tags, mode, ECTS, dates,
   contacts and the nomination text; and keep an archive view.

See docs/backlog.md for the resulting items.
