<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# OEAPI v5.0 mock partner

A simulated partner university that serves an **Open Education API v5.0**
endpoint with the **`eduxchange` consumer profile**, so the OACC harvester
(spec v4.1 §6.2) can be developed, tested and demonstrated without real
partner credentials. None of the four Aurora partners publishes an OEAPI URL
(`docs/research/partner-oeapi-endpoints.md`), so this is the only endpoint
available during development.

- `server.mjs`: a dependency-free HTTP server (Node 22, ES modules).
- `data/uibk.json`: a synthetic University of Innsbruck slice: 1 root
  organization, 3 academic sessions, 25 courses (20 tagged for eduXchange),
  40 offerings, with deliberate edge cases (below).
- `data/uibk-next-run.json`: the same partner one harvest later, with 2
  courses removed and 1 changed.
- `scripts/generate-dataset.mjs`: regenerates both datasets (deterministic,
  seed `20261014`, UUIDv5 identifiers; byte-identical on every run).
- `scripts/validate.mjs`: validates every response against the OEAPI v5.0
  OpenAPI document with Ajv and asserts the behaviour the harvester relies on.
- `scripts/smoke.sh`: curl test of every endpoint, pagination boundaries,
  auth modes, 429 and 503 injection.
- `spec/`: OEAPI v5.0 specification, bundled into one JSON file (third-party,
  BSD-3-Clause; see `spec/NOTICE`). Used only by `validate.mjs`.

All course content is invented. No person data is served (no
`coordinators`), and every course or offering link points to the reserved
`.example` domain (`lfuonline.uibk.example`), never to a real system.

## Run

```sh
# Plain Node 22, no install step
node tools/oeapi-mock/server.mjs
OEAPI_MOCK_AUTH=basic:oecp:oecp-mock-secret node tools/oeapi-mock/server.mjs

# Docker Compose, profile dev (deploy/compose/README.md)
cd deploy/compose
docker compose --profile dev up -d --build oeapi-mock
```

In Compose the service listens on `http://oeapi-mock:8090` inside the
`backend` and `edge` networks (reachable from `api` and `worker`) and is
published on `http://127.0.0.1:8090` for curl. There is no Traefik route.

| Where | Base URL | Credentials |
|---|---|---|
| api / worker containers | `http://oeapi-mock:8090` | HTTP Basic `oecp` / `oecp-mock-secret` |
| host (curl) | `http://127.0.0.1:8090` | same |
| `node server.mjs` | `http://127.0.0.1:8090` | none unless `OEAPI_MOCK_AUTH` is set |

### Pointing a partner integration at it

Configure the organization (spec §6.2.2) with `access_mode` `direct`,
`base_url` `http://oeapi-mock:8090`, `auth_scheme` `basic`, a secret holding
`oecp:oecp-mock-secret`, and `consumer_profile` `eduxchange`. The root
organization's `primaryCode` is `{codeType: "schacHome", code: "uibk.ac.at"}`
(organizationId `882af4ad-a946-5e47-966b-4e317eb21694`).

