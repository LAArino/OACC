<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Data-provider guides

These guides are for the people who put course data into OACC: partner IT teams that expose an OEAPI endpoint, and partner administrators who upload CSV files or use the web form. They describe OACC **as built in release 0.12**; the as-built specification is [spec v4.1](../spec-v4.1.md), and every error code is listed in its [Appendix A](../spec-v4.1.md#appendix-a-error-codes) and in `packages/schemas/errors.json`. Who does what, invitations, choosing a channel and the governance around it are covered by the role-based [onboarding guides](../onboarding/README.md); these guides only cover the data.

Each organization has exactly **one authoritative channel** (`oeapi`, `csv` or `form`; no integration row means `form`). CSV and form write the same records and can be mixed. An organization harvested through OEAPI can neither upload CSV files nor create records in the form: there the form only stores overrides on harvested records (spec §6.5).

## The guides

**[API integration](api-integration.md)** is for partner IT teams that expose, or will expose, an **OEAPI v5.0** endpoint for OACC to harvest. It lists the exact requests the harvester sends (order, URLs, `consumer`, `since`, paging, headers), the authentication schemes and how the credential is stored, the network requirements (https on 443, host approval, no cross-host redirects), the complete OEAPI v5 → OACC mapping as implemented, what is deliberately not read, every warning and rejection code with cause and fix, run statuses, withdrawal by absence with its 30% guard, how to test with "Test connection", "Sync now" and the sync-run API, and how to run the OACC mock partner to compare behaviour.

**[CSV authoring](csv-authoring.md)** is for partner administrators and IT teams that produce `courses.csv` and `offerings.csv`, by hand or from an export. It is the column reference of template 1.2 (with 1.0 and 1.1 compatibility), including the instructors and the optional handbook texts, the encoding, separator and multi-value rules, the `attr_<key>` columns of the alliance attributes, status semantics, limits, inline and queued processing, the all-or-nothing rule, validation in the browser, the handbook publication rule, the complete `oecp.csv.*` and `oecp.content.*` code table, CSV injection and a worked example based on the Aurora Virtual Campus data.

**[Web form](web-form.md)** is for partner administrators who maintain a few courses by hand, and for administrators of harvested organizations who need to correct or complete harvested data. It walks through the four-step course wizard, the offering form, the status actions and what each status means in the public portal, overrides mode for harvested records, what cannot be edited and why, the history panel, and the admin API calls behind each screen for scripting.

## How problems are reported

Every channel reports problems with the same stable codes (`oecp.<area>.<name>`, never renamed or reused). The admin API answers with RFC 9457 `application/problem+json` whose `errors[]` members carry `code`, `severity` (`error` or `warning`), `message` and, depending on the channel, `file`, `row` and `column` (CSV), `pointer` (a JSON Pointer into the form body or the harvested document) and `ext_id` (the course or offering code). The same items are stored per run and can be read later with `GET /api/admin/v1/sync-runs/{id}`. Errors stop the record (CSV: the whole upload); warnings never do. Each code has **one severity**, the one in `errors.json`, in every channel; where a channel is more lenient than another it uses a code of its own (the harvester's `oecp.oeapi.english_missing` is a warning, `oecp.content.english_missing` of the other channels an error).

## Common data-quality rules

The same canonical model sits behind every channel (spec §5, §6.1), so the rules below apply whichever channel you use. Where a channel checks a rule differently, the table says so.

### English title required to publish

A course can only be `published` when it has an English text with a title (`texts.en.title`, 1–500 characters). The database enforces this with a deferred constraint trigger, so no channel can bypass it.

| Channel | Behaviour |
|---|---|
| CSV | `title_en` is a required column and a required cell on every row, whatever the status (`oecp.csv.missing_value` when empty). |
| Web form | The browser asks for the English title on every save; the API itself only requires it to publish (`oecp.content.english_missing`, 422). |
| OEAPI | A course with an English `name` is stored `published`; without one it is stored as `draft` with the warning `oecp.oeapi.english_missing`. |

Other languages are optional, but a language is only stored when it has its own title.

### Handbook publication rule

The Aurora IT Handbook (decision 21) shows a course only when all its obligatory fields are filled: the English title, description, learning outcomes, prerequisites and assessment; ECTS; at least one level; a contact (the course's, else the organization's); at least one instructor; and a published offering with start and end dates, application start, application deadline, a teaching language and a delivery mode. Every channel checks the courses it writes with the same rule (spec §6.1) and reports what is missing with the warning `oecp.content.handbook_incomplete`. The deployment's `OECP_PUBLISH_RULE` decides what an incomplete `published` course becomes:

| Mode | Effect |
|---|---|
| `warn` (default during the transition period) | published as before; warning only |
| `enforce` | stored as `draft`; same warning |

Nothing is ever rejected because of this rule. The admin console shows a *Completeness* column in the course list and a *Completeness* card in the course wizard. Instructors, and the optional texts mode of repetition, methods, literature, privacy notice and remarks, are carried by every channel: CSV columns from template 1.2, the web form, and for OEAPI expanded `coordinators` or the `ext.oecp` extensions (see each guide).

### Fields of study: ISCED-F 2013

Courses carry one or more ISCED-F 2013 codes; the first is the primary one. A code is 2 to 6 digits (`^\d{2,6}$`, in practice the 2-digit broad field, 3-digit narrow field or 4-digit detailed field), and its first two digits must be one of the seeded broad fields: `00` Generic programmes, `01` Education, `02` Arts and humanities, `03` Social sciences, journalism and information, `04` Business, administration and law, `05` Natural sciences, mathematics and statistics, `06` ICTs, `07` Engineering, manufacturing and construction, `08` Agriculture, forestry, fisheries and veterinary, `09` Health and welfare, `10` Services, `99` Field unknown. No duplicates. CSV and the form require at least one code (the form at most 10); a harvested course may have none.

### ECTS

`ects` is a number greater than 0 and at most 120, with at most two decimals and a decimal **point** (`7.5`, not `7,5`). OEAPI partners send it as `studyLoad` with `studyLoadUnit` `ects`; any other unit is a rejection.

### Dates

Dates are calendar dates `YYYY-MM-DD` that exist (`2027-02-30` is refused), local to the offering's time zone (IANA name such as `Europe/Brussels`; default: the organization's). The database enforces:

- `end_date` ≥ `start_date`;
- `application_deadline` ≤ `end_date` (it may be before `start_date`, and usually is);
- `enrol_start_date` ≤ `application_deadline` when both are set.

A violation is `oecp.content.date_order`. The public portal flags passed deadlines, and its default search lists a course only while one of its published offerings has not ended.

### Language tags

| Where | Format |
|---|---|
| Course text languages (CSV `_<lang>` suffixes, OEAPI text languages, form tabs) | Primary language subtag only, lower case, 2–3 letters (`en`, `de`, `ca`). OEAPI region subtags are dropped (`en-GB` → `en`). |
| Offering teaching languages, CSV | Well-formed BCP 47 tags with a lower-case primary subtag (`en`, `de-AT`), `\|`-separated. |
| Offering teaching languages and texts, web form | One of 29 EU/EEA primary subtags (`en de fr es ca it nl da is cs pt pl sv fi no el hu ro bg hr sk sl et lv lt ga mt eu gl`). |
| OEAPI `teachingLanguage` | ISO 639-2 (B or T), normalised to ISO 639-1 where one exists (`ger`/`deu` → `de`); `mul`, `und`, `zxx`, `mis` are dropped. |

### Delivery modes

Offerings carry one or more delivery-mode codes from the deployment's `delivery_modes` table; only active codes are accepted (`oecp.content.unknown_delivery_mode`). The seeded vocabulary (migration 0001):

| Code | Label | schema.org `courseMode` |
|---|---|---|
| `presential` | On campus | Onsite |
| `online` | Online | Online |
| `hybrid` | Hybrid | Blended |
| `blended` | Blended | Blended |
| `coil` | COIL | Online |
| `joint_delivery` | Joint delivery | Blended |

OEAPI values are mapped to the first three only (see [API integration](api-integration.md#mapping-oeapi-v5-to-oacc)).

### Codes and links

Course and offering codes (`course_code`, `offering_code`, `ext_id`) match `^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$` and can never change once a record exists: they are the natural key every channel matches on (an offering is identified by course code plus offering code). Every URL (`info_url`, `application_url`) must start with `https://` and be at most 2,048 characters; harvested `http` links are dropped with a warning.

### Status lifecycle

Courses and offerings have the same four statuses. Nothing is ever withdrawn because it is missing from a CSV file or a form; only the harvester withdraws by absence (after `withdraw_after_absences` complete runs, see [API integration](api-integration.md#withdrawal-by-absence)).

| Status | Course in the public portal | Offering in the public portal |
|---|---|---|
| `draft` | Not shown anywhere. | Not shown. |
| `published` | Shown in `/api/public/v1`, on its course page and in `/oeapi/v5`. The default search (`upcoming=true`) lists it only while it has a published offering that has not ended. | Shown on the course page (past editions included) and in `/oeapi/v5`; counts for "upcoming". |
| `withdrawn` | Not shown. | Not shown. |
| `cancelled` | Not shown (use `withdrawn` for courses). | Shown on the course page with a "cancelled" badge until its start date, without seats or the apply button; listed by `/oeapi/v5`. |

Publishing requires the English title (above). Deleting is a different operation (web form only, soft delete, refused for harvested and published records and for courses with published offerings). Writing a deleted code again, from any channel, brings the record back without its old overrides; deleted records are purged after 12 months.
