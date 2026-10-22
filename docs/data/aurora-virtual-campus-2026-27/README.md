<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Aurora Virtual Campus 2026–27: first real CSV upload

The 13 courses listed on the Aurora Virtual Campus website on 2026-10-15
(<https://aurora-universities.eu/study/virtual-campus/> and the 13 course
pages linked from it), transcribed into CSV template 1.2
([guide](../../guides/csv-authoring.md)), one `courses.csv` and one
`offerings.csv` per offering university, ready for the CSV console or
`POST /api/admin/v1/organizations/{orgId}/uploads`:

| Directory | University | Courses |
|---|---|---|
| `uice/` | University of Iceland | 5 |
| `ude/` | University of Duisburg-Essen | 3 |
| `vua/` | Vrije Universiteit Amsterdam | 2 |
| `upec/` | Université Paris-Est Créteil | 2 |
| `up/` | Palacký University Olomouc | 1 |

Copenhagen Business School and the University of Naples Federico II appear
only as co-organisers of two BIPs and have no rows.

## What was taken from the website and what was not

Taken as published: title, offering university, type (course, BIP, lecture
series), ECTS, level, teaching language, delivery mode, dates and on-site
weeks, application start and deadline, educational hub, SDGs, competence
framework, the micro-credential / free / enrolled-only / open-to-all flags,
and the "how to apply" circuit. Abstracts, descriptions, learning outcomes,
prerequisites and assessment are short restatements of the pages, not copies.
`isced_codes` are proposals derived from the faculty named on each page.
`course_code` (`AVC-…`) and `offering_code` (`2026-27`) are ours.

Left empty on purpose, because the website does not state them (the
Handbook publication rule reports them as warnings in `OECP_PUBLISH_RULE=warn`):

| Missing | Courses |
|---|---|
| `instructors` (teaching staff) | all 13: the pages name administrative contacts only |
| `assessment_en` | Bioeconomy BIP, Identities and Diversities, GIS, E-Business, Tabletop RPG, All Aboard |
| `prerequisites_en` | Identities and Diversities, Tabletop RPG, Queer Theologies, Applied Gender Studies, All Aboard, Challenges in Europe |
| `learning_outcomes_en` | Bioeconomy BIP, GIS, All Aboard |
| `contact_email` | kept only where the page gives a functional address (`aurora@hi.is`, `aurora@vu.nl`, `incoming-iae@u-pec.fr`); personal addresses were not transcribed, so the other courses fall back to the organization's contact |
| `attr_sdg` | Challenges in Europe (the page says each topic maps to an SDG) |
| `application_url` | only the University of Iceland portal and nothing else is a URL; the other circuits are text in `application_instructions_en` |

Two inconsistencies on the website to clear with the Foundation: BIP Spark
Social shows deadline 2026-11-15 in its header and 1 December 2025 in the
text; Languages and Culture starts on 2027-01-11 but its first lesson is on
14 January 2027.

These files are a data snapshot for the first upload, not a maintained
dataset: the universities keep their courses current in OACC afterwards.
