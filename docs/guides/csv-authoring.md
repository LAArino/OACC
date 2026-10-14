<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# CSV authoring: `courses.csv` and `offerings.csv`

For partner administrators and IT teams who maintain course data as CSV files, by hand or exported from a student information system (Channel B, spec §6.3). Who may upload and when to choose CSV over the web form or an OEAPI endpoint is covered by the onboarding guides [C. Partner with integration capacity](../onboarding/partner-with-integration-capacity.md) and [D. Partner without integration capacity](../onboarding/partner-manual.md). Common data rules: [guides README](README.md#common-data-quality-rules).

Uploads are refused (409 `oecp.sync.channel_disabled`) for organizations whose authoritative channel is `oeapi`. CSV and the web form write the same records, matched by code.

## File format

| Rule | Detail |
|---|---|
| Files | `courses.csv`, `offerings.csv` or both in one upload; courses are processed first, so new offerings may refer to courses of the same upload. |
| Encoding | Strict UTF-8 ("CSV UTF-8" in spreadsheet software); a byte-order mark is removed. Any invalid byte fails the file (`oecp.csv.encoding`). |
| Separator | Comma; semicolon when the header line has no comma (spreadsheets in many EU locales). Numbers always use a decimal **point**. |
| Quoting | RFC 4180: cells containing the separator, `"` or line breaks are quoted, `"` doubled. Line breaks inside quotes are kept (as `\n`). |
| Header | Row 1, exact column names (case-sensitive), any order, each once. Data starts at row 2; reports use these row numbers. |
| Cells | Leading and trailing spaces are trimmed; blank rows are skipped. |
| Empty cell vs absent column | An **empty cell clears** the field; a column **absent from the header leaves the field untouched** on existing records. Exceptions: `kind` empty → `course`; `timezone` empty → the organization's default. |
| Multi-value cells | Separated by `\|`, spaces around it ignored: `isced_codes`, `levels`, `keywords_<lang>`, `teaching_languages`, `delivery_modes`, `multi_enum` attributes. |
| Language columns | Course texts are suffixed with a primary language subtag: `title_de`, `abstract_de`… Any language other than English needs its `title_<lang>` column. |
| Dates | `YYYY-MM-DD`, real calendar dates, local to the offering's time zone. |

### `template_version`

Every row declares `1.0` or `1.1`. Generated templates are **1.1**. Template 1.1 added `kind`, `levels` and `attr_<key>` to `courses.csv` and `application_instructions_<lang>` to `offerings.csv`. A 1.0 file (none of these columns) stays valid with rows declaring `1.0` or `1.1`; a row declaring `1.0` in a file whose header has any 1.1 column fails with `oecp.csv.invalid_template_version`, as does an empty or other value. `level` (single value) is kept for 1.0 files; use `levels` in 1.1, never both.

## `courses.csv` columns

| Column | Req. | Format | Example | Notes |
|---|---|---|---|---|
| `template_version` | yes | `1.0` or `1.1` | `1.1` | per row |
| `course_code` | yes | `^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$` | `AVC-GIS-SOCIETY` | natural key; once per file; never changes |
| `status` | yes | `draft`, `published`, `withdrawn`, `cancelled` | `published` | see [Status](#status-and-omission) |
| `ects` | yes | ≤ 3 digits, ≤ 2 decimals, 0 < x ≤ 120 | `7.5` | |
| `isced_codes` | yes | 2–6 digits, `\|`-separated | `0532\|0312` | first is primary; no duplicates; known broad field |
| `title_en` | yes | 1–500 characters | `BIP: AI & Ethics` | required on every row, any status |
| `kind` | 1.1 | `course`, `bip`, `lecture_series`, `other` | `bip` | empty → `course` |
| `levels` | 1.1 | `short_cycle`, `bachelor`, `master`, `doctoral`, `other`, `\|`-separated | `master\|bachelor` | primary first; duplicates dropped; lower case |
| `level` | no | one level | `master` | 1.0 style; not with `levels` |
| `eqf_level` | no | 1–8 | `7` | |
| `teaching_hours` | no | > 0, ≤ 5 digits, ≤ 1 decimal | `30` | |
| `teaching_unit_code` | no | code of a sub-unit of your organization | `FAC-ECON` | the sub-unit must exist with that code |
| `info_url` | no | `https://…`, ≤ 2,048 | | |
| `contact_email` | no | e-mail, ≤ 320 | `courses@example.org` | else the organization's contact |
| `title_<lang>` | with any `_<lang>` column | 1–500 characters | `Verteilte Systeme` | |
| `abstract_<lang>`, `description_<lang>`, `learning_outcomes_<lang>`, `prerequisites_<lang>`, `assessment_<lang>` | no | text ≤ 20,000 | | the abstract is shown on cards (first 300 characters) |
| `keywords_<lang>` | no | `\|`-separated | `GIS\|geography` | |
| `attr_<key>` | 1.1 | per attribute definition | `sdg04\|sdg13` | [below](#alliance-attributes-attr_key) |

**Languages in a row.** A language whose cells are all empty on a row is **deleted** from that course (warning `oecp.csv.language_deleted`; English never). Text in a language whose `title_<lang>` cell is empty is an error (`oecp.csv.text_without_title`). Languages without columns in the header are untouched.

## `offerings.csv` columns

| Column | Req. | Format | Example | Notes |
|---|---|---|---|---|
| `template_version` | yes | `1.0` or `1.1` | `1.1` | |
| `course_code` | yes | code | `AVC-SPARK-SOCIAL` | in your catalogue (not deleted) or in `courses.csv` of the same upload |
| `offering_code` | yes | code | `2026-27-S2` | key together with `course_code`; once per file |
| `status` | yes | as for courses | `published` | `cancelled` keeps a labelled entry until the start date |
| `start_date`, `end_date` | yes | `YYYY-MM-DD` | `2027-01-20` | end ≥ start |
| `teaching_languages` | yes | BCP 47, `\|`-separated | `en\|de-AT` | lower-case primary subtag |
| `delivery_modes` | yes | active codes, `\|`-separated | `online\|hybrid` | `presential`, `online`, `hybrid`, `blended`, `coil`, `joint_delivery` |
| `academic_session_code` | no | code | `AUR-2026-27-S2` | an unknown code creates a session: type `period`, name = code, dates spanning the offerings using it |
| `enrol_start_date` | no | date | `2026-10-01` | ≤ deadline |
| `application_deadline` | no | date | `2026-11-15` | ≤ end date; inclusive |
| `timezone` | no | IANA | `Atlantic/Reykjavik` | empty → organization default |
| `campus` | no | ≤ 200 characters | `Reykjavik` | |
| `max_students` | no | integer ≥ 1 | `30` | empty = no limit |
| `alliance_seats` | no | integer ≥ 0 | `10` | ≤ `max_students` |
| `seats_available` | no | integer ≥ 0 | `4` | ≤ `max_students`; stamped with the upload time, shown "as of" that date |
| `application_url` | no | `https://…` | | the portal's apply button |
| `application_instructions_<lang>` | 1.1 | text ≤ 20,000 | | how to apply; an empty cell removes that language |

## Alliance attributes (`attr_<key>`)

Each deployment defines its own course attributes (`attribute_definitions`, ADR-0012). `GET /api/admin/v1/csv-template/courses.csv` adds one `attr_<key>` column per definition. Cell rules: `boolean` accepts `true`/`false`/`yes`/`no`/`1`/`0` (any case); `enum` one option value; `multi_enum` option values separated by `|` (stored in the definition's order, duplicates dropped); `text` ≤ 500 characters. An **empty cell removes** the attribute; a missing column leaves it as it is. A column naming no definition fails (`oecp.content.unknown_attribute`).

Aurora's definitions (`apps/api/db/seed/attribute-definitions.aurora.json`, still to be confirmed by the Aurora Foundation):

| Column | Type | Values |
|---|---|---|
| `attr_educational_hub` | multi_enum | `sustainability_climate_change`, `digital_society_global_citizenship`, `health_wellbeing`, `culture_identities_diversities`, `social_entrepreneurship_innovation`, `peace_education` |
| `attr_sdg` | multi_enum | `sdg01` … `sdg17` |
| `attr_competence_framework` | enum | `louis`, `none` |
| `attr_micro_credential`, `attr_free_course`, `attr_enrolled_only`, `attr_open_to_alliance` | boolean | `true`, `false` |
| `attr_target_audience` | multi_enum | `students`, `phd_candidates`, `staff` |

## Status and omission

`status` is set per row and may be any of the four values; publishing a course needs the English title, which `courses.csv` always has. **Omission never withdraws:** a course or offering missing from a file is left as it is. To take something down, upload its row with `status` `withdrawn` (or `cancelled` for an offering). Course and offering statuses are independent: withdrawing a course hides its offerings with it but does not change their status. CSV rows never delete records; deleting is done in the web form, and a code deleted there is not brought back by a CSV row (re-create it in the web form). Overrides left from a period when the organization was harvested are not removed by CSV and keep masking the uploaded value (spec §6.5).

## Limits and processing

| Limit | Value | Code |
|---|---|---|
| File size | 5 MiB per file | 413 `oecp.csv.file_too_large` |
| Rows | 5,000 data rows per file (blank rows not counted) | `oecp.csv.too_many_rows` |
| Columns | 300 | `oecp.csv.too_many_columns` |
| Cell | 20,000 characters | `oecp.csv.cell_too_long` |
| Uploads | 10 per hour per organization, failed ones included | 429 `oecp.csv.rate_limited`, `Retry-After` |
| Reported issues | 1,000 per file and severity; counts are exact | |

```sh
curl -sS -X POST "$API/organizations/$ORG/uploads" -H "Authorization: Bearer $TOKEN" \
  -F courses=@courses.csv -F offerings=@offerings.csv
```

Multipart fields `courses` and `offerings`, one file each, nothing else. Uploads with **at most 500 data rows** (both files together) are processed **inline**; larger ones are **queued** for the worker. Responses 201, 202 and 422 carry `Location: /api/admin/v1/sync-runs/{id}`.

| Outcome | HTTP | Body |
|---|---|---|
| Inline, succeeded | 201 | `{sync_run_id, status: "succeeded", processed_inline: true, run, warnings[]}` |
| Queued | 202 | `{sync_run_id, status: "queued", processed_inline: false}`: poll `GET /sync-runs/{id}` until `succeeded` or `failed` |
| Inline, failed | 422 | problem+json with `errors[]` (errors then warnings, ≤ 1,000), `sync_run_id`, `run_status`, `error_count`, `warning_count` |
| No file / other part | 400 | `oecp.csv.no_files` / `oecp.csv.unexpected_file` |
| Channel `oeapi` | 409 | `oecp.sync.channel_disabled` |
| Queue down | 503 | `oecp.internal` (run cancelled) |

**All or nothing.** The server always revalidates against the database. Any error fails the run and writes nothing except the error list (`n_rejected` = rows with errors); otherwise sessions, courses and offerings are written in one transaction. Warnings never block. A CSV run is `succeeded` or `failed`, never `partial`. Re-uploading an unchanged file counts every row as `n_unchanged`. Upload files are kept 90 days.

## Validating in the browser

The **CSV upload** page of the admin console (`/{locale}/admin/csv`) offers the templates and the JSON Schema, accepts up to two files by drag and drop, detects each file's type from its header (`offering_code` → offerings; `course_code` with `title_en` → courses) or name, and checks them in a Web Worker with the same validator the server uses. **Upload** stays disabled until the check finds no errors.

The report shows rows, errors and warnings per file and a table (filter all, errors or warnings) with severity, file, row, column, code and message; **Download report as CSV** saves it. After uploading, the server's result replaces it; a queued upload is polled every 3 seconds.

The browser cannot check everything: it checks ISCED broad fields and delivery modes from the public reference data, but **not** offering course codes against the catalogue, `teaching_unit_code`, or `attr_<key>` columns and values. A file that passes in the browser can therefore still fail on the server with `oecp.content.unknown_course`, `unknown_teaching_unit`, `unknown_attribute`, `invalid_attribute_value` or `unknown_attribute_option`.

## Codes

All `oecp.csv.*` and `oecp.content.*` codes of `errors.json`. "W" = warning; all others are errors.

| Code | Cause | Fix |
|---|---|---|
| `oecp.csv.missing_column` | required column absent; or `title_<lang>` absent while other `_<lang>` columns exist | add the column |
| `oecp.csv.unknown_column` | column not in the template: typo, wrong case, unnamed column, invalid `attr_` key | rename or remove |
| `oecp.csv.duplicate_column` | column twice in the header | remove one |
| `oecp.csv.missing_value` | required cell empty | fill it |
| `oecp.csv.invalid_template_version` | not `1.0`/`1.1`, or `1.0` with 1.1 columns | write `1.1` |
| `oecp.csv.conflicting_columns` | both `level` and `levels` | keep `levels` |
| `oecp.csv.invalid_code` | `course_code`, `offering_code`, `teaching_unit_code` or `academic_session_code` breaks the code pattern | letters, digits, `. _ / -`, ≤ 200, starting with a letter or digit |
| `oecp.csv.invalid_status` | not one of the four statuses | lower case value |
| `oecp.csv.invalid_date` | not `YYYY-MM-DD`, or not a real date | format the cell as text `YYYY-MM-DD` |
| `oecp.csv.invalid_number` | `ects` (format, ≤ 0, > 120, comma), `teaching_hours`, `max_students` (< 1), `alliance_seats`, `seats_available` | digits with a decimal point |
| `oecp.csv.invalid_url` | not `https://…` or > 2,048 characters | use https |
| `oecp.csv.invalid_email` | not an address or > 320 characters | correct it |
| `oecp.csv.invalid_language` | `teaching_languages` tag not BCP 47 with a lower-case primary subtag | `en`, `de-AT` |
| `oecp.csv.invalid_isced` | `isced_codes` not 2–6 digits separated by `\|` | e.g. `0532\|0312` |
| `oecp.csv.invalid_delivery_mode` | mode not lower-case letters, digits, `_`, `-` | use a listed code |
| `oecp.csv.invalid_level` | level value not listed (case-sensitive), or `eqf_level` not 1–8 | lower case value |
| `oecp.csv.invalid_kind` | not `course`, `bip`, `lecture_series`, `other` | |
| `oecp.csv.invalid_timezone` | unknown IANA zone | e.g. `Europe/Madrid` |
| `oecp.csv.cell_too_long` | cell over 20,000 characters | shorten |
| `oecp.csv.duplicate_row` | course code (or course + offering code) repeated in the file | one row per record |
| `oecp.csv.file_too_large` | file over 5 MiB | split into several uploads |
| `oecp.csv.too_many_rows` | more than 5,000 data rows | split |
| `oecp.csv.too_many_columns` | more than 300 columns | drop unused language columns |
| `oecp.csv.encoding` | not valid UTF-8 | save as "CSV UTF-8" |
| `oecp.csv.malformed` | unclosed quote, or text after a closing quote | fix quoting |
| `oecp.csv.field_count` | row with more or fewer cells than the header | usually an unquoted separator in a cell |
| `oecp.csv.empty_file` | no header row | use the template |
| `oecp.csv.no_data_rows` (W) | header only | nothing is written for that file |
| `oecp.csv.text_without_title` | texts in a language without `title_<lang>` on that row | add the title or empty the row's texts |
| `oecp.csv.language_deleted` (W) | every cell of a language empty: the language is deleted | intended? otherwise fill the cells |
| `oecp.csv.english_delete` | defined but not raised in 0.2.0 (`title_en` is always required) | |
| `oecp.csv.rate_limited` | 11th upload within an hour | wait `Retry-After` seconds |
| `oecp.csv.no_files` | no `courses` or `offerings` file part | attach a file |
| `oecp.csv.unexpected_file` | other multipart field or a second file in a field | only the two fields |
| `oecp.csv.write_failed` | the database refused the write; nothing saved | report the run id |
| `oecp.content.english_missing` | `title_en` longer than 500 characters | shorten |
| `oecp.content.invalid_value` | `title_<lang>` > 500, `campus` > 200, or another canonical rule (message tells) | correct the value |
| `oecp.content.date_order` | end before start, deadline after end, enrolment start after deadline | fix the dates |
| `oecp.content.seats_exceed_capacity` | `alliance_seats` or `seats_available` > `max_students` | lower them |
| `oecp.content.seats_without_timestamp` | not raised by CSV (the upload time is stamped) | |
| `oecp.content.duplicate_isced` | the same code twice in `isced_codes` | remove one |
| `oecp.content.unknown_isced_field` | first two digits not an ISCED-F broad field | correct the code |
| `oecp.content.unknown_delivery_mode` | not an active delivery mode of the deployment | use a listed code |
| `oecp.content.unknown_teaching_unit` | `teaching_unit_code` is not a sub-unit of your organization | ask the alliance to register the unit, or leave empty |
| `oecp.content.unknown_session` | not raised by CSV (unknown codes create a session) | |
| `oecp.content.unknown_course` | offering's `course_code` neither in the catalogue nor in the uploaded `courses.csv` | upload the course too |
| `oecp.content.unknown_attribute` | `attr_<key>` column without a definition | remove the column |
| `oecp.content.invalid_attribute_value` | boolean not `true/false/yes/no/1/0`, two values in an `enum`, text > 500 | per definition |
| `oecp.content.unknown_attribute_option` | value not among the definition's options | use an option value (lower case) |
| `oecp.content.invalid_code` · `unsupported_language` · `duplicate_ext_id` · `ext_id_immutable` · `override_not_allowed` · `has_published_offerings` · `published_not_deletable` · `harvested_not_deletable` | web form and admin API only, see [Web form](web-form.md#errors) | |

## CSV injection

OECP stores cell values **verbatim**: a title starting with `=` is a title. Every CSV that OECP **generates** (templates, the error report) prefixes cells starting with `=`, `+`, `-`, `@`, TAB or CR with `'`, so spreadsheet software does not run them as formulas. Treat CSV files from others with the same care.

## Worked example

Three courses and their offerings from the Aurora Virtual Campus fixture (`apps/api/test/fixtures/csv/aurora-virtual-campus.*.csv`), trimmed. The files pass the shared validator against the Aurora definitions with no error or warning. `courses.csv`:

```csv
template_version,course_code,status,ects,isced_codes,title_en,kind,levels,eqf_level,info_url,abstract_en,prerequisites_en,keywords_en,attr_educational_hub,attr_sdg,attr_competence_framework,attr_micro_credential,attr_free_course,attr_enrolled_only,attr_open_to_alliance,attr_target_audience
1.1,AVC-BIP-AI-ETHICS,published,3,0619|0223,BIP: AI & Ethics,bip,bachelor|master,,https://aurora-universities.eu/study/virtual-campus/,"Blended Intensive Programme on the ethics of artificial intelligence, combining online sessions with a short physical mobility.",Nomination by the home university's Aurora office.,artificial intelligence|ethics|BIP,digital_society_global_citizenship,sdg04|sdg09|sdg16,,false,true,true,true,students
1.1,AVC-SPARK-SOCIAL,published,6,0413|0319,BIP: Spark Social,bip,master|bachelor,7,https://aurora-universities.eu/study/virtual-campus/,Blended Intensive Programme on social innovation and entrepreneurship hosted by the University of Iceland.,Graduate students or third-year undergraduates (more than 120 ECTS).,social innovation|entrepreneurship|BIP,social_entrepreneurship_innovation,sdg08|sdg09,,false,true,true,true,students
1.1,AVC-SUST-EDU,published,5,0111|0521,Sustainability Education and Learning,course,master,7,https://aurora-universities.eu/study/virtual-campus/,Graduate course of the University of Iceland on education and learning for sustainability.,Graduate students; nomination by the home university's Aurora office.,sustainability|education,sustainability_climate_change,sdg04|sdg13,louis,true,true,true,true,students|phd_candidates
```

`offerings.csv`:

```csv
template_version,course_code,offering_code,status,start_date,end_date,teaching_languages,delivery_modes,academic_session_code,enrol_start_date,application_deadline,timezone,application_instructions_en
1.1,AVC-BIP-AI-ETHICS,2026-27-S1,published,2026-11-02,2027-01-29,en,blended,AUR-2026-27-S1,2026-09-01,2026-10-02,,"Apply through the Aurora office of your home university, which nominates candidates by the application deadline."
1.1,AVC-SPARK-SOCIAL,2026-27-S2,published,2027-01-20,2027-05-15,en,blended,AUR-2026-27-S2,2026-10-01,2026-11-15,Atlantic/Reykjavik,"Apply through the Aurora office of your home university, which nominates candidates by the application deadline."
1.1,AVC-SUST-EDU,2026-27-S2,published,2027-01-12,2027-04-30,en,online,AUR-2026-27-S2,2026-10-15,2026-12-01,Atlantic/Reykjavik,"Apply through the Aurora office of your home university, which nominates candidates by the application deadline."
```

What happens: 6 data rows, so the upload runs inline and answers 201 with `n_created` 6 on the first upload (sessions `AUR-2026-27-S1` and `-S2` are created if unknown and not counted), `n_unchanged` 6 on a repeat. `AVC-SPARK-SOCIAL` gets primary level `master` and EQF 7; the empty `attr_competence_framework` cells leave the first two courses without that attribute; the first offering takes the organization's time zone. The columns this example leaves out (`description_en`, `campus`, seats…) are untouched on existing records.

Now break three cells: `sdg18` in row 3, `0111|0111` in row 4 and `2027-02-30` as the second offering's start date. Nothing is written and the answer is 422:

```json
{ "type": "/problems/validation-failed", "title": "Upload validation failed", "status": 422,
  "instance": "/api/admin/v1/sync-runs/…",
  "detail": "3 error(s) in courses.csv and offerings.csv; nothing was written",
  "errors": [
    { "code": "oecp.content.unknown_attribute_option", "severity": "error", "file": "courses", "row": 3, "column": "attr_sdg", "message": "Attribute value is not one of the defined options: sdg18" },
    { "code": "oecp.content.duplicate_isced", "severity": "error", "file": "courses", "row": 4, "column": "isced_codes", "message": "Duplicate ISCED code" },
    { "code": "oecp.csv.invalid_date", "severity": "error", "file": "offerings", "row": 3, "column": "start_date", "message": "Expected YYYY-MM-DD" } ],
  "sync_run_id": "…", "run_status": "failed", "processed_inline": true, "error_count": 3, "warning_count": 0 }
```

In the browser the second error and the third appear before uploading; the first (`attr_sdg`) is only reported by the server.
