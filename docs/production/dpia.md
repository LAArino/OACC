<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Data protection impact assessment (GDPR art. 35): OECP outline

Outline for the Aurora deployment of OECP, release 0.3.0. The controller (Aurora Foundation) carries out the DPIA and seeks the advice of its DPO (art. 35(2)); the processor (URV) assists (art. 28(3)(f)). The processing is described in the [RoPA](ropa.md); this document assesses its risks. Ratings below are **proposals by the maintainers** for the DPO to confirm or change.

| Item | Value |
|---|---|
| Version, date | `[TO COMPLETE]` |
| Assessor(s) | `[TO COMPLETE]` |
| DPO consulted | `[TO COMPLETE: name, date]` |
| Scope | Public catalogue, read API, administration panel, ingestion channels, identity (Keycloak), backups; Phase 2 wallet login excluded |

## 1. Screening: is a DPIA required?

Art. 35(1) requires a DPIA where processing is "likely to result in a high risk". The criteria of the EDPB-endorsed guidelines WP248 rev.01 and the list published by the competent supervisory authority under art. 35(4) `[TO COMPLETE: authority and list consulted]` apply. Criteria that touch OECP:

| Criterion | Applies? | Why |
|---|---|---|
| Vulnerable data subjects: employees (WP248) | Partly | Instructors and administrators are staff of the partners; they cannot easily object to what their employer sends |
| Large scale (WP248) | `[TO COMPLETE]` | Hundreds to a few thousand instructors across nine universities; the DPO judges the scale |
| Matching or combining datasets (WP248) | Partly | Course data from nine sources in three channels; administrator identities brokered from home-institution IdPs through eduGAIN |
| Innovative use of technology (WP248) | Not yet | Planned: wallet login (Phase 2, spec §4) and verifiable credentials; re-screen then |
| Publication to anyone (risk factor, not a WP248 criterion) | Yes | Instructor names published on the open web, through an anonymous API and a sitemap, so indexed by search engines and reusable by anyone |
| Cross-border processing (risk factor) | Yes | Controller, processor and data sources in nine EEA countries; several supervisory authorities concerned |

**Recommendation:** two WP248 criteria apply in part, together with public publication and cross-border processing, so a DPIA is **advisable** even if the controller concludes that it is not strictly required; it also documents the art. 25 choices and gives the partners a common basis. Controller's decision: `[TO COMPLETE: DPIA carried out / not required, with reasons]`.

## 2. Description of the processing

**Nature.** OECP collects course descriptions from partner universities and publishes them as one catalogue (spec §1). Personal data is incidental: instructor names and contact mailboxes attached to courses, and the identities and activity of the few staff who administer the catalogue. No student data.

**Architecture** (spec §3; [runbook](runbook.md)): Traefik (TLS, routing, rate limits) in front of the Nuxt portal, the NestJS `api` and Keycloak; a `worker` process for harvests and maintenance; PostgreSQL (databases `oecp`, `keycloak`), Valkey (queues), an `uploads` volume. All at URV.

**Data flows.**

1. *Harvest* (Channel A): the worker pulls OEAPI v5 documents from approved partner hosts over HTTPS with a per-partner credential (spec §6.2); the raw item, without its person objects (`coordinators`, `persons`, person members of `ext`), goes to `ext_metadata_history`, the mapped course to `courses` (instructors from expanded `coordinators` only, no person lookups).
2. *CSV upload and web form* (Channels B, C): a partner administrator sends files or form data through the admin API; files are kept 90 days.
3. *Publication*: published courses are served to anyone by the portal (`/`), `/api/public/v1` and `/oeapi/v5`.
4. *Administration*: an alliance administrator invites a person by e-mail; the person signs in through Keycloak, locally (password + TOTP) or through the home IdP (SAML via eduGAIN, then TOTP); the API checks the token and records activity and audit rows.
5. *Maintenance*: worker jobs delete old records, drop history partitions, revoke dormant administrators and refresh IdP metadata from a signed federation aggregate (spec §4, §10).

**Scope and context:** `[TO COMPLETE: number of partners, courses, instructors and administrators expected; reasonable expectations of staff, given that universities already publish instructors in their own catalogues]`.

