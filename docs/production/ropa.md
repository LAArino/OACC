<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Record of processing activities (GDPR art. 30): OECP deployment

Template for the Aurora deployment of OECP, release 0.3.0, updated through release 0.6.0 and the Unreleased changes after it (account clean-up, soft-delete purge, raw payload minimisation; backups; branding; container logs shipped to Loki; see the CHANGELOG). System facts come from spec v4.1 (§2, §4, §5, §10) and the code; decisions are `[TO COMPLETE]` ([README](README.md)).

## Controller, processor and common facts

| Item | Value |
|---|---|
| Controller | Aurora Foundation `[TO COMPLETE: legal name, registered address, registration number]` [DL 2] |
| Controller's representative / contact | `[TO COMPLETE]` |
| Controller's DPO | `[TO COMPLETE: name or function, contact]` |
| Processor (hosting) | Universitat Rovira i Virgili (URV) `[TO COMPLETE: address, DPO contact]`, under the art. 28 contract of `[TO COMPLETE: date]` |
| System | Open European Campus Portal (OECP), release `[TO COMPLETE: deployed version]`, Docker Compose deployment at URV ([runbook](runbook.md)); portal `[TO COMPLETE: portal host]`, sign-in `[TO COMPLETE: auth host]` |
| Hosting location | `[TO COMPLETE: data centre(s), country]`; backups `[TO COMPLETE: backup site, country]` |
| Partner universities | UIBK (AT), UICE (IS), VUA (NL), UDE (DE), URV (ES), UNINA (IT), UP (CZ), CBS (DK), UPEC (FR) [DL 4]; role: **independent controllers** of the data each supplies (instructors, contacts), the Foundation of the published catalogue; no joint controllership under art. 26 [DL 24], recorded in each bilateral access agreement ([art. 28 checklist, section B](art28-processor-checklist.md#b-access-agreement-with-each-harvested-partner)) |
| Out of scope | OECP handles no applications and stores **no student data** (spec §1). The public portal sets no cookies and runs no analytics (spec §7.2). The portal's branding images (header images, alliance logo) are deployment configuration served from the branding directory, not repository content; for Aurora they are own generated images without real persons and the Aurora logo used with the Foundation's permission [DL 25], so they hold no personal data. |

**Legal basis candidates** used below: art. 6(1)(e), task carried out in the public interest, which needs a basis in Union or member-state law (art. 6(3)) `[TO COMPLETE: the law, e.g. the higher-education law giving the universities and their alliance their mission]`; art. 6(1)(f), legitimate interests, with a balancing test, not available to public authorities for the performance of their tasks (art. 6(1), second subparagraph) `[TO COMPLETE: legal nature of the Aurora Foundation]`; art. 6(1)(c), legal obligation, only for the security logging that a law requires `[TO COMPLETE: if any]`. The controller chooses one per activity and records why.

### Security measures common to every activity (art. 32)

| Measure | As built (reference) |
|---|---|
| Transport encryption | TLS at the edge proxy, HSTS (spec §10; `deploy/compose/traefik/dynamic/middlewares.yaml`); ACME certificates in production |
| Authentication of staff | Keycloak, MFA on every admin login (`acr=mfa`, enforced in `apps/api/src/admin/auth/claims.ts`); password policy, brute-force protection, no self-registration (`identity/keycloak/realm-oecp.yaml`) |
| Authorisation | Two roles assigned only by OECP, never from federated attributes; requests scoped to the caller's organization (spec §2) |
| Sessions | Access tokens 5 min, SSO idle 30 min / max 8 h, tokens in browser memory only (ADR-0013) |
| Secrets | Partner credentials AES-256-GCM in the `secrets` table, write-only in the API (ADR-0008); passwords as Docker secrets, never environment variables |
| Network | Keycloak console IP-allowlisted; per-IP rate limits; outbound calls only to approved partner hosts over HTTPS (ADR-0009) |
| Minimisation | No IP address or user agent in `admin_activity` or in the API's request logs (an optional salted hash of the address only, `OECP_LOG_CLIENT_ADDRESSES`); instructors limited to names; harvested raw payloads stored without person objects (`apps/api/src/ingestion/oeapi/raw-payload.ts`); invitation links never logged in production (`OECP_MAIL_LOG_LINKS=false`); functional contact mailboxes [DL 18 c, DL 21 a] |
| Retention | Automatic jobs, below and spec §10 |
| Backups | pgBackRest with continuous WAL archiving, 35-day recovery window, quarterly restore drill (as built, profile `backup`); repo1 on the production host unencrypted, the second site (repo2) always encrypted `[TO COMPLETE: second site as deployed]`; see activity 8 |
| Organisational | `[TO COMPLETE: confidentiality, access reviews, training, certifications]` |

---

## 1. Administrator identity and authentication

| Field | Entry |
|---|---|
| Purpose | Authenticate the staff who maintain the catalogue, enforce MFA, assign and revoke roles |
| Legal basis | `[TO COMPLETE: 6(1)(e) or 6(1)(f)]` |
| Data subjects | Partner and alliance administrators (staff of the partners and of the Foundation) |
| Personal data | Keycloak account: username, e-mail, first and last name, display name, `schacHomeOrganization` (imported from the home IdP for federated accounts), subject identifier (`subject-id` or `pairwise-id`), password hash and TOTP secret (local accounts), sessions; OECP: `oecp_org_id`, role, `admin_activity` (JWT `sub`, organization, last admin API use, at most hourly) |
| Source | The person (local accounts) or the home institution's IdP through eduGAIN (federated accounts) [DL 15] |
| Recipients | Hosting operator; alliance administrators (names, e-mails, last sign-in, spec §8.4) |
| Transfers | None outside the EEA `[TO COMPLETE: confirm hosting location]` |
| Retention | Keycloak account while the person holds a role, deleted 12 months after the last role removal (revocation or dormancy; `OECP_ACCOUNT_DELETE_MONTHS`) by the worker job `account-cleanup`, unless the account is in use again (spec §2.2). The job runs in **dry run by default** (`OECP_ACCOUNT_CLEANUP_DRY_RUN=true`) and deletes nothing until the operator switches it: `[TO COMPLETE: date switched on]`. Accounts whose roles were removed in the Keycloak console (no audit row) are not covered `[TO COMPLETE: procedure]`. `admin_activity` 12 months idle (`retention` job), and removed with the account |
| System reference | Keycloak realm `oecp`; tables `admin_activity`; `apps/api/src/admin/auth/`, `apps/api/src/identity/`, `apps/api/src/maintenance/account-cleanup.service.ts` |

## 2. Invitations

| Field | Entry |
|---|---|
| Purpose | Onboard a named person as administrator of one organization |
| Legal basis | `[TO COMPLETE]` (same as activity 1) |
| Data subjects | Invited persons, inviting administrators |
| Personal data | `admin_invitations`: e-mail, role, organization, inviter's `sub`, SHA-256 of the token (the token itself is never stored), dates, accepting `sub`; the invitation e-mail |
| Recipients | Hosting operator; URV mail relay `[TO COMPLETE: relay operator]`; alliance administrators (invitation list) |
| Transfers | None `[TO COMPLETE: confirm the relay does not route outside the EEA]` |
| Retention | Link valid 1–7 days; row deleted 12 months after acceptance, revocation or expiry (`retention` job); audit rows (activity 3) 36 months |
| System reference | `admin_invitations`; `apps/api/src/admin/invitations/`; spec §2.1 |

## 3. Audit and security logging

| Field | Entry |
|---|---|
| Purpose | Accountability, detection and investigation of security incidents, troubleshooting |
| Legal basis | `[TO COMPLETE: 6(1)(f) or 6(1)(e); 6(1)(c) if a law requires the logs]` |
| Data subjects | Administrators; visitors of the public portal and API clients (technical logs only) |
| Personal data | `audit_log`: actor `sub`, organization, action, entity, changes (includes administrators' e-mail addresses for invitation and revocation events, kept in clear for the 36 months of the audit log as evidence of who received or lost access [DL 23]); Keycloak login and admin events (user id, IP address, client, time); `sync_runs.triggered_by`, `maintenance_runs.triggered_by` (`sub`); application logs (api, worker; one line per HTTP request with method, URL, status, duration, request id and, for admin requests, the JWT `sub`; no headers, client address or user agent; with `OECP_LOG_CLIENT_ADDRESSES=true` a salted SHA-256 of the client address, not linkable across restarts); Traefik access logs, **off by default** (`OECP_TRAEFIK_ACCESS_LOG`; when on: client IP address, method, path, status, duration, no request headers) |
| Recipients | Hosting operator; alliance administrators (history views) |
| Transfers | None |
| Retention | `audit_log` 36 months; Keycloak events 90 days (realm setting); `sync_runs` 24 months; `maintenance_runs` 12 months. Application and access logs: 90 / 30 days. With the profile `observability` (after 0.6.0) Grafana Alloy ships every container's log to Loki, which deletes the Traefik access log after 30 days and everything else after 90 days (time-based, `deploy/compose/observability/loki.yaml`). Docker also rotates each container's log by size (`OECP_LOG_MAX_SIZE` × `OECP_LOG_MAX_FILE`, default 10 MB × 5; Traefik 20 MB × 10): the local copy, and the only bound without the profile, sized by the operator for those periods from the measured volume (runbook, section 10) `[TO COMPLETE: observability profile running or not; configured sizes and resulting periods; access log on or off]` |
| System reference | `audit_log`, `maintenance_runs`; Keycloak database; `apps/api/src/logging/logger.module.ts`; `deploy/compose/compose.yaml`, `deploy/compose/observability/alloy.alloy`, `loki.yaml` |

## 4. Course catalogue publication

| Field | Entry |
|---|---|
| Purpose | Publish the alliance's course offer to the public, through the portal and the anonymous read API `/oeapi/v5` |
| Legal basis | `[TO COMPLETE: 6(1)(e) proposed in DL 21 a: the universities already publish the same data for the same purpose]` |
| Data subjects | Teaching staff named as instructors; staff behind course contact mailboxes, if a mailbox is personal |
| Personal data | `courses.instructors`: names or role descriptions, at most 50 per course, as the university publishes them; `contact_email` of the course or the organization (functional mailboxes required by the alliance [DL 18 c] `[TO COMPLETE: confirm with each partner]`); free texts written by the partners (a per-course privacy notice may be among them); `overrides` entries keep the `sub` of the editing administrator |
| Source | Partner universities through the three channels (activity 5); never obtained from the data subjects, so art. 14 information is due `[TO COMPLETE: who informs the instructors: partner or Foundation]` |
| Recipients | **The public** (portal, `/oeapi/v5`, sitemap, search engines); any reuser of the open API |
| Transfers | Publication on the internet is accessible worldwide; `[TO COMPLETE: DPO assessment]` |
| Retention | Target: while the course is published. **As built:** instructors and contacts stay in the course row in every status (draft, withdrawn, cancelled); courses and offerings deleted in the web form are purged 12 months after deletion (`retention` job, `OECP_RETENTION_SOFT_DELETED_MONTHS`). Withdrawn courses are never purged: clear `instructors` when a course is withdrawn for good, or delete it if it is not published `[TO COMPLETE: decide]` |
| System reference | `courses`, `course_texts`, `course_offerings`; `apps/api/src/catalogue/`, `apps/api/src/oeapi/`; spec §5.2, §7, §9 |

## 5. Partner data ingestion and raw payload history

| Field | Entry |
|---|---|
| Purpose | Collect and validate partner course data (harvest, CSV, web form); keep source payloads for diagnosis and disputes |
| Legal basis | `[TO COMPLETE]` (as activity 4); harvesting under a bilateral access agreement with each harvested partner [DL 14] |
| Data subjects | Instructors; administrators who upload or edit |
| Personal data | `ext_metadata_history.raw_payload`: the source document (an OEAPI course item, a CSV row, a form body). OEAPI payloads are **minimised before storage**: every `coordinators` and `persons` member and every person member of `ext` is removed, so only the instructor names mapped into the catalogue remain (spec §5.2, §6.2.4); CSV rows and form bodies are stored as submitted, including the `instructors` names; uploaded CSV files; `sync_errors` (may quote values); `sync_runs.triggered_by` |
| Source | Partner OEAPI endpoints (UIBK, UICE, VUA, UDE), partner administrators; optionally the SURFeduhub gateway (fallback mode, spec §6.2.2) `[TO COMPLETE: used or not]` |
| Recipients | Hosting operator; partner and alliance administrators (sync monitor) |
| Transfers | None; all partners are in the EEA (Iceland through the EEA Agreement) `[TO COMPLETE: DPO confirmation; re-check for every new partner]` |
| Retention | Raw payloads 12 months (monthly partitions dropped by `history-partitions` when the whole month is older than `OECP_RETENTION_HISTORY_MONTHS`: 12 to 13 months); `sync_errors` 12 months; `sync_runs` 24 months; uploaded files 90 days (`csv-retention`) |
| System reference | `ext_metadata_history`, `sync_runs`, `sync_errors`, volume `uploads`; `apps/api/src/ingestion/`, `apps/api/src/maintenance/history-partitions.service.ts` |

## 6. Maintenance and dormancy

| Field | Entry |
|---|---|
| Purpose | Remove access after 180 days of inactivity; delete the accounts of former administrators; enforce retention |
| Legal basis | `[TO COMPLETE]` (as activity 1; also art. 5(1)(e) and 32) |
| Data subjects | Administrators |
| Personal data | Last activity (from `admin_activity` and Keycloak `LOGIN` events), roles, organization, account creation date, date and kind of the last role removal; `maintenance_runs.details` lists dormancy candidates and account clean-up candidates and kept accounts (with the reason) by `sub`, without e-mail addresses; audit `admin.dormant_revoke` and `admin.account_deleted` (Keycloak user id, no e-mail) |
| Recipients | Hosting operator; alliance administrators (*Maintenance* page of the admin panel, `GET /maintenance/runs`) |
| Transfers | None |
| Retention | `maintenance_runs` 12 months |
| Notes | The `dormancy` and `account-cleanup` jobs run in **dry run by default** (`OECP_DORMANCY_DRY_RUN=true`, `OECP_ACCOUNT_CLEANUP_DRY_RUN=true`); the alliance reviews their dry runs on the *Maintenance* page: `[TO COMPLETE: dates the Foundation switched each on]`. Annual recertification is not implemented (backlog) |
| System reference | `apps/api/src/maintenance/dormancy.service.ts`, `account-cleanup.service.ts`, `retention.service.ts`; spec §2.2, §10 |

## 7. Analytics

None: no cookies, analytics or third-party tracking on the portal (spec §1, §7.2). Record any later addition as a new activity.

## 8. Backups

| Field | Entry |
|---|---|
| Purpose | Restore the service and its data after failure or error (art. 32(1)(c)) |
| Legal basis | As the activities whose data is backed up |
| Data subjects / data | All of the above: databases `oecp` and `keycloak` (including password hashes and TOTP secrets) and the `uploads` volume. The secret files are not in the backups (offline copy, runbook section 2) |
| Recipients | Hosting operator; backup site `[TO COMPLETE: in-house or external provider; an external provider is a sub-processor]` |
| Transfers | `[TO COMPLETE: location of the backup site]` |
| Retention | 35-day recovery window as built (pgBackRest, spec §10, release 0.5.0): a full backup every Sunday, a differential the other days, continuous WAL archiving, daily `uploads` archives kept 35 days; backups older than the window are expired by pgBackRest. Data deleted by the retention jobs survives in backups until they expire |
| System reference | [runbook](runbook.md), "Backups" |

## Record maintenance

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | `[TO COMPLETE]` | `[TO COMPLETE]` | First completion from the OECP template (release 0.3.0) |
