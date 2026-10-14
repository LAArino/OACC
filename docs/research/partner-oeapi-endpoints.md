# Partner OEAPI endpoints: what is publicly discoverable

Research date: 2026-10-14. Evidence tags: **[LIVE]** = verified by a live HTTP call, **[DOC]** = taken from a published document or source code, **[INF]** = inferred, **[NF]** = searched for, not found.

## Summary

None of the four partners publishes an OEAPI base URL **[NF]**. I searched GitHub, the open-education-api repos, SURF/eduXchange docs, Aurora deliverables and the web. eduXchange appears to reach partner endpoints through the **SURFeduhub gateway**, not directly **[DOC]**. That gateway needs client credentials **[LIVE]**. No partner endpoint could be called, so no course or offering payloads were captured. The field lists below come from the v5.0 spec.

| Partner | Endpoint URL | Version | Auth | Consumer profile | Notes |
|---|---|---|---|---|---|
| UIBK | not public [NF] | v5.0 [INF] | Gateway: HTTP Basic [LIVE]. Endpoint: unknown; SURF holds it (Basic, OAuth2 client credentials or custom header) [DOC] | `consumer=eduxchange` [DOC] | Catalogue in in-house LFU:online; no OEAPI trace |
| UICE | not public [NF] | v5.0 [INF] | as UIBK | as UIBK | Only trace: a minimal FastAPI `/courses` demo by a UICE academic (tprunarsson/ooapi_python, 2025), not production |
| VUA | not public [NF] | v5.0 [INF] | as UIBK | as UIBK | Dutch HEIs usually already run OOAPI v5 for RIO via SURFeduhub [DOC, generic]; nothing VU-specific found |
| UDE | not public [NF] | v5.0 [INF] | as UIBK | as UIBK | Runs HISinOne; no OEAPI trace |

## How eduXchange consumes OEAPI [DOC]

- **Profile:** open-education-api/documentation (`eduxchange.md`) and open-education-api/profiles.
  - Orientation calls: `/organizations?organizationType=root`, `/programs?programType=minor`, `/courses`, `/courses/{id}/offerings`, `/offerings/{id}?expand=academicSession`, `/academic-sessions`.
  - Enrolment calls: `/persons/me`, `POST /associations/external/me`.
- **Query parameters:** eduXchange "will always append `consumer=eduxchange`" to every call. It may also add `alliances.name=<alliance>`.
- **Required attributes:**
  - Courses: `courseId, primaryCode, name, abbreviation, description, teachingLanguage, level, studyLoad`.
  - Offerings: `offeringId, primaryCode, offeringType, name, description, teachingLanguage, resultExpected, startDate, endDate`.
  - Both also need `consumers[]` with `consumerKey:"eduxchange"` and `alliances[].name`.
- **No Aurora alliance value yet:** allowed names are `ewuu` and `lde` in the v5 spec, plus `euroteq` and `kom` in the profiles repo (June 2026). `aurora` is not listed.
- **SURFeduhub sits between eduXchange and the institutions:**
  - SURF's TNC26 slides (June 2026): each institution runs its own endpoint. Consumers such as eduXchange request data *via* SURFeduhub, which passes data on without storing it.
  - SURF's knowledge base calls SURFeduhub a "smart reverse proxy" that forwards eduXchange requests to the institution.
  - Aurora D6.1 (IT Handbook) speaks of "the frontend of SURFeduhub/eduXchange". Each university signs its own pilot agreement with SURF and tags Aurora courses locally; NocoDB middleware is the fallback.
- **Gateway mechanics (SURFnet/eduhub-gateway source):** clients use HTTP Basic. `X-Route: endpoint=<id>[,<id>]` picks the institutions, with access lists per app, endpoint, path and version. `Accept: application/json` means v5; `application/vnd.oeapi+json;version=6` means v6.
- **Live check:** `GET https://gateway.surfeduhub.nl/courses` returns `401` with `WWW-Authenticate: Basic realm="SURFnet OOAPI Gateway client access"` **[LIVE]**.
- **Aurora on eduXchange.EU:** the eduxchange.eu frontend ships Aurora UI strings, but `aurora.eduxchange.eu` redirects to `eduxchange.eu/aurora/`, which renders a 404 page; only `/euroteq` is linked **[LIVE]**. The Aurora catalogue is not publicly live, although D6.1 had planned production for summer semester 2026.

