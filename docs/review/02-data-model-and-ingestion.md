<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Critical review of OECP v3.0: ingestion (§3), data model (§4) and their impact on §5.1

> Translated from the Spanish original on 2026-10-15; the Spanish text is in the Git history of this file. Quotations of specification v3.0 are translated from its Spanish original ([archived](../archive/spec-v3.0-original.es.md)).

## 1. Factual checks

- **OEAPI and OOAPI are not a typo.** They are the same standard, SURF's *Open Education API* (formerly "Open Onderwijs API"). The current documentation (oeapi.eu and v6) uses "OEAPI". It is advisable to write "OEAPI (formerly OOAPI)" once.
- **Versions as of October 2026.** The stable version is **v5.0** (tagged in January 2026 and in use since long before). **v6.0 is still a release candidate**: `v6.0-rc.3`, published on 2026-09-30. v4 is *legacy*. The "Ingestor v4/v5" should be planned as **v5 + v6**, with v4 optional.
- **Resource model.**
  - **v5:** `organizations`, `educationSpecifications`, `programs`, `courses`, `components`, `offerings` (of programme, course and component), `academicSessions`, `persons`, `associations` (enrolments), `groups`, `buildings`/`rooms` and `news`.
  - **v6-rc.3 breaks compatibility:** it removes `educationSpecifications`, switches to British spelling (`organisations`, `programmes`), splits components into `learning-components` and `test-components`, gives each type of offering its own endpoint (`/course-offerings`…), adds `offeringState` (`concept`/`active`/`inactive`/`cancelled`), `learning-outcomes` as a resource of its own and `validFrom`/`validTo` on the course.
  - This justifies having an ACL, but the canonical model should keep the structure **course → offering → academic session**.
- **It is a pull API.** Each university serves OEAPI through paginated GETs.
  - v5 only allows writing `persons` and `associations`. v6 adds PUT/PATCH on offerings.
  - There are no **webhooks, callbacks or delta parameter** (such as `modifiedSince`).
  - The `since` parameter filters by the start date of the session and **by default returns only future offerings**.
- **Languages.** In v5, `teachingLanguage` is a **three-letter ISO 639-2** code (`nld`). Texts are arrays of `LanguageTypedString {language:"en-GB", value}`. The spec uses ISO 639-1, so an explicit mapping is needed.
- **Delivery mode.**
  - **v5:** `distance-learning`, `on campus`, `online`, `hybrid`, `situated`.
  - **v6:** `blended`, `coil`, `hybrid`, `joint_delivery`, `online`, `presential`… and it is extensible with `x-`.
  - The spec's ENUM (`online-sync`/`online-async`…) **matches neither of the two**. No source distinguishes synchronous from asynchronous, so the filter of §5.1 has no source data. Moreover, a PostgreSQL ENUM does not suit extensible enumerations.
- **eduXchange, EWP and ESCI.**
  - **eduXchange** is a SURF platform that *consumes* OEAPI (the spec includes an `EDUXCHANGE` consumer profile) and is used by alliances such as EuroTeQ. Becoming independent of eduXchange is feasible, but the portal still depends on OEAPI. The partners that already expose OEAPI for eduXchange are the natural candidates for Channel A.
  - **EWP** is part of the *European Student Card Initiative*, together with ESI, MyAcademicID and the Erasmus+ App. It offers a **Courses API** and a **Simple Course Replication API**: it is a catalogue channel that the spec ignores, and many partners have an EWP node but no OEAPI.
- **ELM.** The claim that ELM only models credentials is inaccurate. ELM v3 also covers learning opportunities and qualifications through the **LOQ** (*Learning Opportunities and Qualifications*) application profile used by Europass. Even so, the "semantic alignment" only makes sense if a mapping or export to LOQ (`LearningOpportunity` / `LearningAchievementSpecification`) is defined and validated. A comment in the SQL does not establish it.
- **ISCED-F 2013.**
  - The codes have 2, 3 or 4 digits (broad, narrow, detailed) with a leading zero (`0613`), so they must be stored as text. `VARCHAR(10)` fits but validates nothing.
  - OEAPI v5 limits the code to 4 characters; v6 allows up to 6 (Dutch SOI 2021 extension).
  - Three things are missing:
    - a `CHECK (isced_code ~ '^\d{2,6}$')`;
    - a reference table with multilingual labels (the "Humanities, ICT…" filter corresponds to the 2-digit level);
    - support for several codes per course, for interdisciplinary provision.

