<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Backlog (owner-requested items not yet scheduled)

| Item | Requested | Trigger | Notes |
|---|---|---|---|
| Onboarding guides in `docs/onboarding/` | 2026-10-14 | After the first version is validated and tagged | Four guides: alliance; partner with an operational OEAPI endpoint (eduXchange); partner without eduXchange but with integration capacity (OEAPI v5 endpoint or automated CSV); partner without integration capacity (web form + CSV batch). See decisions log row 17. |
| Harvest a real partner OEAPI endpoint (needs a bilateral credential; UIBK, UICE, VUA or UDE) | 2026-10-14 | When a partner grants access | Channel A verified against `tools/oeapi-mock` on 2026-10-14: create, change, withdraw-by-absence and republish. |
| Channel B (CSV) and public catalogue API/UI | 2026-10-14 | Next | Catalogue tables now hold harvested data; `/api/public/v1` and `/oeapi/v5` read endpoints are still 501. |
| Decide: offering with no usable teaching language (`mul`/`und`) is rejected today; alternatives are deriving from text languages or keeping `mul` | 2026-10-14 | Owner decision | Harvester default, spec §6.2.4. |
| Playwright E2E in CI with a test SAML IdP (brokered login, `idp` claim, schacHomeOrganization check) | 2026-10-14 | Before partner onboarding | `tools/e2e-identity` covers only the local-account path. |
| Worker health endpoint and Compose healthcheck | 2026-10-14 | v1 | Deploy review, 2026-10-14. |
| Keycloak mapper for `schac_home_organization` claim | 2026-10-14 | Before SAML partner onboarding | Saves an Admin API lookup at invitation acceptance. |
| CSV JSON Schema should `$ref` the canonical schema | 2026-10-14 | Before CSV channel implementation | Spec §6.3. |
| pgBackRest in the Compose production profile | 2026-10-14 | Before go-live | Spec §10. |
| MFA / LoA flows tested against a real SAML IdP | 2026-10-14 | Before go-live | Spec §2.2, §4. |
| Alliance-level course attributes (`course_attributes` jsonb + `course_kind`), `application_instructions` text, multi-valued study cycle | 2026-10-14 | Before Channel B / public portal | From the Aurora Virtual Campus draft review, docs/research/aurora-virtual-campus-draft.md. |
| Migrate the 13 current Aurora Virtual Campus entries (+ archive) as the first CSV upload | 2026-10-14 | With Channel B | Real acceptance test for the CSV template and first public content. |