## Likely version: v5.0 [INF]

The evidence points to v5.0:
- eduXchange docs and tech-docs.eduxchange.eu reference v5.
- The eduXchange profile uses v5 naming.
- The gateway treats a plain JSON request as v5.
- The oeapi-endpoint-quickstart starter kit implements v5.

v6 is unsettled. A `v6.0` tag exists (January 2026), but `main` publishes 6.0-rc.3 and the CHANGELOG already lists 6.1-RC.1. Only RIO has a v6 profile. v6 renames v5 fields: `consumers` becomes `consumer`, `organization` becomes `organisation`, `teachingLanguage` becomes `teachingLanguages[]`, `startDate` becomes `startDateTime`.

## v5.0 shapes to expect (from spec) [DOC]

- **Service document (`GET /`):** `contactEmail`, `specification`, `documentation`.
- **Pagination:** parameters `pageSize` and `pageNumber`. The envelope has `pageSize, pageNumber, hasPreviousPage, hasNextPage, items`, with `totalPages` optional.
- **`/courses` filters:** `consumer, search, teachingLanguage, level, modeOfDelivery, sort, primaryCode`.
- **Course:** the required set above plus `modeOfDelivery, duration, learningOutcomes, admissionRequirements, assessment, fieldsOfStudy, coordinators, organization, link, otherCodes, ext`.
- **Offering:** the required set above plus `modeOfDelivery, enrollStartDate, enrollEndDate, academicSession, course, maxNumberStudents, priceInformation, addresses, link, ext`.
- **Languages:** `teachingLanguage` is an ISO 639-2 three-letter code. `name` and `description` are `{language, value}` arrays with RFC 3066 tags such as `en-GB`.
- **Security:** the spec declares bearer and OpenID Connect schemes but does not require either globally.

## Implications for the OECP harvester

- **Plan for credentials, not anonymous pulls.** No partner endpoint is public. Two possible access paths:
  - **(a) SURFeduhub client (recommended to explore first).** The OECP registers as a consumer application: one Basic-auth credential, `X-Route` to address the four partners, and per-institution authorisation in the SURFeduhub registry. SURF already holds the partner-side credentials under the pilot agreements.
  - **(b) Direct access to each partner.** Four separate credential sets, each with its own scheme (Basic, OAuth2 or custom header), and four network allow-lists.
- **Target v5.0 explicitly** with `Accept: application/json`. Keep field mapping behind a version adapter so v6 renames can be added later.
- **Filter with `consumer=eduxchange`.** That is where partners expose their tagged Aurora courses. Do not depend on `alliances.name=aurora` until "aurora" is added to the profile. Reusing data flagged "for eduXchange" needs partner and SURF consent; add it to the access agreement.
- **Pagination:** loop on `pageNumber` until `hasNextPage=false`; do not depend on `totalPages`. The harvest order is:
  1. `/organizations?organizationType=root`
  2. `/courses?consumer=eduxchange`
  3. `/courses/{id}/offerings`
  4. `/offerings/{id}?expand=academicSession`
- **Normalise languages.** ISO 639-2 has bibliographic and terminology variants: `ger`/`deu`, `ice`/`isl`, `dut`/`nld`. Map both to one canonical form, and keep the BCP 47 tags on text values.
- **Expect sparse data at first.** The Aurora catalogue is not live yet. Confirm with Aurora T6.1 and SURF which partners are actually connected before scheduling harvests.

## Key sources

- GitHub: open-education-api/specification, open-education-api/documentation, open-education-api/profiles, SURFnet/eduhub-gateway
- tech-docs.eduxchange.eu; SURF knowledge base "Step 3. Connect your OOAPI endpoint to SURFeduhub" (login required; seen as a search snippet)
- J. Goosen (SURF), "A Federated Approach to Course Data", GÉANT TNC26, June 2026
- Aurora D6.1 "Aurora IT Handbook" (aurora-universities.eu, June 2026)