## 2. Defects of the data model

**Blocking**

1. **There is no `organizations` table.** `organization_id` is NOT NULL without an FK, and §5.2-B3 manages universities, faculties and campuses, which implies a hierarchy (`parent_id`). Without that table, neither the "By Partner" filter nor the RBAC has an anchor. It must include SCHAC identifiers, the Erasmus code and the PIC, and a multilingual name.
2. **The unique natural keys are missing.** There is no `UNIQUE (organization_id, ext_id)` on `courses` nor `UNIQUE (course_id, ext_offering_id)` on `course_offerings`. Without them there is no idempotent upsert and every re-ingestion duplicates records.
3. **There is no strategy for generating the PKs.** `course_id`/`offering_id` are `VARCHAR(100)` with no generation rule. It is better to use UUIDs (v6 uses `uuid`) or `bigint identity` and leave `ext_id` as the natural key.
4. **There is no lifecycle.** Without a `status` (draft/published/withdrawn/cancelled) or `deleted_at`, a partner cannot unpublish a course. In addition, `ON DELETE CASCADE` silently deletes offerings and the logical history. I recommend soft deletion and `ON DELETE RESTRICT`.
5. **Multilingualism is rigid.** `title_en NOT NULL` excludes partners without English or pushes them to machine translation. Nor does it allow more than two languages (Catalan/Spanish, Belgian regions). OEAPI uses arrays per language. The options are a `course_texts(course_id, field, lang BCP47, value)` table or JSONB `{lang: text}`, plus a documented *fallback* policy.

**Important**

6. **Calendar.** `semester INT` does not model three-month terms, four-month terms, blocks or intensive or summer courses, and `academic_year VARCHAR(9)` has no CHECK. I propose an `academic_sessions` table (type, parent, dates) like the one in OEAPI. These CHECKs are also missing: `end_date >= start_date`, `ects_credits > 0` and `alliance_seats <= max_students`.
7. **`language_of_instruction VARCHAR(10)[]`.** It works with a GIN index, but it does not validate the codes. The ACL must normalise between ISO 639-1 and 639-2.
8. **Remaining seats.** §5.1 shows them, but there is no enrolment or counter. OEAPI offers `enrolledNumberStudents` and `pendingNumberStudents`: they must be added with a freshness timestamp, or the promise withdrawn.
9. **Fields that §5.1 needs are missing:**
   - application URL (`link` in OEAPI);
   - keywords (the search engine indexes "keywords" that do not exist);
   - bachelor/master/doctorate level (`level`) and EQF level;
   - assessment (`assessment`);
   - teaching hours;
   - coordinator or contact;
   - cost;
   - campus or location;
   - `enrollStartDate`;
   - time zone, needed for the synchronous delivery modes.
10. **`ext_metadata_history` is incomplete.** `entity_id` has no FK and `entity_type` is free text. Missing: `organization_id`, `sync_run_id`, a hash of the payload (for deduplication), the version of the source schema and the validation result. It will grow without limit, so it needs retention and monthly partitioning. If it stores `persons` or coordinators, the GDPR applies.
11. **The tables that the UI of §5.2 presupposes do not exist:**
    - `partner_integrations`: active channel, endpoint, OEAPI version, `consumer` parameter, frequency and a reference to credentials in a vault, never in clear.
    - `sync_runs`: status and counters of created, updated, unchanged, rejected and withdrawn records.
    - `sync_errors`: row or JSON Pointer, code and message.

    Without them there is no "History Monitor", no "Synchronisation Configuration", no connectivity traffic light and no deprecation by version (§5.2-B2).
12. **There is no versioning or auditing of the canonical records** (who changed what), which is indispensable if the CRUD corrects ingested data. In addition, `updated_at` has no trigger and `course_offerings` has no `updated_at`.

**Search (§5.1).** Multilingual autocompletion requires an explicit choice between two options:

