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
| Multi-value cells | Separated by `\|`, spaces around it ignored: `isced_codes`, `levels`, `keywords_<lang>`, `instructors`, `teaching_languages`, `delivery_modes`, `multi_enum` attributes. |
| Language columns | Course texts are suffixed with a primary language subtag: `title_de`, `abstract_de`… Any language other than English needs its `title_<lang>` column. |
| Dates | `YYYY-MM-DD`, real calendar dates, local to the offering's time zone. |

### `template_version`

Every row declares `1.0`, `1.1`, `1.2` or `1.3`. Generated templates are **1.3**. Each version only adds optional columns:

| Version | Adds |
|---|---|
| 1.1 | `kind`, `levels` and `attr_<key>` in `courses.csv`; `application_instructions_<lang>` in `offerings.csv` |
| 1.2 | `instructors` and, per language, `mode_of_repetition_<lang>`, `methods_<lang>`, `literature_<lang>`, `privacy_notice_<lang>`, `remarks_<lang>` in `courses.csv` (Aurora IT Handbook, decision 21); `offerings.csv` is unchanged |
| 1.3 | `image_url`, `image_alt_en` and `image_credit` in `courses.csv` ([course image](#course-image-image_url), decision 27); `offerings.csv` is unchanged |

A row must declare at least the version of every column in the header (filled or not): a row declaring `1.0` in a file with any 1.1, 1.2 or 1.3 column, `1.1` in a file with any 1.2 or 1.3 column, or `1.2` in a file with any 1.3 column, fails with `oecp.csv.invalid_template_version`, as does an empty or other value. Older files stay valid as they are, and rows may declare a newer version than their columns need. `level` (single value) is kept for 1.0 files; use `levels` from 1.1 on, never both. The JSON Schema of the console is `oecp-csv-1.3.schema.json`; those of 1.0, 1.1 and 1.2 are frozen.

## `courses.csv` columns

| Column | Req. | Format | Example | Notes |
|---|---|---|---|---|
| `template_version` | yes | `1.0`, `1.1`, `1.2` or `1.3` | `1.3` | per row |
| `course_code` | yes | `^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$` | `AVC-GIS-SOCIETY` | natural key; once per file; never changes |
| `status` | yes | `draft`, `published`, `withdrawn`, `cancelled` | `published` | see [Status](#status-and-omission) |
| `ects` | yes | ≤ 3 digits, ≤ 2 decimals, 0 < x ≤ 120 | `7.5` | |
| `isced_codes` | yes | 2–6 digits, `\|`-separated | `0532\|0312` | first is primary; no duplicates; known broad field |
| `title_en` | yes | 1–500 characters | `BIP: AI & Ethics` | required on every row, any status; empty: `oecp.csv.missing_value`, longer: `oecp.content.invalid_value` |
| `kind` | 1.1 | `course`, `bip`, `lecture_series`, `other` | `bip` | empty → `course` |
| `levels` | 1.1 | `short_cycle`, `bachelor`, `master`, `doctoral`, `other`, `\|`-separated | `master\|bachelor` | primary first; duplicates dropped; lower case |
| `level` | no | one level | `master` | 1.0 style; not with `levels` |
| `eqf_level` | no | 1–8 | `7` | |
| `teaching_hours` | no | > 0, ≤ 5 digits, ≤ 1 decimal | `30` | |
| `teaching_unit_code` | no | code of a sub-unit of your organization | `FAC-ECON` | the sub-unit must exist with that code |
| `info_url` | no | `https://…`, ≤ 2,048 | | |
| `contact_email` | no | e-mail, ≤ 320 | `courses@example.org` | else the organization's contact |
| `instructors` | 1.2 | names or role descriptions, `\|`-separated, each 1–200 characters, at most 50 | `Anna Jónsdóttir\|Course team, University of Iceland` | primary first; repeats dropped; an empty cell clears the list; shown on the public course page ([below](#instructors-and-personal-data)) |
| `title_<lang>` | with any `_<lang>` column | 1–500 characters | `Verteilte Systeme` | |
| `abstract_<lang>`, `description_<lang>`, `learning_outcomes_<lang>`, `prerequisites_<lang>`, `assessment_<lang>` | no | text ≤ 20,000 | | the abstract is shown on cards (first 300 characters) |
| `keywords_<lang>` | no | `\|`-separated | `GIS\|geography` | |
| `mode_of_repetition_<lang>`, `methods_<lang>`, `literature_<lang>`, `privacy_notice_<lang>`, `remarks_<lang>` | 1.2 | text ≤ 20,000 | `Every winter semester.` | optional handbook texts, shown on the course page only when filled; the privacy notice last, in small print; methods, literature and remarks are searchable |
| `attr_<key>` | 1.1 | per attribute definition | `sdg04\|sdg13` | [below](#alliance-attributes-attr_key) |
| `image_url` | 1.3 | `https://…`, ≤ 2,048 | `https://www.urv.cat/img/course-gis.jpg` | the course image, fetched after the upload ([below](#course-image-image_url)); empty: the image stays as it is |
| `image_alt_en` | 1.3 | text ≤ 300 | `Students mapping a river with GPS receivers` | English alternative text; empty with a URL: decorative image |
| `image_credit` | 1.3 | text ≤ 300 | `Photo: URV / A. Example, CC BY 4.0` | shown in small print under the image |

**Languages in a row.** A language whose cells are all empty on a row is **deleted** from that course (warning `oecp.csv.language_deleted`; English never). Text in a language whose `title_<lang>` cell is empty is an error (`oecp.csv.text_without_title`). Languages without columns in the header are untouched.

### Instructors and personal data

`instructors` holds the names (or role descriptions, such as "Course team, University of Iceland") of the teaching staff **exactly as your university already publishes them** for this course in its own catalogue. They are personal data: OACC republishes them for the same purpose, keeps nothing else about the person (no e-mail address, phone or identifier) and never looks anyone up. Do not add names your university does not publish; a role description is enough. The column is optional, but the handbook's publication rule counts at least one instructor as obligatory ([below](#publication-rule-handbook-completeness)).

### Course image (`image_url`)

One image per course (decision 27), shown on the course card and above *About this course*; without one the portal shows the partner logo line as before. OACC stores its own copy: the image is fetched **once**, never hot-linked.

- **When.** After the upload has been processed successfully, the worker fetches every `image_url` that differs from the URL the course's current image was fetched from. The upload's result does not wait for it; repeating the same URL in a later upload fetches nothing. An empty cell (or no column) leaves the image as it is; removing an image is done in the web form or the admin API, not by CSV.
- **What is accepted.** `https://` on port 443 only, from a public address (never an internal, private or loopback one), at most 3 redirects, each to `https://`; at most 20 seconds and **5 MiB**; JPEG, PNG or WebP recognised from the content (the server's content type is not trusted), at most 40 megapixels. The image is re-encoded to WebP without metadata (no EXIF, location or camera data): a large version fitted inside 1600×1600 and a card version inside 640×640, never enlarged. Use a landscape image of at least 1600 pixels wide; cards crop to 16:9.
- **Alternative text and credit.** `image_alt_en` describes the image for screen readers; leave it empty only for a purely decorative image. `image_credit` names the author and licence when needed. Both are stored only together with a successfully fetched image: on a failed fetch the course keeps its previous image, text and credit.
- **Rights and people.** Upload only images your university may publish for this purpose, and no identifiable people (decision 27): the partner declares the rights for every image ([art. 28 checklist](../production/art28-processor-checklist.md)).
- **Failures** never fail the upload: they are added to the upload's run afterwards as warnings `oecp.media.fetch_failed` on the course's row, column `image_url` (see *Sync history*), with the reason (HTTP status, size, refused address, not an image…).

## `offerings.csv` columns

| Column | Req. | Format | Example | Notes |
|---|---|---|---|---|
| `template_version` | yes | `1.0`, `1.1`, `1.2` or `1.3` | `1.1` | 1.2 and 1.3 add no offering column |
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

Aurora's definitions (`apps/api/db/seed/attribute-definitions.aurora.json`, aligned with the filters of the Aurora Virtual Campus website and confirmed by the owner on 2026-10-15):

| Column | Type | Values |
|---|---|---|
| `attr_educational_hub` | multi_enum | `sustainability_climate_change`, `digital_society_global_citizenship`, `health_wellbeing`, `culture_identities_diversities`, `social_entrepreneurship_innovation`, `peace_education`, `other` |
| `attr_sdg` | multi_enum | `sdg01` … `sdg17` |
| `attr_competence_framework` | enum | `louis`, `seizmic`, `bevi`, `none` |
| `attr_micro_credential`, `attr_free_course`, `attr_enrolled_only`, `attr_open_to_alliance` | boolean | `true`, `false` |
| `attr_target_audience` | multi_enum | `students`, `academics`, `administrative_staff`, `other` |

## Status and omission

`status` is set per row and may be any of the four values; publishing a course needs the English title, which `courses.csv` always has. **Omission never withdraws:** a course or offering missing from a file is left as it is. To take something down, upload its row with `status` `withdrawn` (or `cancelled` for an offering). Course and offering statuses are independent: withdrawing a course hides its offerings with it but does not change their status. Overrides left from a period when the organization was harvested are not removed by CSV and keep masking the uploaded value (spec §6.5).

**Deleted codes come back.** CSV rows never delete records; deleting is done in the web form (only for records that are not published, [web form guide](web-form.md#status-actions)). A row whose `course_code` (or course and offering code) was deleted **revives** the record, as re-creating it in the web form does: it is written as new from the row (counted in `n_created`), its old overrides are dropped and the audit log records `course.revive` or `course_offering.revive`. The offerings of a revived course stay deleted unless `offerings.csv` has rows for them. Deleted records are purged for good 12 months after their deletion (`OECP_RETENTION_SOFT_DELETED_MONTHS`); after that the same code simply creates a new record.

**Overrides left from a harvesting period are dropped.** Overrides exist only while your organization's authoritative channel is `oeapi` (then CSV is refused). After a switch to `csv`, the first row that writes a course or offering drops the overrides it still carries (the course's text overrides included), as a web form save does, so the uploaded values are what the catalogue shows; the audit log records `course.overrides_drop` or `course_offering.overrides_drop` with the dropped keys. A column absent from the header keeps the value the catalogue showed until then, which may be the dropped override's value.

### Publication rule (handbook completeness)

The Aurora IT Handbook shows a course only when every obligatory field is filled: English title, description (Content), learning outcomes, prerequisites (Requirements) and assessment; ECTS; at least one level; a contact (the course's `contact_email` or the organization's); at least one instructor; and at least one **published** offering with start and end dates, `enrol_start_date` (Application start), `application_deadline`, a teaching language and a delivery mode. After a successful upload the server checks every course of `courses.csv` and every course reached through `offerings.csv` whose status is `published`, on the stored values (so columns you leave out still count with their current values). The browser check cannot see this rule.

What happens depends on the deployment's `OECP_PUBLISH_RULE`:

| Mode | Incomplete course with `status` `published` |
|---|---|
| `warn` (default, transition period) | Published as before, with the warning `oecp.content.handbook_incomplete` |
| `enforce` | Stored as `draft`, with the same warning |

The warning never fails the upload. Its message starts with the course code and lists the missing fields, for example `AVC-SPARK-SOCIAL: Course is missing fields the Aurora IT Handbook requires to publish: texts.en.learning_outcomes, texts.en.assessment, contact_email`; it is reported on the course's row of `courses.csv` (or under `offerings` for a course reached only through `offerings.csv`). In `enforce` mode an `offerings.csv` row can unpublish a course (when it loses its only published offering) but never publishes one: upload the course's `courses.csv` row again once it is complete. The course list of the web form shows the same check as a *Completeness* column.

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

Multipart fields `courses` and `offerings`, one file each, nothing else. Uploads with **at most 500 data rows** (both files together) are processed **inline**; larger ones are **queued** for the worker. Every response that has a run carries `Location: /api/admin/v1/sync-runs/{id}`: 201, 202, 422 and 503. Responses 400, 409, 413 and 429 create no run and have no `Location`.

| Outcome | HTTP | Body |
|---|---|---|
| Inline, succeeded | 201 | `{sync_run_id, status: "succeeded", processed_inline: true, run, warnings[]}`; `warnings` include `oecp.content.handbook_incomplete` ([publication rule](#publication-rule-handbook-completeness)) |
| Queued | 202 | `{sync_run_id, status: "queued", processed_inline: false}`: poll `GET /sync-runs/{id}` until `succeeded` or `failed` |
| Inline, failed | 422 | problem+json with `errors[]` (errors then warnings, ≤ 1,000), `sync_run_id`, `run_status`, `error_count`, `warning_count` |
| No file / other part | 400 | `oecp.csv.no_files` / `oecp.csv.unexpected_file` |
| Channel `oeapi` | 409 | `oecp.sync.channel_disabled` |
| Queue down | 503 | `oecp.internal` (run cancelled; `Location` names the cancelled run) |

**All or nothing.** The server always revalidates against the database. Any error fails the run and writes nothing except the error list (`n_rejected` = rows with errors); otherwise sessions, courses and offerings are written in one transaction. Warnings never block. A CSV run is `succeeded` or `failed`, never `partial`. Re-uploading an unchanged file counts every row as `n_unchanged`. Upload files are kept 90 days.

## Validating in the browser

The **CSV upload** page of the admin console (`/{locale}/admin/csv`) offers the templates and the JSON Schema, accepts up to two files by drag and drop, detects each file's type from its header (`offering_code` → offerings; `course_code` with `title_en` → courses) or name, and checks them in a Web Worker with the same validator the server uses. **Upload** stays disabled until the check finds no errors.

The report shows rows, errors and warnings per file and a table (filter all, errors or warnings) with severity, file, row, column, code and message; **Download report as CSV** saves it. After uploading, the server's result replaces it; a queued upload is polled every 3 seconds.

The browser cannot check everything: it checks ISCED broad fields and delivery modes from the public reference data, but **not** offering course codes against the catalogue, `teaching_unit_code`, or `attr_<key>` columns and values. A file that passes in the browser can therefore still fail on the server with `oecp.content.unknown_course`, `unknown_teaching_unit`, `unknown_attribute`, `invalid_attribute_value` or `unknown_attribute_option`. For `image_url` both check only the shape (`https://`, length) and the lengths of `image_alt_en` and `image_credit`; whether the image can be fetched is known only after the upload ([`oecp.media.fetch_failed`](#course-image-image_url)).

### JSON Schema

`GET /api/admin/v1/csv-template/schema.json` serves `packages/schemas/json/csv/oecp-csv-1.3.schema.json` (JSON Schema 2020-12, `$id` `urn:oecp:schema:csv:1.3`, row definitions `#/$defs/courseRow` and `#/$defs/offeringRow`). Cells that hold exactly one canonical value reference the canonical schema instead of repeating its rules: `status` → `lifecycleStatus`, `kind` → `courseKind`, `level` → `courseLevel`, `start_date`, `end_date`, `enrol_start_date`, `application_deadline` → `isoDate` (a real calendar date), each as `urn:oecp:schema:canonical:1#/$defs/<name>`; optional cells accept `""` or the referenced value. Multi-value cells (`isced_codes`, `levels`, `teaching_languages`, `delivery_modes`) keep a pattern, because JSON Schema cannot split a `|`-separated string; the patterns are built from the same primitives (`ISCED_CODE_PATTERN`, `LANGUAGE_TAG_PATTERN`, `DELIVERY_MODE_CODE_PATTERN`).

The document is **self-contained**: the canonical schema (`oecp-canonical-1.schema.json`) is embedded under `$defs["oecp-canonical-1"]` with its own `$id`, as JSON Schema 2020-12 bundling allows, so the references resolve without fetching anything and a browser or CI validator needs only this one file. The embedded copy is generated from the canonical schema at build time (`packages/schemas/scripts/generate-json.mjs`), byte-for-byte the same definitions. Do not add `oecp-canonical-1.schema.json` to the same validator instance as well (Ajv refuses a second schema with the same `$id`). `isoDate` declares `format: "date"` besides its pattern: with Ajv, add `ajv-formats` or turn format validation off (the pattern alone is exact); in strict mode set `allowMatchingProperties: true` (`title_en` is a fixed column and also matches the language-column pattern). The admin console does not use this document: it runs the Zod validator of `@oecp/schemas`. The schema checks the shape of single rows only; header checks, date order and seats, IANA time zones, BCP 47 subtags, ISCED duplicates, template versions per column and every reference check are the validator's.

## Codes

Every `oecp.csv.*` code of `packages/schemas/errors.json` (144 codes in all; spec [Appendix A](../spec-v4.1.md#appendix-a-error-codes)) and every `oecp.content.*` code a data file can meet, in its order; the eleven content codes that only the admin API and the web form raise on single records and organizations (`invalid_parent`, `duplicate_identifier`, `duplicate_ext_id`, `unsupported_language`, `slug_immutable`, `ext_id_immutable`, `override_not_allowed`, `harvested_not_deletable`, `published_not_deletable`, `has_published_offerings`, `organization_in_use`) are in Appendix A and the [web form guide](web-form.md). **Sev.** is the catalogue's severity, which is the one every channel reports (spec §6.6): E = error (the upload fails, nothing is written), W = warning (reported, never blocks). Codes that CSV cannot raise are listed with the channel that does.

| Code | Sev. | Cause | Fix |
|---|---|---|---|
| `oecp.csv.missing_column` | E | required column absent; or `title_<lang>` absent while other `_<lang>` columns exist | add the column |
| `oecp.csv.unknown_column` | E | column not in the template: typo, wrong case, unnamed column, invalid `attr_` key | rename or remove |
| `oecp.csv.missing_value` | E | required cell empty (also an empty `title_en`) | fill it |
| `oecp.csv.invalid_template_version` | E | not `1.0`/`1.1`/`1.2`/`1.3`, or a version older than a column of the header (`1.0` with 1.1–1.3 columns, `1.1` with 1.2 or 1.3 columns, `1.2` with 1.3 columns) | write `1.3` |
| `oecp.csv.conflicting_columns` | E | both `level` and `levels` | keep `levels` |
| `oecp.csv.invalid_code` | E | `course_code`, `offering_code`, `teaching_unit_code` or `academic_session_code` breaks the code pattern | letters, digits, `. _ / -`, ≤ 200, starting with a letter or digit |
| `oecp.csv.invalid_status` | E | not one of the four statuses | lower case value |
| `oecp.csv.invalid_date` | E | not `YYYY-MM-DD`, or not a real date | format the cell as text `YYYY-MM-DD` |
| `oecp.csv.invalid_number` | E | `ects` (format, ≤ 0, > 120, comma), `teaching_hours`, `max_students` (< 1), `alliance_seats`, `seats_available` | digits with a decimal point |
| `oecp.csv.invalid_url` | E | `info_url`, `image_url` or `application_url` not `https://…`, or > 2,048 characters | use https |
| `oecp.csv.invalid_email` | E | not an address or > 320 characters | correct it |
| `oecp.csv.invalid_language` | E | `teaching_languages` tag not BCP 47 with a lower-case primary subtag | `en`, `de-AT` |
| `oecp.csv.invalid_isced` | E | `isced_codes` not 2–6 digits separated by `\|` | e.g. `0532\|0312` |
| `oecp.csv.invalid_delivery_mode` | E | mode not lower-case letters, digits, `_`, `-` | use a listed code |
| `oecp.csv.invalid_level` | E | level value not listed (case-sensitive), or `eqf_level` not 1–8 | lower case value |
| `oecp.csv.invalid_kind` | E | not `course`, `bip`, `lecture_series`, `other` | |
| `oecp.csv.invalid_timezone` | E | unknown IANA zone | e.g. `Europe/Madrid` |
| `oecp.csv.cell_too_long` | E | cell over 20,000 characters | shorten |
| `oecp.csv.duplicate_row` | E | course code (or course + offering code) repeated in the file | one row per record |
| `oecp.csv.file_too_large` | E | file over 5 MiB (HTTP 413) | split into several uploads |
| `oecp.csv.too_many_rows` | E | more than 5,000 data rows | split |
| `oecp.csv.too_many_columns` | E | more than 300 columns | drop unused language columns |
| `oecp.csv.encoding` | E | not valid UTF-8 | save as "CSV UTF-8" |
| `oecp.csv.malformed` | E | unclosed quote, or text after a closing quote | fix quoting |
| `oecp.csv.rate_limited` | E | 11th upload within an hour (HTTP 429) | wait `Retry-After` seconds |
| `oecp.csv.duplicate_column` | E | column twice in the header | remove one |
| `oecp.csv.field_count` | E | row with more or fewer cells than the header | usually an unquoted separator in a cell |
| `oecp.csv.empty_file` | E | no header row | use the template |
| `oecp.csv.text_without_title` | E | texts in a language without `title_<lang>` on that row | add the title or empty the row's texts |
| `oecp.csv.language_deleted` | W | every cell of a language empty: the language is deleted from the course (never English) | intended? otherwise fill the cells |
| `oecp.csv.no_data_rows` | W | header only | nothing is written for that file |
| `oecp.csv.no_files` | E | no `courses` or `offerings` file part (HTTP 400) | attach a file |
| `oecp.csv.unexpected_file` | E | other multipart field or a second file in a field (HTTP 400) | only the two fields |
| `oecp.csv.write_failed` | E | the database refused the write; nothing saved | report the run id |
| `oecp.content.english_missing` | E | not raised by CSV (`title_en` is required on every row); web form and admin API: publishing without an English title | |
| `oecp.content.invalid_value` | E | `title_en` or `title_<lang>` > 500, `campus` > 200, `image_alt_en` or `image_credit` > 300, `instructors` (an entry over 200 characters, more than 50 entries, or an empty entry between separators), or another canonical rule (message tells) | correct the value |
| `oecp.content.date_order` | E | end before start, deadline after end, enrolment start after deadline | fix the dates |
| `oecp.content.seats_exceed_capacity` | E | `alliance_seats` or `seats_available` > `max_students` | lower them |
| `oecp.content.seats_without_timestamp` | E | not raised by CSV (the upload time is stamped) | |
| `oecp.content.duplicate_isced` | E | the same code twice in `isced_codes` | remove one |
| `oecp.content.unknown_isced_field` | E | first two digits not an ISCED-F broad field | correct the code |
| `oecp.content.unknown_delivery_mode` | E | not an active delivery mode of the deployment | use a listed code |
| `oecp.content.unknown_teaching_unit` | E | `teaching_unit_code` is not a sub-unit of your organization | ask the alliance to register the unit, or leave empty |
| `oecp.content.unknown_session` | E | not raised by CSV (unknown codes create a session) nor by any other channel in this release | |
| `oecp.content.session_ignored` | W | not raised by CSV; the harvester stores an offering without an unknown or invalid academic session ([API integration](api-integration.md#warning-and-rejection-codes)) | |
| `oecp.content.unknown_course` | E | offering's `course_code` neither in the catalogue nor in the uploaded `courses.csv` | upload the course too |
| `oecp.content.unknown_attribute` | E | `attr_<key>` column without a definition | remove the column |
| `oecp.content.invalid_attribute_value` | E | boolean not `true/false/yes/no/1/0`, two values in an `enum`, text > 500 | per definition |
| `oecp.content.unknown_attribute_option` | E | value not among the definition's options | use an option value (lower case) |
| `oecp.content.invalid_code` · `unsupported_language` · `duplicate_ext_id` · `ext_id_immutable` · `override_not_allowed` · `has_published_offerings` · `published_not_deletable` · `harvested_not_deletable` | E | web form and admin API only, see [Web form](web-form.md#errors) | |
| `oecp.content.duplicate_slug` · `duplicate_identifier` · `slug_immutable` · `invalid_parent` · `organization_in_use` | E | *Organizations* page and admin API only (alliance administrators) | |
| `oecp.content.handbook_incomplete` | W | a `published` course misses fields the Aurora IT Handbook requires; in `enforce` mode it is stored as `draft` | fill the listed fields ([publication rule](#publication-rule-handbook-completeness)) |
| `oecp.media.fetch_failed` | W | the `image_url` of an accepted row could not be fetched or is not a usable image (added to the run after it finished; the course keeps its image) | fix the URL or the file, or upload the image in the web form |
| `oecp.media.too_large` · `unsupported_type` · `invalid_image` · `alt_required` · `not_found` | E | web form and admin API only (`PUT`/`PATCH`/`DELETE …/courses/{id}/image`); in CSV the same causes are reported as `oecp.media.fetch_failed` | |

## CSV injection

OACC stores cell values **verbatim**: a title starting with `=` is a title. Every CSV that OACC **generates** (templates, the error report) prefixes cells starting with `=`, `+`, `-`, `@`, TAB or CR with `'`, so spreadsheet software does not run them as formulas. Treat CSV files from others with the same care.

## Worked example

Three courses and their offerings from the Aurora Virtual Campus fixture (`apps/api/test/fixtures/csv/aurora-virtual-campus.*.csv`), trimmed. `courses.csv` uses template 1.2 (`instructors`, `methods_en`, `remarks_en`); `offerings.csv` still declares 1.1, which is fine because 1.2 adds no offering column. The files pass the shared validator against the Aurora definitions with no error or warning. `courses.csv`:

```csv
template_version,course_code,status,ects,isced_codes,title_en,kind,levels,eqf_level,info_url,abstract_en,prerequisites_en,keywords_en,instructors,methods_en,remarks_en,attr_educational_hub,attr_sdg,attr_competence_framework,attr_micro_credential,attr_free_course,attr_enrolled_only,attr_open_to_alliance,attr_target_audience
1.2,AVC-BIP-AI-ETHICS,published,3,0619|0223,BIP: AI & Ethics,bip,bachelor|master,,https://aurora-universities.eu/study/virtual-campus/,"Blended Intensive Programme on the ethical questions raised by artificial intelligence, combining online sessions with a short physical mobility.",Nomination by the home university's Aurora office.,artificial intelligence|ethics|BIP,"BIP teaching team, Aurora partner universities",Online sessions combined with a short physical mobility.,,digital_society_global_citizenship,sdg04|sdg09|sdg16,,false,true,true,true,students
1.2,AVC-SPARK-SOCIAL,published,6,0413|0319,BIP: Spark Social,bip,master|bachelor,7,https://aurora-universities.eu/study/virtual-campus/,Blended Intensive Programme on social innovation and entrepreneurship hosted by the University of Iceland.,Graduate students or third-year undergraduates (more than 120 ECTS); nomination by the home university's Aurora office.,social innovation|entrepreneurship|BIP,"Course team, University of Iceland",Online sessions combined with a short physical mobility.,Hosted by the University of Iceland.,social_entrepreneurship_innovation,sdg08|sdg09,,false,true,true,true,students
1.2,AVC-SUST-EDU,published,5,0111|0521,Sustainability Education and Learning,course,master,7,https://aurora-universities.eu/study/virtual-campus/,Graduate course of the University of Iceland on education and learning for sustainability.,Graduate students; nomination by the home university's Aurora office.,sustainability|education,"Course team, host university",,,sustainability_climate_change,sdg04|sdg13,louis,true,true,true,true,students|academics
```

`offerings.csv`:

```csv
template_version,course_code,offering_code,status,start_date,end_date,teaching_languages,delivery_modes,academic_session_code,enrol_start_date,application_deadline,timezone,application_instructions_en
1.1,AVC-BIP-AI-ETHICS,2026-27-S1,published,2026-11-02,2027-01-29,en,blended,AUR-2026-27-S1,2026-09-01,2026-10-02,,"Apply through the Aurora office of your home university, which nominates candidates by the application deadline."
1.1,AVC-SPARK-SOCIAL,2026-27-S2,published,2027-01-20,2027-05-15,en,blended,AUR-2026-27-S2,2026-10-01,2026-11-15,Atlantic/Reykjavik,"Apply through the Aurora office of your home university, which nominates candidates by the application deadline."
1.1,AVC-SUST-EDU,2026-27-S2,published,2027-01-12,2027-04-30,en,online,AUR-2026-27-S2,2026-10-15,2026-12-01,Atlantic/Reykjavik,"Apply through the Aurora office of your home university, which nominates candidates by the application deadline."
```

What happens: 6 data rows, so the upload runs inline and answers 201 with `n_created` 6 on the first upload (sessions `AUR-2026-27-S1` and `-S2` are created if unknown and not counted), `n_unchanged` 6 on a repeat. `AVC-SPARK-SOCIAL` gets primary level `master` and EQF 7; the empty `attr_competence_framework` cells leave the first two courses without that attribute; the empty `methods_en` and `remarks_en` cells of `AVC-SUST-EDU` leave those texts unset; the first offering takes the organization's time zone. The columns this example leaves out (`description_en`, `campus`, seats…) are untouched on existing records.

The server then applies the [publication rule](#publication-rule-handbook-completeness): the example has no description, learning outcomes or assessment, so `warnings` holds one `oecp.content.handbook_incomplete` per course (rows 2–4 of `courses.csv`), for example `AVC-SPARK-SOCIAL: Course is missing fields the Aurora IT Handbook requires to publish: texts.en.description, texts.en.learning_outcomes, texts.en.assessment`, plus `contact_email` when neither the course nor the organization has a contact address. With `OECP_PUBLISH_RULE=warn` the three courses are published anyway; with `enforce` they are stored as drafts.

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