The production outbound rules of spec §6.2.6 (`https` on port 443 only;
loopback, private and other internal addresses refused) reject this URL on
purpose. The api and worker must run with the development-only switch
`OECP_ALLOW_INSECURE_PARTNER_HTTP=true` (in `apps/api/src/config/env.ts`,
default `false`; added together with the harvester), which admits plain
http, other ports and private addresses for partner endpoints. Never set it
in production.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8090` | listen port |
| `OEAPI_MOCK_DATASET` | `./data/uibk.json` next to `server.mjs` (`/app/data/uibk.json` in the image) | dataset file; a relative path resolves against the working directory |
| `OEAPI_MOCK_AUTH` | `none` | `none`, `basic:<user>:<pass>`, `bearer:<token>` or `apikey:<header>:<value>`. Missing or wrong credentials give `401` with `WWW-Authenticate` (`Basic realm=...`, `Bearer realm=...[, error="invalid_token"]`, or `ApiKey realm=..., header="<header>"`) |
| `OEAPI_MOCK_LATENCY_MS` | `0` | delay added to every response |
| `OEAPI_MOCK_FAIL_RATE` | `0` | probability (0 to 1) of a random `503` with `Retry-After: 1` |
| `OEAPI_MOCK_RATE_LIMIT_PER_SEC` | `0` (off) | requests per one-second window, then `429` with `Retry-After` |
| `OEAPI_MOCK_TODAY` | current UTC date | `YYYY-MM-DD` used as "today" for the default `since` (deterministic tests) |

Every request writes one line to stderr:
`<ISO time> <client> "<METHOD> <path?query>" <status> <bytes>B <ms>ms auth=<none|ok|missing|invalid|->`.
Credentials are never logged. The Compose healthcheck
(`healthcheck.mjs`, `GET /` with the configured credentials and the marker
header `X-OEAPI-Mock-Healthcheck: 1` from loopback) is exempt from rate
limiting and fault injection, not from authentication.

## Endpoints

All responses are `application/json`; errors are `application/problem+json`
v5 `Problem` objects (`{"status": "404", "title": "Not Found", "detail": ...}`;
the v5 schema types `status` as a string). Only `GET` and `HEAD`; other
methods give `405`. A request with `Accept: ...;version=6` gets `406` (the
mock serves v5 only). Unknown routes give `404`; malformed UUIDs in a path
give `400`.

| Request | Notes |
|---|---|
| `GET /` | service document: `contactEmail`, `specification`, `documentation` |
| `GET /organizations?organizationType=root` | 1 root organization; filters `organizationType`, `consumer`, `primaryCode`, `q` |
| `GET /organizations/{organizationId}` | `expand=parent,children` accepted |
| `GET /academic-sessions` | academic year 2026/27 and its two semesters, sorted by `startDate`; filters `academicSessionType`, `parent`, `year`, `primaryCode` |
| `GET /academic-sessions/{academicSessionId}` | `expand=parent,children,year` |
| `GET /courses` | filters `consumer`, `teachingLanguage`, `level`, `modeOfDelivery` (comma-separated or repeated), `q` (v5 name) or `search` (alias), `primaryCode`; `sort` (`name` default, `courseId`, `-` prefix) |
| `GET /courses/{courseId}` | `expand=organization` |
| `GET /courses/{courseId}/offerings` | `since`, `until`, `consumer`, `teachingLanguage`, `modeOfDelivery`, `resultExpected`, `q`; sorted by `startDate` |
| `GET /offerings/{offeringId}` | `expand=academicSession,course` (comma-separated) replaces the id references with the objects |

**Pagination** (every list): `pageSize` (default 10, values above 100 are
capped at 100), `pageNumber` (from 1). Envelope `{pageSize, pageNumber,
hasPreviousPage, hasNextPage, totalPages, items}`. A `pageNumber` past the
end returns `items: []` with `hasNextPage: false`. Non-integer or `< 1`
values give `400`.

**`consumer`**: `consumer=eduxchange` returns only entities whose `consumers`
contain `consumerKey: "eduxchange"` (20 of 25 courses; the 5 internal ones
are hidden, as are their 7 offerings). Any other value matches nothing.

**`since`** (v5): offerings whose `startDate >= since`; without `since` the
default is today, so only future offerings are listed. With
`OEAPI_MOCK_TODAY=2026-10-14` the default returns 22 of 40 offerings: the 18
winter-semester offerings started on 2026-10-05 and are hidden. The
harvester's `since={today - 365 days}` returns all 40. `until`: `endDate <=
until`.

**`teachingLanguage`** filter is an exact match: `ger` matches, `deu` does
not (the data uses the ISO 639-2/B codes).

### URLs (Compose, from the host)

```sh
M=http://127.0.0.1:8090; U='oecp:oecp-mock-secret'
curl -s -u $U $M/
curl -s -u $U "$M/organizations?organizationType=root&consumer=eduxchange"
curl -s -u $U "$M/courses?consumer=eduxchange&pageSize=10&pageNumber=1"
curl -s -u $U "$M/courses/d40cca47-99fc-5acb-ad1c-11778e6efc48?consumer=eduxchange"
curl -s -u $U "$M/courses/d40cca47-99fc-5acb-ad1c-11778e6efc48/offerings?consumer=eduxchange&since=2025-10-14"
curl -s -u $U "$M/offerings/a026dc34-c3ba-5a96-87d6-3e4abec3429d?expand=academicSession,course"
curl -s -u $U "$M/academic-sessions"
curl -s -u $U "$M/academic-sessions/d23e6cb4-c976-500f-967d-74db05e84e8d?expand=children"
```

## Dataset

Identifiers are stable UUIDv5 values, so they survive regeneration and are
shared between the two datasets.

| Entity | Code | Id |
|---|---|---|
| root organization | `uibk.ac.at` | `882af4ad-a946-5e47-966b-4e317eb21694` |
| academic year | `2026/27` (2026-10-01 to 2027-09-30) | `d23e6cb4-c976-500f-967d-74db05e84e8d` |
| winter semester | `2026W` (2026-10-01 to 2027-02-28) | `e64ac506-0ff8-54ee-bf43-df23d48f0854` |
| summer semester | `2027S` (2027-03-01 to 2027-09-30) | `28e85949-bcf7-56b7-8b04-2e0c195d8955` |

Shapes the harvester must handle everywhere:

- `name`, `description`, `admissionRequirements`, `assessment` are
  `{language, value}` arrays with `en-GB` and `de-DE`; `learningOutcomes` is an
  array of such arrays (one per outcome).
- `teachingLanguage` uses ISO 639-2 **bibliographic** codes (`eng`, `ger`;
  plus one `mul`) on purpose, so the `ger`/`deu` normalisation of §6.2.4 is
  exercised.
- `primaryCode` is `{codeType: "identifier", code: "<6-digit course number>"}`
  for courses and `{codeType: "offeringCode", code: "<course>-<2026W|2027S>"}`
  for offerings.
- `studyLoad` is `{studyLoadUnit: "ects", value}`; `level` is `bachelor` or
  `master`; `modeOfDelivery` is an array of v5 values (`on campus`, `online`,
  `hybrid`, `distance-learning`, `situated`); `fieldsOfStudy` is one ISCED-F
  2013 code as a 4-character string (the v5 type is a string, not an array).
- Course `consumers`: `[{consumerKey: "eduxchange", alliances: [{name:
  "aurora", theme, selection, type, visibleForOwnStudents}]}]`; offering
  `consumers` carry `alliances: [{name: "aurora", enrollmentUrl}]`. `aurora` is
  **not** in the eduXchange profile's alliance enum (`ewuu`, `lde`, `euroteq`,
  `kom`), matching today's reality (spec §6.2.3: OACC does not filter on it).
- Offerings reference `academicSession` and `course` by id unless expanded,
  and carry `offeringType: "course"`, `startDate`, `endDate`,
  `enrollStartDate`, `enrollEndDate`, `maxNumberStudents`,
  `enrolledNumberStudents`, `pendingNumberStudents`, `resultExpected`,
  `resultValueType`, `link` (the application URL), `modeOfDelivery`,
  `teachingLanguage`.

### Edge cases

| Kind | Code | Id | Case |
|---|---|---|---|
| course | `703015` | `d40cca47-99fc-5acb-ad1c-11778e6efc48` | ECTS 7.5 (non-integer study load) |
| course | `610200` | `4bd8395e-9711-5921-bf41-6e10bfcff9a8` | no English text at all: name, description, outcomes, admission and assessment in `de-DE` only (its offering too) |
| course | `620050` | `779a5a4c-787a-5e1d-b84f-237eb9e3ebac` | `teachingLanguage: "mul"`; two modes (`situated`, `on campus`) |
| course | `816010` | `29137c8a-bc1c-594d-8c86-37ed4d50e2b8` | course `link` uses `http://` (offering links stay https) |
| course | `660010` | `e84c7cb6-cd60-5419-b6e2-f7ca0807ac58` | `fieldsOfStudy: "ABCD"`, not an ISCED-F code |
| course | `300250` | `6cdb8667-f8f5-5828-bc7f-7bb0d54b4933` | eduXchange course with no offerings |
| offering | `401210-2027S` | `a026dc34-c3ba-5a96-87d6-3e4abec3429d` | `enrollEndDate` 2026-09-15 is in the past although the offering starts 2027-03-01 |
| offering | `703040-2026W` | `b1f82a69-3c85-5a4d-9cb8-9119c638e5ac` | `maxNumberStudents` without `enrolledNumberStudents` (no seat count) |
| offering | `703040-2027S` | `170d3fdf-7f30-5530-b7c9-1c625246b148` | offering `modeOfDelivery` `online` overrides the course's `hybrid` |
| offering | `401330-2027S` | `e33649d7-df55-53f2-87c7-34b60afe59da` | offering `teachingLanguage` `eng` overrides the course's `ger` |
| offerings | all `*-2026W` (18) | | started 2026-10-05: hidden by the v5 default `since`, visible with `since=2025-10-14`; their enrolment periods (September 2026) are past |
| course | `703900` | `596776c1-4505-5787-a6af-704c3f5c0ca4` | internal: no eduXchange consumer, absent with `consumer=eduxchange` |
| course | `300900` | `7cbf2af5-bc5a-5f64-9c86-bfc14b20d722` | internal (as above) |
| course | `201900` | `59062cbd-90b6-5ce9-81c3-7776a3e2c145` | internal (as above) |
| course | `401999` | `90745c0c-af04-5f5a-8bbe-7cd8dce8587f` | internal (as above) |
| course | `609999` | `cac25cf2-0247-5ab7-9fa8-7fe81771ebba` | internal (as above), no offerings |

