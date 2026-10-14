<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Backlog (owner-requested items not yet scheduled)

| Item | Requested | Trigger | Notes |
|---|---|---|---|
| Onboarding guides in `docs/onboarding/` | 2026-10-14 | After the first version is validated and tagged | Four guides: alliance; partner with an operational OEAPI endpoint (eduXchange); partner without eduXchange but with integration capacity (OEAPI v5 endpoint or automated CSV); partner without integration capacity (web form + CSV batch). See decisions log row 17. |
| Harvest a real partner OEAPI endpoint (needs a bilateral credential; UIBK, UICE, VUA or UDE) | 2026-10-14 | When a partner grants access | Channel A verified against `tools/oeapi-mock` on 2026-10-14: create, change, withdraw-by-absence and republish. |
| Public portal: per-field update dates, partner logos | 2026-10-14 | v1 | Parity gaps vs the Aurora Virtual Campus draft, reported by the UI build. |
| Decide: offering with no usable teaching language (`mul`/`und`) is rejected today; alternatives are deriving from text languages or keeping `mul` | 2026-10-14 | Owner decision | Harvester default, spec §6.2.4. |
| Playwright E2E in CI with a test SAML IdP (brokered login, `idp` claim, schacHomeOrganization check) | 2026-10-14 | Before partner onboarding | `tools/e2e-identity` covers only the local-account path. |
| Worker health endpoint and Compose healthcheck | 2026-10-14 | v1 | Deploy review, 2026-10-14. |
| Keycloak mapper for `schac_home_organization` claim | 2026-10-14 | Before SAML partner onboarding | Saves an Admin API lookup at invitation acceptance. |
| CSV JSON Schema should `$ref` the canonical schema | 2026-10-14 | Before CSV channel implementation | Spec §6.3. |
| pgBackRest in the Compose production profile | 2026-10-14 | Before go-live | Spec §10. |
| MFA / LoA flows tested against a real SAML IdP | 2026-10-14 | Before go-live | Spec §2.2, §4. |
| Confirm the Aurora attribute definitions with the Aurora Foundation (6 hubs from the website, 17 SDGs, LOUIS, flags, target audience) before migrating the 13 current entries | 2026-10-14 | Owner / Foundation | Seed at apps/api/db/seed/attribute-definitions.aurora.json. |
| Migrate the 13 current Aurora Virtual Campus entries (+ archive) as the first CSV upload | 2026-10-14 | With Channel B | Real acceptance test for the CSV template and first public content. |
| Next: tag the first version (define the release process, sync the spec, write ADR-0007+) and then the onboarding and data-provider guides | 2026-10-14 | Next | All three channels (A OEAPI, B CSV, C form), identity, public catalogue and OEAPI read API are implemented and verified on the dev stack. |
| Docs: sync spec v4.0 with the implementation (migrations 0002–0004 DDL, `locale` param, real error codes, `consumer` behaviour, invitation flow as built) | 2026-10-14 | Before tagging the first version | Spec and code diverge in details. |
| Docs: OpenAPI for `/api/public/v1` and `/api/admin/v1` (generated from the NestJS app) | 2026-10-14 | Before partner onboarding | `/oeapi/v5` is covered by the standard. |
| Docs: user manuals for partner_admin (CSV console, integration, history) and alliance_admin (organizations, invitations) | 2026-10-14 | After the admin console | — |
| Docs: production runbook (PITR backups and restore drill, secret rotation, upgrades, alerts, SP registration in SIR/RedIRIS) | 2026-10-14 | Before go-live | Compose README covers dev only. |
| Docs: GDPR set (RoPA, DPIA, art. 28 contract checklist URV–Aurora Foundation) and accessibility statement | 2026-10-14 | Before go-live | Spec §10; Directive (EU) 2016/2102. |
| Docs: ADR-0007.. for decisions made while building (PostgreSQL search, encrypted secrets in DB, CSV all-or-nothing, direct partner access over SURFeduhub) | 2026-10-14 | Before tagging the first version | — |
| Docs: single developer guide (environment, tests with DB, mock partner, E2E scripts) and release/versioning process (semver, tags) | 2026-10-14 | Before tagging the first version | Defines what "closing a version" means for the onboarding guides. |
| Docs: technical data-provider guides in `docs/guides/` (requested 2026-10-14): (1) **API integration guide**: what the harvester expects from a partner OEAPI v5 endpoint (required resources and fields, `consumer` profile, auth schemes, IP allowlist, pagination, languages, delivery modes, the §6.2.4 mapping and every warning/rejection code, how "Test connection" and "Sync now" work, withdrawal by absence); (2) **CSV authoring guide**: template 1.0 columns, encoding and separators, language-suffixed and multi-value columns, status semantics, limits, how to validate in the browser before uploading, every `oecp.csv.*` / `oecp.content.*` code with the fix; (3) **Web form guide**: manual entry of courses and offerings, overrides on harvested data, publishing and withdrawing. Companions to the onboarding guides of decision 17. | 2026-10-14 | With the onboarding guides, after the first version is tagged; the CSV guide can start once the admin console is done | Error-code tables can be generated from `packages/schemas/errors.json`. |
| Admin session survives a page reload (silent renew via hidden iframe / `prompt=none`, or Keycloak SSO cookie check on load), keeping tokens out of storage | 2026-10-14 | v1 | Observed 2026-10-14: a full reload of an admin page shows the sign-in prompt again because tokens are in memory only (spec §4). |
| API: `files` member (original CSV file names) on `SyncRun`; `/api/admin/v1/reference` with allowed language tags, sub-unit codes and course codes for the browser validator; upload 201 response schema in `@oecp/schemas` | 2026-10-14 | v1 | Gaps reported by the admin console build. |
| CSP (nonce-based, spec §10) must allow `worker-src 'self'` and `blob:` for the CSV validator worker and report downloads | 2026-10-14 | With the CSP work | — |
| Brokered partner admins: send `kc_idp_hint=<org alias>` from the invitation acceptance and sign-in pages (partner IdPs are `hideOnLogin`), so a partner admin can reach their IdP | 2026-10-14 | Before partner onboarding | Spec v4.1 note 1. |
| `ext_metadata_history` partition maintenance job (monthly partitions ahead of time) and retention jobs; only 2026-11 and the default partition exist | 2026-10-14 | Before go-live | Spec v4.1 note 4. |
| Harvester: rejected entities reset `absent_count` but are not republished (v4.0 said they were); CSV keeps overrides left from an `oeapi` period while form saves drop them | 2026-10-14 | v1 | Spec v4.1 notes 7 and 9; decide the intended semantics. |
| Keep `courses.level` in sync with `levels[0]` at the database level (trigger), not only in the writer | 2026-10-14 | v1 | Spec v4.1 note 2. |
