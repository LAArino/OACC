<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Backlog (owner-requested items not yet scheduled)

| Item | Requested | Trigger | Notes |
|---|---|---|---|
| Onboarding guides in `docs/onboarding/` | 2026-10-14 | After the first version is validated and tagged | Four guides: alliance; partner with an operational OEAPI endpoint (eduXchange); partner without eduXchange but with integration capacity (OEAPI v5 endpoint or automated CSV); partner without integration capacity (web form + CSV batch). See decisions log row 17. |
| Web: invitation acceptance page (`/en/admin/accept`) with OIDC login and `POST /api/admin/v1/invitations/accept` | 2026-10-14 | Next | Closes the identity path end to end; the API side and the CLI bootstrap are done. |
| Worker health endpoint and Compose healthcheck | 2026-10-14 | v1 | Deploy review, 2026-10-14. |
| Keycloak mapper for `schac_home_organization` claim | 2026-10-14 | Before SAML partner onboarding | Saves an Admin API lookup at invitation acceptance. |
| CSV JSON Schema should `$ref` the canonical schema | 2026-10-14 | Before CSV channel implementation | Spec §6.3. |
| pgBackRest in the Compose production profile | 2026-10-14 | Before go-live | Spec §10. |
| MFA / LoA flows tested against a real SAML IdP | 2026-10-14 | Before go-live | Spec §2.2, §4. |