The same list, with ids, is in `meta.edgeCases` of each dataset file. The
server ignores `meta`.

### Next run (`data/uibk-next-run.json`)

For withdrawal by absence (§6.2.5) and change detection:

| Change | Code | Id |
|---|---|---|
| course removed | `702110` | `6471e59d-1600-528e-8c43-6445847e68a0` |
| course removed | `432005` | `fdf862eb-ad68-5793-9e8d-445ee7cdd125` |
| offering removed | `702110-2026W` | `06c476cc-0254-5efd-b4c4-161f1a27653d` |
| offering removed | `702110-2027S` | `34a80cc4-cdc3-5b1a-aeeb-28c1539a0515` |
| offering removed | `432005-2027S` | `8c9626cd-b55e-553c-92d0-e7de2969d90d` |
| course changed | `703001` | `7b9a1078-053f-5679-ac55-eed64ec3317a`: `studyLoad.value` 5 to 6, new `description` (en-GB, de-DE) |

Everything else is byte-identical, so a correct harvester reports exactly
one changed course and everything else `unchanged`. Two missing courses out
of 20 published is 10%, under the 30% mass-absence threshold. Switch in
Compose with `OEAPI_MOCK_DATASET=/app/data/uibk-next-run.json` in `.env` and
`docker compose up -d oeapi-mock`; locally with
`OEAPI_MOCK_DATASET=tools/oeapi-mock/data/uibk-next-run.json`.

