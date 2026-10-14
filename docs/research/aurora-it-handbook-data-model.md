<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Aurora IT Handbook (D6.1, draft 2025-10-07): the agreed catalogue data model vs OECP

Source: Aurora IT Handbook chapter 3.4 "Joint Centralized Course Catalogue Data Model"
(owner's copy, not in this repository). Reviewed 2026-10-14. The handbook assumes
eduXchange (SURF) as the platform; the data model itself is platform-neutral.

## Agreed fields and how OECP covers them

| Handbook field (3.4) | Obligatory | OECP today | Gap |
|---|---|---|---|
| University | yes | `organizations` | none |
| Instructors | **yes** | not stored (person data excluded by design, spec §6.2.4) | **missing** |
| Contact | yes | `courses.contact_email` (functional mailbox) | none |
| Course number | yes | `courses.ext_id` | none |
| Title | yes | `course_texts.title` (English required to publish) | none |
| Study cycle | yes | `courses.levels[]` | none |
| ECTS credits | yes | `courses.ects` | none |
| Mode of delivery | yes | `course_offering_delivery_modes` | none |
| Language of instruction | yes | `course_offerings.teaching_languages` | none |
| Requirements | yes | `course_texts.prerequisites` | none |
| Learning Outcome | yes | `course_texts.learning_outcomes` | none |
| Content | yes | `course_texts.description` | none |
| Assessment | yes | `course_texts.assessment` | none |
| Start Date / End Date | yes | `course_offerings.start_date` / `end_date` | none |
| Application Start | yes | `course_offerings.enrol_start_date` | none |
| Application Deadline | yes | `course_offerings.application_deadline` | none |
| Department | no | `teaching_units` | none |
| Period | no | `academic_sessions` | none |
| Mode of repetition | no | — | missing (e.g. "every winter semester") |
| Methods | no | — | missing (teaching methods) |
| Literature | no | — | missing |
| Privacy notice | no | — | missing |
| Remarks | no | — | missing (free text) |
| SDG | no | attribute `sdg` | none |
| Aurora Educational Hubs | no | attribute `educational_hub` | none |
| Aurora Competence Framework | no | attribute `competence_framework` | none |
| Location | no | `course_offerings.campus` | none |
| Deep Link to course | no | `courses.info_url` | none |

Publication rule in the handbook: a course missing any obligatory field is not shown;
missing optional fields do not block display. OECP today requires only an English
title (plus the DDL checks) to publish.

## Not in the handbook but seeded as Aurora attributes today

`micro_credential`, `free_course`, `enrolled_only`, `open_to_alliance`,
`target_audience`, and `course_kind` (course / BIP / lecture series). These come from
the current WordPress Virtual Campus page, not from the agreement. The handbook treats
non-ECTS "Other Offerings" (staff opportunities, further education) as a separate data
model still being developed by WP10.

## What the handbook does not contain

Per-university implementation status of the catalogue. Chapter 4.3.1 lists the student
data each university requires for enrolment (module 2), which is unrelated to the
catalogue attributes.