- **PostgreSQL:** a `tsvector` per language, with a *stemming* configuration per language (some, such as Catalan, are not included out of the box), plus `pg_trgm` for prefixes and typos, and `unaccent`. Enough for tens of thousands of courses.
- **OpenSearch/Meilisearch:** improves facets and relevance, but adds a service and its synchronisation.

The current schema, with two fixed text columns, constrains both options.

## 3. Gaps in the ingestion design

- **Push or pull?** OEAPI is harvested (pull). A `/api/v1/ingest/ooapi/v5` route implies that *someone* sends payloads to the portal, but who: the SIS, a partner middleware? That would be a contract of its own "shaped like OEAPI" that would have to be specified: batch or entity, authentication, verbs. I recommend that Channel A be a scheduled *harvester* and that push remain, at most, a notification that triggers a harvest.
- **Idempotency.** The natural key (organization + `primaryCode`/`ext_id`) plus a content hash avoids writes without changes. For push, an `Idempotency-Key` header is needed.
- **Withdrawals.** Without delta or webhooks, they can only be detected by absence in a complete harvest. I recommend marking `withdrawn` after N absences, and never when the harvest has failed or came back empty. The default `since` (future offerings only) must be taken into account.
- **Partial failures.** It must be decided whether each run is atomic or processed entity by entity. I recommend entity by entity with a `partial` status; an offering whose course is rejected is rejected too.
- **CSV.** A versioned template is missing that sets:
  - the columns and their mapping to the canonical model;
  - UTF-8, the separator and the ISO 8601 format;
  - the encoding of multi-values and languages;
  - whether one file or two (course and offering) are used.

  The browser validator and the server validator must share **a single JSON Schema**, and the server always revalidates.
- **Change of channel or mixed channels.** A `source_channel` must be recorded per record, there must be one authoritative channel per organization, and rules must be set for manual edits to API data: they are overwritten, locked or marked as *overrides*. When migrating between channels the `ext_id` values must be kept.
- **Error contract.** I propose RFC 9457 (`problem+json`) with location (row/column or JSON Pointer), severity and a stable code.
- **Limits.** Set the CSV and payload size, the maximum number of rows, the *rate limit* **towards** the partner's SIS, timeouts and retries with *backoff*.
- **Security.** Endpoints configurable by the partners open an SSRF risk: an allowlist of destinations is needed.

## 4. Questions the owner must answer before programming

1. Is Channel A pull (harvest of each partner's OEAPI) or push, and in that case who sends and with what contract?
2. Does the MVP support v5 and v6 (still in RC) and drop v4?
3. What is the unique natural key of a course and an offering per organization, and is it stable across academic years?
4. Is English mandatory, or are courses published in the local language only, and with what *fallback*?
5. What lifecycle states exist, and how does a partner unpublish or cancel from each channel?
6. Can an organization combine channels, and what prevails when an ingested value is edited by hand?
7. Do the remaining seats come from the SIS, are they managed by the portal, or are they out of scope?
8. Which delivery-mode vocabulary is adopted (that of OEAPI v6 or one of our own), and where does the synchronous/asynchronous distinction come from?
9. Will the EWP Courses API be a fourth channel, or is it explicitly out of scope?
10. Is search done in PostgreSQL or with a dedicated engine, and in which languages must *stemming* work?

---
Sources: [OEAPI spec (GitHub)](https://github.com/open-education-api/specification) · [releases](https://api.github.com/repos/open-education-api/specification/releases) · [OEAPI v6 docs](https://oeapi.eu/specification/v6.0/index.html) · [EuroTeQ/eduXchange](https://euroteq.eurotech-universities.eu/news/euroteq-course-catalogue-making-studying-abroad-easier-with-myacademicid-and-eduxchange/) · [EWP APIs overview](https://esci-sd.atlassian.net/wiki/spaces/ITSC/pages/111509524/APIs+-+overview) · [ELM v3 launch](https://europass.europa.eu/en/news/launch-european-learning-model-new-step-interoperability-learning) · [QDR/LOQ docs](https://europass.europa.eu/en/stakeholders/qdr/documentlibrary)