## Checks

```sh
node tools/oeapi-mock/scripts/generate-dataset.mjs            # regenerate data/*.json
node tools/oeapi-mock/scripts/validate.mjs                    # own server, baseline dataset
node tools/oeapi-mock/scripts/validate.mjs --dataset tools/oeapi-mock/data/uibk-next-run.json
node tools/oeapi-mock/scripts/validate.mjs --base-url http://127.0.0.1:8090 --basic oecp:oecp-mock-secret
sh tools/oeapi-mock/scripts/smoke.sh                          # curl suite, ports 18091-18097
sh tools/oeapi-mock/scripts/fetch-spec.sh --check             # vendored spec still matches tag v5.0
```

`validate.mjs` installs Ajv 8.20.0 and ajv-formats 3.0.1 (MIT) on first use
into `tools/oeapi-mock/.cache/validator` (git-ignored). It validates the
service document, organization, academic-session, course and offering-list
responses against the `200` response schemas of their v5 paths, problem
responses against `Problem`, and `GET /offerings/{id}?expand=...` against
`CourseOffering` directly: the v5 response schema for that path is `oneOf`
`CourseOffering`/`ComponentOffering`/`ProgramOffering`, and since
`CourseOffering` and `ProgramOffering` share all required fields a course
offering matches both and can never pass the `oneOf` (a spec defect the
script reports as a warning). It also checks the eduXchange profile's
required attributes (open-education-api/documentation,
`technical/consumers-and-profiles/eduxchange.md`).

## Upstream references

- Specification: open-education-api/specification, tag `v5.0`, commit
  `3d470c09f46b9f05f6bbf57a568297fdc9a280f1`, BSD-3-Clause at that tag
  (`spec/NOTICE`).
- eduXchange profile: open-education-api/documentation
  `documentation/technical/consumers-and-profiles/eduxchange.md` (commit
  `774ef5e8`, last update 26 June 2025) and open-education-api/profiles
  `eduxchange/profile/schemas` (commit `fe60dfcc`). Neither is vendored.