## 3. Necessity and proportionality

| Question | Answer |
|---|---|
| Purpose specified and legitimate (art. 5(1)(b)) | One public catalogue of the alliance's courses; administration limited to it. Legal basis: [RoPA](ropa.md), `[TO COMPLETE]` |
| Necessity of instructor names | Required by the Aurora IT Handbook publication rule (spec §6.1, [DL 21 c]) and expected by students choosing a course. **Alternative to assess:** role descriptions ("course coordinator") are accepted by the validator and satisfy the rule; `[TO COMPLETE: alliance policy on names vs. roles]` |
| Minimisation (art. 5(1)(c)) | Names only, ≤ 50 per course, no identifiers, e-mail or phone for instructors (spec §5.2); functional contact mailboxes [DL 18 c]; administrators: only what Keycloak needs plus the last-activity time, without IP address or user agent; API request logs without client address or user agent (spec §10); harvested raw payloads without person objects (`apps/api/src/ingestion/oeapi/raw-payload.ts`) |
| Accuracy (art. 5(1)(d)) | Data comes from the universities' own systems; overrides let administrators correct a value that survives the next harvest (spec §5.3) |
| Storage limitation (art. 5(1)(e)) | Automatic retention jobs (RoPA); gaps in section 4, R6 |
| Information (art. 13, 14) | Privacy notice `[TO COMPLETE: URL]`; instructors are informed by `[TO COMPLETE: partner or Foundation]`; optional per-course privacy notice text (spec §5.2) |
| Rights (art. 15–22) | Procedure in R5 |
| Processors and transfers | URV under art. 28 ([checklist](art28-processor-checklist.md)); no transfers outside the EEA `[TO COMPLETE: confirm]` |

## 4. Risk register

Likelihood (L) and severity (S): low, medium, high. Proposed ratings, before and after measures.

