<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Guide C: a university with integration capacity but no OEAPI endpoint

For universities whose IT team can spend some days or weeks on an integration but that do not run an Open Education API (OEAPI) endpoint today. In Aurora, several partners without OEAPI [DL 4] may fall here. There are two paths; this guide helps you choose and prepares the data both need. Overview: [onboarding README](README.md).

> **Before you start**
>
> - The alliance has finished [Guide A](alliance.md) and invited your partner admin, who has accepted (password plus TOTP app, or your university login once it is connected).
> - You know where course and offering data lives: the student information system (SIS), a course catalogue database, or both.
> - Someone in IT can query that system and someone in the international or education office can check the result.
> - Elapsed time: 1–3 weeks for automated CSV; 1–3 months for an OEAPI endpoint, including the access agreement.

## The two paths

**(a) Build an OEAPI v5 endpoint.** Your system answers OECP's daily harvest. After it is live you follow [Guide B](partner-with-oeapi.md). Technical companion: [API integration guide](../guides/api-integration.md).

**(b) Generate the CSV files automatically.** A scheduled export from your SIS writes `courses.csv` and `offerings.csv`; a person uploads them in the admin console. Technical companion: [CSV authoring guide](../guides/csv-authoring.md).

| | (a) OEAPI v5 endpoint | (b) Automated CSV |
|---|---|---|
| Typical IT effort | 3–8 person-weeks (less with SURF's starter kit or an SIS vendor module) | 3–10 person-days |
| Who acts each time | Nobody: OECP pulls daily | A partner admin uploads, for example weekly |
| Ongoing operation | A public `https` service, credential, allowlist, monitoring | A scheduled job and an upload routine |
| Reuse elsewhere | Same endpoint serves eduXchange and other consumers | OECP only |
| Removing a course | Automatic when it disappears for three complete harvests | Explicit: set `status` to `withdrawn` |
| Alliance attributes, course kind, application instructions, alliance seats | Not expressible: added by hand as overrides | Columns in the file (template 1.1) |
| Instructors and the optional handbook texts (methods, literature…) | Instructors from `coordinators` expanded with names, or the OECP extensions `ext.oecp.instructors` and `ext.oecp.texts`; else overrides | Columns in the file (template 1.2) |
| Legal step | Bilateral access agreement | None beyond the alliance's own rules |
| Mixing with the web form | Form can only override | Form and CSV write the same records |

Choose (a) if your university wants an OEAPI endpoint anyway (national registries, eduXchange, other alliances) or has many courses that change often. Choose (b) if OECP is the only consumer, if you need the alliance attributes in your own data, or if you need to start this semester. You can start with (b) and switch to (a) later: if your OEAPI `primaryCode` values equal the CSV `course_code` and `offering_code` values, the first harvest takes over the existing records instead of duplicating them.

## Path (a): build an OEAPI v5 endpoint

**Who:** partner IT, with the partner admin for data checks.

1. **Use the specification and tooling.** Implement OEAPI **v5.0** from SURF's `open-education-api/specification` repository; the `oeapi-endpoint-quickstart` starter kit of the open-education-api organisation (SURF) implements v5. OECP does not read v6 in 0.7.0.
2. **Implement the resources OECP reads**, with paging (`pageSize`, `pageNumber`, `hasNextPage`):

   | Request | Purpose |
   |---|---|
   | `GET /` | Service document (used by "Test connection") |
   | `GET /organizations?organizationType=root` | Identifies your university |
   | `GET /courses` | All courses for the consumer profile |
   | `GET /courses/{courseId}/offerings?since=<date>` | Offerings of a course from one year back |
   | `GET /offerings/{offeringId}?expand=academicSession` | Offering detail with its academic session |

   Honour the `consumer` query parameter (OECP sends `consumer=eduxchange` unless agreed otherwise) and return only courses meant for the alliance. Persons, enrolments and `coordinators` are never requested.
3. **Fill the fields OECP maps**: a course `primaryCode`, `name` (with English), `studyLoad` in ECTS, `fieldsOfStudy` (ISCED-F), `level`, `teachingLanguage`, `modeOfDelivery`, `link`; per offering `primaryCode`, `startDate`, `endDate`, `enrollStartDate`, `enrollEndDate`, `teachingLanguage`, `modeOfDelivery`, `link`, and optionally student numbers. Mapping rules: [API integration guide](../guides/api-integration.md).
4. **Compare with the reference.** `tools/oeapi-mock` in this repository is a small v5 server shaped exactly like what OECP harvests, with a validator against the v5.0 OpenAPI document ([README](../../tools/oeapi-mock/README.md)). Its responses are a good model for yours.
5. **Publish it** over `https` on port 443 at a public address, with a read-only credential, then continue with [Guide B](partner-with-oeapi.md) from step 2.

## Path (b): automate the CSV files

**Who:** partner IT builds the export; partner admin uploads and checks.

1. **Download the templates** from the admin console (*CSV upload* > Templates): `courses.csv`, `offerings.csv` and the JSON Schema of template 1.2. The courses template has one `attr_<key>` column for each alliance attribute, so download it from your own deployment.
2. **Map your SIS fields** to the columns, using the [CSV authoring guide](../guides/csv-authoring.md). Required course columns: `template_version`, `course_code`, `status`, `ects`, `isced_codes`, `title_en`. Required offering columns: `template_version`, `course_code`, `offering_code`, `status`, `start_date`, `end_date`, `teaching_languages`, `delivery_modes`.
3. **Keep codes stable.** `course_code` and `offering_code` identify records forever; never reuse a code for a different course.
4. **Write status explicitly.** Leaving a row out changes nothing; to remove a course or offering, export it with `status` `withdrawn` (or `cancelled` for an offering that will not take place).
5. **Generate** UTF-8 files, comma-separated, dates as `YYYY-MM-DD`, decimals with a dot, multiple values separated by `|`. Limits: 5 MiB and 5,000 rows per file; up to 10 uploads per hour.
6. **Upload** in the console: the files are checked in the browser first, then on the server. An upload is all or nothing: one error and nothing is written. Files above 500 rows are processed in the background. The steps are the same as in [Guide D](partner-manual.md#3-upload-csv-files).
7. **Schedule** the export and an upload routine before each application round, and at least monthly.

A scripted upload, without the console, is technically possible: the console calls `POST /api/admin/v1/organizations/{orgId}/uploads` with a bearer token. In 0.7.0, however, tokens come only from an interactive login with MFA and last 5 minutes, and there is no service account or API key, so unattended upload is not yet documented or supported.

Your organization's authoritative channel can stay at its default (`form`); CSV uploads and the web form both work.

## Data quality rules common to both paths

| Item | Rule |
|---|---|
| English title | Required to publish. A course without one stays draft |
| Other languages | Optional; each language needs its own title. OECP never machine-translates |
| ISCED-F | ISCED-F 2013 codes of 2–6 digits, primary first, no duplicates; the first two digits must be a broad field |
| ECTS | Greater than 0 and at most 120; dot as decimal separator |
| Dates | Real calendar dates in the offering's local time zone; start ≤ end; application start ≤ deadline ≤ end |
| Teaching languages | Real language codes (`en`, `de`, `is`); an OEAPI offering whose only language is `mul` or `und` is rejected |
| Delivery modes | `presential`, `online`, `hybrid`, `blended`, `coil`, `joint_delivery` (OEAPI: `online`, `distance-learning`, `on campus`, `situated`, `hybrid`) |
| Links | `https` only; others are dropped or refused |
| Contacts | Functional mailboxes, never personal names |
| Seats | Optional; if you send available seats, OECP shows them with the date of the data |

## Checklist

- [ ] Path chosen and agreed with the alliance
- [ ] Data owner named in the education or international office
- [ ] SIS fields mapped to OEAPI or CSV columns; English titles and ISCED codes present
- [ ] Stable course and offering codes
- [ ] (a) Endpoint live and checked against the mock's responses; then Guide B
- [ ] (b) Export scheduled; first upload passed with no errors; upload routine agreed
- [ ] Withdrawal procedure agreed: absence (a) or explicit `withdrawn` status (b)
