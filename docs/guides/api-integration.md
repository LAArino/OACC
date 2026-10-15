<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# API integration: exposing an OEAPI v5 endpoint to OECP

For partner IT teams. OECP **pulls** course data from your Open Education API (OEAPI, formerly OOAPI) **v5.0** endpoint on a schedule (Channel A, spec §6.2); it never receives pushes. This guide states what OECP requests (as built in release 0.5.0, spec v4.1), how it maps your data and how to read the outcome. Getting an administrator account, agreeing to the data reuse and choosing this channel are covered in the onboarding guide [B. Partner with an OEAPI endpoint](../onboarding/partner-with-oeapi.md). Common data rules: [guides README](README.md#common-data-quality-rules).

> **Status.** The harvester is verified only against the bundled mock partner (`tools/oeapi-mock`); no real partner endpoint has been harvested yet. Integration settings are entered on the **Integration settings** page of the admin console (settings form, host approval, "Test connection", "Sync now"; walkthrough in [Guide B, steps 5–8](../onboarding/partner-with-oeapi.md#5-enter-the-integration-settings)); the admin API calls below do the same for scripting.

## What OECP requests

All requests are `GET`, OEAPI **v5.0** only, with these headers:

| Header | Value |
|---|---|
| `Accept` | `application/json` |
| `User-Agent` | `OECP-harvester/1 (+https://joinup.ec.europa.eu/licence/eupl)` |
| `Authorization` or your API-key header | per `auth_scheme` (below) |
| `X-Route` | `endpoint={surfeduhub_endpoint_id}`, SURFeduhub access mode only |

Every request carries the query parameter **`consumer={consumer_profile}`** (default `eduxchange`; letters, digits, `.`, `_`, `-`, at most 64 characters), also re-added after a redirect that drops it. OECP sends no `alliances.name` filter. Paths are appended to `base_url`, which may carry a path prefix. With `base_url` `https://oeapi.example.edu/v5`, `page_size` 100 and a run on 2026-10-14, one run sends, in this order:

| # | Request | Repeats |
|---|---|---|
| 1 | `GET https://oeapi.example.edu/v5/organizations?organizationType=root&pageSize=100&pageNumber=1&consumer=eduxchange` | every page, until `hasNextPage` is `false` |
| 2 | `GET https://oeapi.example.edu/v5/courses?pageSize=100&pageNumber=1&consumer=eduxchange` | page by page; each page's courses are processed before the next page is requested |
| 3 | `GET https://oeapi.example.edu/v5/courses/{courseId}/offerings?since=2025-10-14&pageSize=100&pageNumber=1&consumer=eduxchange` | after each course item, every page (also for a rejected course, whose offerings are then rejected) |
| 4 | `GET https://oeapi.example.edu/v5/offerings/{offeringId}?expand=academicSession&consumer=eduxchange` | each offering of an accepted course; on failure the listing item is used |

- **`since`** = run date (UTC) minus 365 days. OECP asks only for offerings starting on or after it; offerings that start earlier are never counted as absent.
- **Paging:** `pageSize` = the integration's `page_size` (10–250, default 100), `pageNumber` from 1. The envelope must have `pageSize`, `pageNumber`, `hasPreviousPage`, `hasNextPage` and `items`; `totalPages` is ignored. Listing stops at 1,000 pages with the warning `oecp.oeapi.page_cap_reached`: the items read are processed and the run counts as incomplete (no absence is counted). A `courseId` repeated across pages is skipped silently.
- `courseId` and `offeringId` are URL-encoded into the path. OECP does not call `/academic-sessions`, `/courses/{courseId}` or any other path.
- **Pace:** a token bucket at `max_requests_per_second` (default 2) holding at most max(1, rate) tokens, so there are no larger bursts.
- **Timeouts and retries:** 30 s per request, body included; 429, 5xx, timeouts and connection errors (not DNS failures) are retried up to 5 times (exponential backoff from 1 s, capped at 60 s, with jitter; `Retry-After` in seconds or as an HTTP date is honoured up to 300 s). 401 and 403 are never retried; other 4xx are not retried. Bodies over 20 MB are refused. A run is stopped after 2 hours.

"Test connection" sends only `GET {base_url}/?consumer=…` (the service document) and `GET {base_url}/courses?pageSize=1&pageNumber=1&consumer=…`, within 90 s.

## Authentication and credential storage

| `auth_scheme` | Sent as | `secret` value to store |
|---|---|---|
| `none` | nothing | none (sending one is `oecp.integration.secret_not_expected`) |
| `basic` | `Authorization: Basic base64(username:password)` | `username:password` (must contain `:`) |
| `bearer` | `Authorization: Bearer <token>` | the token |
| `api_key_header` | `<api_key_header_name>: <value>` | the header value; `api_key_header_name` is required (`[A-Za-z0-9-]{1,64}`) |

The credential is **write-only**. It is encrypted with AES-256-GCM (12-byte nonce, additional data bound to the row id, purpose and key version) into the `secrets` table, and only a reference `db:<uuid>` is kept on the integration. No API response, log line or audit row contains it: responses expose `secret_configured: true|false`, the audit records only `set`, `replaced` or `deleted`. In a `PUT`, omitting `secret` keeps the stored one, `null` deletes it, a string replaces it; switching to `auth_scheme` `none` deletes it. Long-lived tokens are expected: OECP has no OAuth client-credentials flow.

**SURFeduhub mode** (`access_mode` `surfeduhub`, fallback): requests go to the deployment's `SURFEDUHUB_GATEWAY_URL` with `X-Route: endpoint={surfeduhub_endpoint_id}` and the alliance's own Basic credential; your endpoint stores no OECP credential. Unavailable unless the deployment sets `SURFEDUHUB_SECRET_REF` (`oecp.integration.surfeduhub_unavailable`).

## Network requirements

- **https on port 443** only: `base_url` must be `https://` without a port other than 443, without user info, query or fragment. (`http`, other ports and private addresses are accepted only when the deployment sets the development switch `OECP_ALLOW_INSECURE_PARTNER_HTTP=true`.)
- **Host approval:** an `alliance_admin` approves the exact host (`host[:port]`) of `base_url` (*Approve host* on the *Integration settings* page, or `POST …/integration/approve-host`). Changing the host clears the approval; changing only the path keeps it. Until approved, nothing is requested (`oecp.oeapi.host_not_approved`).
- **Public DNS:** every A/AAAA record of your host must be a public unicast address. Loopback, RFC 1918, CGNAT, ULA, link-local, multicast, documentation and reserved ranges (also embedded in IPv4-mapped, NAT64 or 6to4 addresses) make the run fail with `oecp.oeapi.address_refused`. The connection is pinned to the checked address; the certificate is verified against your host name.
- **Redirects:** at most 3, and only to the same scheme and host. A redirect to another host (for example a gateway or a login page) is refused (`oecp.oeapi.redirect_refused`).
- **IP allowlist:** requests come from the OECP worker's egress address. OECP does not publish a fixed address list in 0.7.0; ask the alliance's hosting operator for the address to allowlist.

## Integration settings

Set on the *Integration settings* page (`partner_admin` of the organization or `alliance_admin`), which validates every field before saving and sends `PUT /api/admin/v1/organizations/{orgId}/integration`; the page's "Test connection" and "Sync now" use the saved settings. The credential is write-only: the page shows only whether one is stored and lets you keep, replace or delete it. For scripting, the body of the `PUT` is the **full document**: an omitted member takes its default, not its current value (except `secret`). Every change is audited with from/to values.

```sh
API=https://portal.example.org/api/admin/v1
curl -sS -X PUT "$API/organizations/$ORG/integration" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"authoritative_channel":"oeapi","access_mode":"direct",
       "consumer_profile":"eduxchange","base_url":"https://oeapi.example.edu/v5",
       "auth_scheme":"basic","secret":"oecp-harvester:REPLACE-ME",
       "schedule_cron":"0 3 * * *","schedule_timezone":"Europe/Brussels",
       "page_size":100,"max_requests_per_second":2,
       "withdraw_after_absences":3,"enabled":true}'
curl -sS -X POST "$API/organizations/$ORG/integration/approve-host" -H "Authorization: Bearer $TOKEN"  # alliance_admin
```

Defaults: `authoritative_channel` `form`, `access_mode` null (required for `oeapi`), `oeapi_version` `"5"` (only value), `consumer_profile` `eduxchange`, `auth_scheme` `none`, `schedule_cron` `0 3 * * *` (five fields), `schedule_timezone` `Europe/Brussels`, `page_size` 100 (10–250), `max_requests_per_second` 2 (> 0, ≤ 999.9), `withdraw_after_absences` 3 (1–30), `enabled` false (only allowed with `oeapi`). A partner is scheduled only when `enabled`, `oeapi`-authoritative and without blocker (access mode, endpoint id, https:443, approved host); schedules are refreshed every 15 minutes.

## Mapping OEAPI v5 to OECP

Implemented in `apps/api/src/ingestion/oeapi/oeapi-v5.adapter.ts`. "Required" means the entity is rejected without it. Unknown members are kept in the stored raw payload and otherwise ignored, except person data: every `coordinators` and `persons` member, and every member of an `ext` object whose name contains "person", is removed before the payload is stored (spec §5.2).

**Root organization** (`organizationId`, `organizationType`, `name[]` required): the first item with `organizationType: "root"` is **matched**, never created or updated. If the alliance has recorded your organization's `ext_id`, the root's `primaryCode.code` or `organizationId` must equal it. With several roots the first is used and the run records the warning `oecp.oeapi.multiple_roots`.

**Course**

| OEAPI v5 | Req. | OECP | Rule |
|---|---|---|---|
| `courseId` | yes | `source_ref` | ≤ 200; used for request 3 |
| `primaryCode.code` | yes | course code (`ext_id`) | trimmed, ≤ 200, unique in the run; the key OECP matches on |
| `name[]` | yes | `texts.<lang>.title` | ≥ 1 entry; the first entry per language wins (`en-GB` listed before `en-US` is kept); cut to 500 |
| `abstract[]`, `description[]`, `admissionRequirements[]`, `assessment[]` | no | `abstract`, `description`, `prerequisites`, `assessment` | only in languages that have a `name` |
| `learningOutcomes[][]` | no | `learning_outcomes` | one array per outcome; a language's outcomes joined by a blank line |
| `studyLoad` | yes | `ects` | `studyLoadUnit` `ects`, 0 < `value` ≤ 120, rounded to 2 decimals |
| `fieldsOfStudy` | no | ISCED codes | split on spaces, `,`, `;`, `\|`; 2–6 digits with a known broad field; first valid is primary; a token that is not 2–6 digits is ignored with `oecp.oeapi.invalid_isced`, one with an unknown broad field with `oecp.oeapi.unknown_isced_field` |
| `level` | no | `levels`, `level`, `eqf_level` | table below |
| `link` | no | `info_url` | https only, ≤ 2,048 |
| `coordinators[]` | no | `instructors` | only persons already **expanded** in the course item, with `displayName`, else `givenName` (+ `surnamePrefix`) + `surname` (`surName` accepted); bare `personId`s are ignored; trimmed, repeats dropped, ≤ 200 characters each and ≤ 50 entries (cut with `oecp.oeapi.value_truncated`); not an array: warning `oecp.oeapi.invalid_coordinators`, course kept; the person objects are not kept in the raw payload |
| `ext.oecp.instructors` | no | `instructors` | OECP extension, `[string]`; used only when no coordinator has a name; same limits |
| `ext.oecp.texts.{modeOfRepetition, methods, literature, privacyNotice, remarks}` | no | `mode_of_repetition`, `methods`, `literature`, `privacy_notice`, `remarks` | OECP extension; each member `[{language, value}]` or `{"en": "…"}`; only in languages that have a `name`; ≤ 20,000 per language |
| `teachingLanguage`, `modeOfDelivery[]` | no | — | fallback for offerings without their own |
| — | | `status` | `published` with an English `name`, else `draft` with the warning `oecp.oeapi.english_missing` |
| — | | `contact_email` | the organization's contact address |

**Offering**

| OEAPI v5 | Req. | OECP | Rule |
|---|---|---|---|
| `offeringId` | yes | `source_ref` | used for request 4 |
| `primaryCode.code` | no | offering code | else `offeringId`; ≤ 200, unique per course in the run |
| `startDate`, `endDate` | yes | `start_date`, `end_date` | `YYYY-MM-DD`, end ≥ start |
| `enrollStartDate`, `enrollEndDate` | no | `enrol_start_date`, `application_deadline` | deadline ≤ end date; start ≤ deadline |
| `teachingLanguage` | yes, here or on the course | `teaching_languages` (one value) | normalised (below) |
| `modeOfDelivery[]` | yes, here or on the course | delivery modes | table below; at least one must map |
| `maxNumberStudents` | no | `max_students` | must be > 0 |
| `enrolledNumberStudents`, `pendingNumberStudents` | no | `seats_available` | max(0, max − enrolled − pending), only with max > 0 and enrolled present; `seats_updated_at` = run start |
| `link` | no | `application_url` | https only |
| `academicSession` (expanded) | no | academic session | below |
| `ext.oecp.applicationInstructions` | no | `application_instructions` | `[{language, value}]` or `{"en": "…"}`; ≤ 20,000 per language |
| — | | `status`, `timezone` | `published`; the organization's default time zone |

**Academic session:** `academicSessionId` becomes its key; `academicSessionType` `academic year`, `semester`, `trimester`, `quarter`, `testing period`, `period` map one-to-one, anything else becomes `period`; `name[]` (English copied from the first language if missing); `startDate`, `endDate`; `parent` is linked only if OECP already knows that session. An unexpanded id links only to a session OECP already has. An expanded session that is invalid, or an id OECP does not know, leaves the offering without a session, with the warning `oecp.content.session_ignored`.

| `level` (case-insensitive) | `levels` | EQF |
|---|---|---|
| `associate degree` | `short_cycle` | 5 |
| `bachelor` / `master` / `doctoral` | same | 6 / 7 / 8 |
| any other value (`undefined`, `undivided`, `secondary vocational education…`, `nt2-1`…) | `other` | none |
| absent | none | none |

| `modeOfDelivery` (lower-cased; `-`, `_` read as spaces) | OECP code |
|---|---|
| `online`, `distance-learning` | `online` |
| `on campus`, `situated` | `presential` |
| `hybrid` | `hybrid` |
| anything else | not mapped: warning `oecp.oeapi.delivery_mode_dropped`; if nothing on the offering or its course maps, the offering is rejected (`oecp.oeapi.unmappable_delivery_mode`) |

**Languages.** The primary subtag is taken (`en-GB` → `en`); ISO 639-2 B and T codes become ISO 639-1 where one exists (`ger`/`deu` → `de`, `fre`/`fra` → `fr`, `dut`/`nld` → `nl`, `cze`/`ces` → `cs`, `ice`/`isl` → `is`, `cat` → `ca`, …); unlisted three-letter codes stay as they are; `mul`, `und`, `zxx`, `mis` are dropped; anything that is not 2–3 letters is invalid.

### What is not read

- **Person data:** OECP never asks for `expand=coordinators`, never calls `/persons` and never looks anyone up. From `coordinators` it keeps only the **names** of persons your endpoint already returns expanded in the course item (decision 21a): no e-mail, phone, affiliation or identifier, and the person objects are removed from the raw payload before it is stored. Those names are republished on the public course page as the course's instructors, so return only names your university already publishes for the course; role descriptions ("Course team, Faculty of Law") work too, through `ext.oecp.instructors`.
- **Alliance data:** OEAPI v5 has no course kind or alliance attributes. Every harvested course gets `kind` `course` and no attributes, even if you send `ext.oecp.kind` or `ext.oecp.attributes`; administrators add them as overrides, which survive harvests. The extensions read are the course's `ext.oecp.instructors` and `ext.oecp.texts` and the offering's `ext.oecp.applicationInstructions`; they have the shape the OECP read API (`/oeapi/v5`) emits under `ext.oecp`, so an OECP catalogue can be harvested without loss of these fields.
- `consumers` (including eduXchange `enrollmentUrl`, `theme`, `selection`), offering `name`, `description`, `offeringType`, `resultExpected`, `minNumberStudents`, course `abbreviation`, `duration`, `qualificationRequirements`, `validFrom`, `validTo`, `otherCodes`, `addresses`.
- Not set by the harvester: teaching hours, campus, alliance seats, teaching unit.

## Handbook completeness

The Aurora IT Handbook shows a course only when every obligatory field is present (decision 21c; spec §6.1). After a course's offerings have been harvested, OECP checks each course it stores as `published` (the courses with an English `name`) on the effective values, overrides included:

| Obligatory | Comes from |
|---|---|
| English title, description, learning outcomes, prerequisites, assessment | `name`, `description`, `learningOutcomes`, `admissionRequirements`, `assessment` in `en` |
| ECTS, study cycle | `studyLoad`, `level` |
| Contact | the organization's contact address (not harvested) |
| At least one instructor | named `coordinators` or `ext.oecp.instructors` (above) |
| A published offering with start and end dates, application start and deadline, a teaching language and a delivery mode | `startDate`, `endDate`, `enrollStartDate`, `enrollEndDate`, `teachingLanguage`, `modeOfDelivery` |

A course that misses any of them gets the warning `oecp.content.handbook_incomplete` (for example `MATH-101: Course is missing fields the Aurora IT Handbook requires to publish: instructors, offerings.enrol_start_date`). The deployment's `OECP_PUBLISH_RULE` decides the effect: `warn` (default, transition period) publishes it anyway; `enforce` stores it as `draft` until a later harvest finds it complete. The rule never rejects a course and never changes the run status. The run detail (`GET /sync-runs/{id}`) adds `handbook_incomplete`, the courses of the run with the warning; the course list of the admin console has a *Completeness* column.

Because OECP never expands `coordinators`, most endpoints will give no instructors and every course will carry this warning. Either return `coordinators` expanded with names in the course listing, or add `ext.oecp.instructors` (a list of names or role descriptions), or ask your administrator to set an `instructors` override in the web form. The optional handbook texts (mode of repetition, methods, literature, privacy notice, remarks) have no OEAPI v5 member; send them as `ext.oecp.texts` if you want them shown:

```json
"ext": { "oecp": {
  "instructors": ["Anna Jónsdóttir", "Course team, Faculty of Education"],
  "texts": {
    "modeOfRepetition": [{"language": "en", "value": "Every winter semester."}],
    "methods": [{"language": "en", "value": "Lectures and group projects."}],
    "remarks": {"en": "Taught online."}
  } } }
```

## Warning and rejection codes

Every `oecp.oeapi.*` code of `packages/schemas/errors.json`, plus the `oecp.content.*` codes and `oecp.internal` a harvest can record. **Sev.** is the catalogue's severity, the same in every channel (spec §6.6): where the harvester is more lenient than CSV or the form it uses a code of its own (for example `oecp.oeapi.english_missing`, a warning, next to `oecp.content.english_missing`, an error of the other channels). **Effect:** **run** = the run stops (status `failed`, or `partial` if something was already processed); **listing** = the listing is incomplete, nothing is withdrawn; **entity** = that course or offering is rejected (counted in `n_rejected`) and the rest continues; **—** = recorded only. A transport failure stops the run on the root listing or before any course was processed, makes the listing incomplete later, and on request 4 becomes `oecp.oeapi.detail_unavailable`.

| Code | Sev. | Effect | Cause | Fix |
|---|---|---|---|---|
| `oecp.oeapi.unauthorized` | E | run | HTTP 401 or 403 | Check scheme, credential and that it is valid for this `consumer` |
| `oecp.oeapi.unreachable` | E | run | DNS failure, no address, connection error after retries | DNS, firewall, allowlist OECP's egress address |
| `oecp.oeapi.host_not_approved` | E | run | `base_url` host not (or no longer) approved | Ask an `alliance_admin` to approve the host |
| `oecp.oeapi.address_refused` | E | run | a DNS record is not public unicast | Publish only public A/AAAA records |
| `oecp.oeapi.insecure_url` | E | run | not https on port 443 | Serve https on 443 |
| `oecp.oeapi.run_timeout` | E | run | run longer than 2 h (or worker stopped) | Faster responses, larger `page_size`, higher `max_requests_per_second` if you allow it |
| `oecp.oeapi.secret_unavailable` | E | run | credential missing or undecryptable, Basic without `:`, characters not allowed in an HTTP header | Store the credential again with `PUT …/integration` |
| `oecp.oeapi.root_not_matched` | E | run | no root returned, or its code differs from the organization's `ext_id` | Support `organizationType=root`; agree the root code with the alliance |
| `oecp.oeapi.http_error` | E | run or listing | other status (404, 400, 406…), or 429/5xx after 5 retries | Support each request as listed above |
| `oecp.oeapi.timeout` | E | run or listing | no response within 30 s after retries | Faster responses or smaller pages |
| `oecp.oeapi.redirect_refused` | E | run or listing | redirect to another host or scheme, more than 3 hops, bad `Location` | Answer at `base_url` itself |
| `oecp.oeapi.body_too_large` | E | run or listing | response over 20 MB | Lower `page_size` |
| `oecp.oeapi.invalid_payload` | E | run, listing or entity | response not JSON or not a v5 page envelope; or an item lacks a required member or has the wrong type (pointer given) | Follow the v5 schema |
| `oecp.oeapi.listing_failed` | E | listing | an offering listing failed; the message carries the cause | Fix that cause; no absence is counted for the run |
| `oecp.oeapi.page_cap_reached` | W | listing | more than 1,000 pages; the items read are processed | Raise `page_size`; make `hasNextPage` false on the last page |
| `oecp.oeapi.empty_listing` | W | listing | `/courses` returned no items | Check the `consumer` filter (are courses tagged for it?) |
| `oecp.oeapi.missing_primary_code` | E | entity | course without `primaryCode.code` | Send `primaryCode` |
| `oecp.oeapi.study_load_unit` | E | entity | `studyLoad` missing, unit not `ects`, value ≤ 0 or > 120 | Send ECTS |
| `oecp.oeapi.unmappable_delivery_mode` | E | entity | no mappable `modeOfDelivery` on offering or course | Use v5 values |
| `oecp.oeapi.missing_teaching_language` | E | entity | no usable `teachingLanguage` on offering or course (`mul`, `und`, missing, invalid) | Send a real language code |
| `oecp.oeapi.parent_rejected` | E | entity | offering of a rejected course (no detail requested) | Fix the course |
| `oecp.oeapi.write_failed` | E | entity | the database refused the record | Report to the alliance operator with the run id |
| `oecp.oeapi.mass_absence` | W | — | ≥ 30% of published courses missing; no absence counted | Restore the courses, or have them withdrawn in OECP by status override |
| `oecp.oeapi.multiple_roots` | W | — | more than one root organization returned; the first is used | Return only your own root for `organizationType=root` |
| `oecp.oeapi.duplicate_entity` | W | — | course `primaryCode.code` repeated in the run, or offering code repeated within a course; the first item is processed, the repeat is ignored (not written, not counted as rejected) | Make codes unique |
| `oecp.oeapi.detail_unavailable` | W | — | request 4 failed (cause in the message); listing item used | Support `GET /offerings/{id}?expand=academicSession` |
| `oecp.oeapi.english_missing` | W | — | no English `name`; the course is stored as `draft` (not public) | Add `en` to `name` |
| `oecp.oeapi.invalid_isced` | W | — | `fieldsOfStudy` token not 2–6 digits; ignored | Send ISCED-F 2013 codes |
| `oecp.oeapi.unknown_isced_field` | W | — | `fieldsOfStudy` code whose first two digits are not an ISCED-F broad field; ignored | Use ISCED-F 2013 |
| `oecp.oeapi.delivery_mode_dropped` | W | — | some `modeOfDelivery` values have no mapping and are ignored (at least one maps) | Use v5 values |
| `oecp.oeapi.language_dropped` | W | — | `mul`, `und`, `zxx` or `mis` | Use real language codes |
| `oecp.oeapi.invalid_language` | W | — | language not 2–3 letters | Use ISO 639 / BCP 47 |
| `oecp.oeapi.insecure_link` | W | — | `link` not an https URL; dropped | Use https links |
| `oecp.oeapi.text_without_title` | W | — | a text in a language without a `name` in it; ignored | Add the `name` in that language |
| `oecp.oeapi.value_truncated` | W | — | title > 500, instructions or handbook texts > 20,000 characters, an instructor name > 200 characters or more than 50 instructors | Shorten |
| `oecp.oeapi.invalid_student_counts` | W | — | `maxNumberStudents` 0; seats ignored | Omit it when there is no limit |
| `oecp.oeapi.invalid_coordinators` | W | — | `coordinators` is not an array; ignored, course kept | Send an array of `Person` objects (or ids) |
| `oecp.oeapi.invalid_extension` | W | — | `ext.oecp.applicationInstructions`, `ext.oecp.texts` (or one of its members) or `ext.oecp.instructors` of another shape; ignored | Use `[{language, value}]` (texts, instructions) or `[string]` (instructors) |
| `oecp.content.session_ignored` | W | — | expanded academic session invalid, or an id OECP does not know; offering stored without it | Support `expand=academicSession` |
| `oecp.content.handbook_incomplete` | W | — | a course stored as `published` misses fields the Aurora IT Handbook requires; the message lists them. In `enforce` mode the course is stored as `draft` | See [Handbook completeness](#handbook-completeness) |
| `oecp.content.date_order` | E | entity | end before start, deadline after end, enrolment start after deadline | Fix the dates |
| `oecp.content.invalid_value` | E | entity | code longer than 200, or another canonical rule | Per message and pointer |
| `oecp.internal` | E | run | unexpected server error | Report with the run id |

Setup errors (HTTP problem+json, `errors[0].code`): `oecp.integration.not_configured` (404 before the first `PUT`); `access_mode_required`, `base_url_required`, `endpoint_id_required`, `header_name_required`, `basic_secret_format`, `secret_required`, `secret_not_expected` (400 on `PUT`, and `secret_required` 422 when no credential is stored; the first three also 409 on test and sync, `base_url_required` 409 on approve-host); `oecp.sync.channel_disabled` (400 on `PUT` with `enabled: true` and another channel); `oecp.integration.insecure_url` and `surfeduhub_unavailable` (422 on `PUT`, 409 on test and sync); `oecp.oeapi.host_not_approved` (409 on test and sync); `oecp.sync.channel_disabled`, `oecp.sync.already_running` (409) and `oecp.sync.rate_limited` (429 with `Retry-After`) on "Sync now"; `oecp.secrets.unavailable` (503 on a `PUT` with a new credential and on test, when the deployment's master key is missing or invalid: an operator problem, nothing is written).

## Run statuses and completeness

| Status | Meaning |
|---|---|
| `queued` | "Sync now" accepted, waiting for the worker |
| `running` | in progress; one run per organization at a time (a `running` row older than 2 h 10 min is marked `failed` when the next run starts) |
| `succeeded` | complete, no rejection |
| `partial` | something was rejected, or the run was incomplete or stopped after processing began |
| `failed` | stopped before anything was processed |
| `cancelled` | a queued run that could not start (another run in progress, channel no longer `oeapi`) |

A run is **complete** when every listing page answered 2xx, nothing stopped the run and at least one course came back. Counters: `n_created` (a deleted record that comes back counts here, [below](#deleted-records-come-back)), `n_updated`, `n_unchanged`, `n_rejected` (courses and offerings together; a code repeated in the run is ignored with a warning, not counted), `n_withdrawn`. An unchanged payload (same SHA-256 of its canonical form) only refreshes `last_seen_at`.

## Withdrawal by absence

OEAPI has no "withdrawn" state, so OECP withdraws what disappears from your listings (spec §6.2.5, ADR-0015):

1. Only **complete** runs count absences. Failed, partial-because-incomplete and empty runs never withdraw.
2. **Mass-absence guard:** if 30% or more of the organization's `published` courses are missing from the run, nothing is counted (`oecp.oeapi.mass_absence`).
3. Otherwise every `draft` or `published` course not seen, and every such offering not seen whose start date is on or after `since`, gets `absent_count + 1`. At `withdraw_after_absences` (default 3) it becomes `withdrawn`, audited as `system:harvester` with reason `absence`, unless an administrator has set a `status` override.
4. A seen entity, even a rejected one, resets `absent_count`. A withdrawn entity that comes back valid is republished (audit reason `seen_again`); a rejected one stays withdrawn until a valid payload arrives.

To retire a course: remove it from the listing for your `consumer` and let three complete runs pass, or ask your OECP administrator to withdraw it immediately with a status action. A status override set that way wins over every harvest until the administrator removes it ("Revert status to the partner's value", [web form guide](web-form.md#overrides-mode-harvested-organizations)).

### Deleted records come back

Harvested records cannot be deleted in OECP, but records written while your organization used CSV or the web form may have been. When a harvest returns the code of such a deleted course or offering, the record **comes back**, as in every channel: it is written as new from your payload (counted in `n_created`), overrides left on it are dropped and the audit log records `course.revive` or `course_offering.revive`. Deleted records are purged for good after 12 months; after that the code simply creates a new record.

## Testing

In the console: **Test connection** and **Sync now** under *Test and run* on the *Integration settings* page, then **Sync history**. The API equivalents:

```sh
curl -sS -X POST "$API/organizations/$ORG/integration/test-connection" -H "Authorization: Bearer $TOKEN"
curl -sS -X POST "$API/organizations/$ORG/integration/sync-now" -H "Authorization: Bearer $TOKEN"
curl -sS "$API/organizations/$ORG/sync-runs?limit=5" -H "Authorization: Bearer $TOKEN"
curl -sS "$API/sync-runs/$RUN?severity=error&page=1&page_size=100" -H "Authorization: Bearer $TOKEN"
```

- **Test connection** returns 200 with `{ok, target, duration_ms, service, first_course_primary_code, courses_available, error}`; a remote failure is `ok: false` with `error.code`. A blocker (no access mode, unapproved host…) is 409.
- **Sync now** (202 `{sync_run_id, status: "queued"}`) works even with `enabled: false`, needs channel `oeapi` and no blocker, refuses while a run is queued or running (409), and is limited to once per 15 minutes per organization (429, `Retry-After` in seconds).
- **Sync runs:** the list returns at most 100 runs (default 20); the run page returns its errors paged (`page_size` ≤ 500) with `code`, `severity`, `message`, `ext_id` and `json_pointer` into your payload. The admin console shows the same under **Sync history** (`/{locale}/admin/sync-runs`, latest 50 runs).

## Comparing with the OECP mock partner

`tools/oeapi-mock` is a dependency-free Node 22 OEAPI v5.0 server with a synthetic University of Innsbruck slice (20 eduXchange-tagged courses, 33 of their offerings, deliberate edge cases); see its [README](../../tools/oeapi-mock/README.md).

```sh
node tools/oeapi-mock/server.mjs                     # http://127.0.0.1:8090, no auth
M=http://127.0.0.1:8090
curl -s "$M/organizations?organizationType=root&consumer=eduxchange&pageSize=100&pageNumber=1"
curl -s "$M/courses/d40cca47-99fc-5acb-ad1c-11778e6efc48/offerings?since=2025-10-14&consumer=eduxchange"
curl -s "$M/offerings/a026dc34-c3ba-5a96-87d6-3e4abec3429d?expand=academicSession&consumer=eduxchange"
```

Compare your responses with these, member by member. To see how OECP maps the mock, run the Compose stack with profile `dev` and `OECP_ALLOW_INSECURE_PARTNER_HTTP=true` for `api` and `worker` (development only), then configure the integration with `access_mode` `direct`, `base_url` `http://oeapi-mock:8090`, `auth_scheme` `basic`, `secret` `oecp:oecp-mock-secret`, approve the host and "Sync now" (spec Appendix D). Expect course `610200` as `draft` (`oecp.oeapi.english_missing`), warnings for `816010` (`insecure_link`) and `660010` (`invalid_isced`), and offering `620050-2027S` rejected (`missing_teaching_language`), so a `partial` run. `OEAPI_MOCK_DATASET=…/uibk-next-run.json` then removes two courses (under 30%) to exercise withdrawal.

`node tools/oeapi-mock/scripts/validate.mjs --base-url <url> --basic user:pass` (or `--bearer`) validates responses against the vendored v5.0 OpenAPI document with Ajv (installed from npm on first run). It also asserts counts specific to the mock dataset (one root, three sessions, `pageSize` capped at 100), so against your endpoint only its schema findings are meaningful.