| # | Risk to data subjects | L / S before | Measures in place (code reference) | Gaps | L / S after |
|---|---|---|---|---|---|
| R1 | **Unauthorised access to the admin panel** (phishing, password reuse, stale accounts) leading to altered publications or exposure of administrators' data | M / M | MFA required, `acr=mfa` checked on every request (`apps/api/src/admin/auth/claims.ts`); brute-force protection and password policy (`identity/keycloak/realm-oecp.yaml`); 5-min tokens held in memory (ADR-0013); organization scope on every endpoint (spec §2); *Remove* revokes roles and ends sessions (`apps/api/src/admin/organizations/organization-admins.service.ts`); Keycloak console IP allowlist; rate limits | TOTP only: the SPA does not offer WebAuthn registration (spec §2.2); dormancy in dry run until switched on (`apps/api/src/maintenance/dormancy.service.ts`); no annual recertification (backlog) | L / M |
| R2 | **Credential leakage**: partner OEAPI credentials, `oecp-backend` client secret (manages realm users), master key, invitation links | M / H | AES-256-GCM with per-row authenticated data, write-only in the API (`apps/api/src/secrets/secrets.service.ts`, ADR-0008); Docker secrets; invitation tokens stored as SHA-256 only, ≤ 7 days, in the URL fragment (spec §2.1); `Authorization` header redacted from logs | Master key rotation not implemented (single `key_version` 1); with `SMTP_HOST` empty nothing is sent and the invitation text and link are logged at debug level (`apps/api/src/admin/invitations/mailer.ts`), and with `NODE_ENV=production` the api refuses to start that way unless `OECP_MAIL_LOG_LINKS=true`; no secret manager (OpenBao in v1) | L / H |
| R3 | **Excessive publication of instructor names**: names published beyond what the university publishes, or kept after the course ends, and reused by third parties through the open API | M / M | Optional field; harvester takes names only from already expanded coordinators, never asks for more (`apps/api/src/ingestion/oeapi/oeapi-v5.adapter.ts`); length and count limits (migration 0007); DL 21 a rule: only what the university already publishes | Instructors stay on withdrawn courses (soft-deleted ones are purged after 12 months, spec §5); `enforce` mode of the publication rule pushes partners to fill names; CSV rows and form bodies in the raw history keep the names as submitted | L / M |
| R4 | **Partner data reuse without consent**: OECP republishes data a partner released only for eduXchange | M / M | Bilateral access agreement per partner [DL 14]; host approval before any harvest (ADR-0009); `consumer` strict semantics: OECP never re-serves data to eduXchange (`apps/api/src/oeapi/oeapi.service.ts`, ADR-0014, [DL 19]); withdrawal by absence (ADR-0015) | Agreements not yet signed `[TO COMPLETE]` | L / L |
| R5 | **Rights of instructors not honoured**: objection, erasure or rectification requests reach the wrong party or are undone by the next harvest | M / M | Overrides survive harvests (spec §5.3): an administrator can set `instructors` to a corrected or empty list at once; partner corrects at source | No written procedure yet; raw history keeps the old value up to 13 months (deletion of specific rows needs SQL by the operator); no `/privacy` page in the portal. **Procedure:** request → Foundation (contact `[TO COMPLETE]`) → partner informed within `[TO COMPLETE]` days → override applied at once → partner fixes source → operator deletes matching `ext_metadata_history` rows if the request requires it → reply within one month (art. 12(3)) | L / M |
| R6 | **Retention failures**: personal data kept longer than stated | M / M | Daily jobs `retention`, `history-partitions`, `csv-retention` with advisory locks and `maintenance_runs` records (`apps/api/src/maintenance/`, `apps/api/src/ingestion/csv/csv-retention.service.ts`); worker `/health` lists schedules | No alerting (spec §10); Keycloak account deletion (`account-cleanup`) in dry run until switched on, and blind to roles removed in the Keycloak console; application and access logs rotated by size, not age (sized by the operator; Loki's 90 days need a log shipper); backups keep deleted data until expiry | M / L |
| R7 | **Over-collection through federation**: home IdPs release more attributes than needed | L / L | Importers only for `mail`, `schacHomeOrganization`, `displayName`, `givenName`, `sn`; REFEDS Personalized Access and Data Protection Code of Conduct requested (Guide A, step 3) | Attribute release untested with a real eduGAIN IdP (backlog) | L / L |

Add rows for risks the DPO identifies: `[TO COMPLETE]`.

## 5. Action plan before go-live

| Action | Owner | Due |
|---|---|---|
| Configure SMTP relay; verify no invitation link reaches the logs | Hosting operator | `[TO COMPLETE]` |
| Backups with tested restore (runbook) | Hosting operator | `[TO COMPLETE]` |
| Size the log rotation for 90 / 30 days (runbook, section 10), or ship logs to Loki | Hosting operator | `[TO COMPLETE]` |
| Decide and switch on dormancy (`OECP_DORMANCY_DRY_RUN=false`) | Foundation | `[TO COMPLETE]` |
| Review an `account-cleanup` dry run and switch it on (`OECP_ACCOUNT_CLEANUP_DRY_RUN=false`) | Foundation, hosting operator | `[TO COMPLETE]` |
| Policy on instructors of withdrawn courses | Foundation | `[TO COMPLETE]` |
| Rights-request procedure and privacy notice published | Foundation | `[TO COMPLETE]` |
| Access agreements signed | Foundation, partners | Before each harvest |

## 6. Residual risk and conclusion

`[TO COMPLETE: overall residual risk; whether any high residual risk remains. If so, prior consultation of the supervisory authority under art. 36 is required before the processing starts.]`

## 7. DPO opinion (art. 35(2))

`[TO COMPLETE: opinion of the DPO, date; whether the controller followed it, and reasons if not]`

## 8. Views of data subjects (art. 35(9))

`[TO COMPLETE: whether staff representatives or a sample of instructors were consulted, or why not]`

## 9. Sign-off and review

| Role | Name | Decision | Date | Signature |
|---|---|---|---|---|
| Controller (Aurora Foundation) | `[TO COMPLETE]` | Approve / approve with actions / reject | | |
| Controller's DPO | `[TO COMPLETE]` | Opinion given | | |
| Processor (URV), for information | `[TO COMPLETE]` | Measures confirmed | | |

Review at least yearly and before Phase 2 (wallet login), the connection of the first partner IdP, a change of hosting, or any new category of personal data (art. 35(11)).
