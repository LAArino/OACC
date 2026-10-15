<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0004: Keycloak-only identity, one SAML IdP per partner

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R00] `docs/review/00-consolidated-pending-decisions.md`, [R01] `docs/review/01-identity.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

Specification v3.0 placed simpleSAMLphp with `simplesamlphp-module-oid4vp` as
an IdP proxy in front of Keycloak, to combine eduGAIN login with EUDI Wallet
login, and derived one role per university (for example
`uni_valencia_admin`) [R01 §2, §3]. The identity review found that:

- the admin dashboard is used by staff of about 9–10 partners, not by all of
  eduGAIN [R01 §3];
- the OID4VP module, maintained by the project's author, is v1.0.0 with a
  single maintainer and no external audit; it accepts only W3C VCs in JWT,
  not SD-JWT VC or mdoc as EUDI wallets require, and has open security
  findings (issuer key not bound to `iss`, no holder binding, optional VP
  `exp`, SSRF through `did:web` and the Universal Resolver, a permissive
  mode without a trust list) [R01 §1; R00 §2.1, §5];
- no academic credential proves "admin of University X", so admin roles must
  be assigned locally; one role per university does not scale [R01 §2];
- Keycloak cannot consume federation aggregates and has one ACS per IdP alias
  [R01 §1, §3].

The owner decided that the MVP has no wallet and uses local Keycloak with
eduGAIN federation [DL 1], with roles `partner_admin` and `alliance_admin`
carrying an organization claim and mandatory MFA [DL 9], and one SP
registered in SIR (RedIRIS) with eduGAIN export and multi-ACS metadata,
reaching VUA through SURFconext and CBS through WAYF [DL 15].

How should administrators authenticate in the MVP?

## Decision drivers

- Small user base (partner and alliance administrators only) [R01 §3].
- Minimal attack surface and operational load: one IAM stack [R01 §3].
- Stable, non-reassignable user identifiers and no account linking by email [R01 §2].
- Strong authentication for users with write access to the catalogue [R01 §2; DL 9].
- A backend contract that survives adding wallet login later [R01 §3].
- The public portal must not depend on the identity service [R01 §2].

## Considered options

1. **A — Keycloak only**, one SAML IdP per partner, local MFA, no wallet [R01 §3].
2. **B — Keycloak with simpleSAMLphp as IdP proxy** (the v3.0 design) [R01 §3].
3. **C — SATOSA in front of Keycloak** [R01 §3].
4. Single connection to MyAcademicID/eduTEAMS as one upstream IdP (not
   verified for eligibility) [R01 §3].

## Decision outcome

Chosen option: **A — Keycloak only, one SAML IdP per partner**, because it
covers the real user base with one Java stack, less attack surface and
simpler logout, and the backend contract is the Keycloak JWT, so wallet login
can be added later as one more IdP without touching the core
[R01 §3; R00 §2.1; DL 1].

Key elements (spec §2, §4):

- One realm `oecp` per deployment, configured as code in `identity/keycloak`.
- One SAML IdP per partner, alias = partner slug, built from its eduGAIN
  entity descriptor; a daily `idp-metadata-refresh` job verifies the eduGAIN
  aggregate and updates certificates and endpoints. Hub-and-spoke federations
  (SURFconext, WAYF) are configured as the hub IdP [DL 15].
- Principal from SAML `subject-id`, else `pairwise-id`, ePPN only with written
  confirmation that it is never reassigned; never email or transient NameID.
- Roles `partner_admin` and `alliance_admin` plus attribute `oecp_org_id`,
  assigned only in OECP through invitations; first-broker-login creates
  role-less users; linking by email is disabled.
- Mandatory MFA in Keycloak (WebAuthn preferred, TOTP) for every admin login,
  ACR `mfa`; short token lifetimes and revocation within 5 minutes.
- One SP entity registered in the hosting institution's federation (SIR for
  the URV-hosted MVP) with eduGAIN export, REFEDS Personalized Access, CoCo v2
  and Sirtfi; one metadata document listing every ACS.
- The public portal never touches Keycloak: no OIDC code, redirects or
  cookies.

### Consequences

- Good, because there is a single identity component and session, and SAML
  SLO is used where IdPs support it.
- Good, because authorisation depends only on locally assigned roles and an
  organization claim, never on federated attributes [R01 §2].
- Good, because wallet login (OID4VP) can be added in v2 as another Keycloak
  IdP without changing the JWT contract (spec §4, phase-2 hook).
- Bad, because each partner IdP is added and maintained individually, and the
  SP metadata must be resubmitted when a partner is added [R01 §3].
- Bad, because there is no wallet login in the MVP; staff with institutional
  IdPs gain little from it [R00 §3].
- Neutral, because the phase-2 ADR must choose between Keycloak's native
  OID4VP verifier (experimental in 26.8) and the simpleSAMLphp module, which
  must first fix the findings listed in [R00 §5] and pass an external audit.

### Confirmation

Cross-organization authorisation tests and a Playwright invitation flow
against a test SAML IdP (spec §10); realm configuration is code-reviewed in
`identity/keycloak`.

## Pros and cons of the options

### A — Keycloak only

- Good, because of one stack, less attack surface and simpler logout [R01 §3].
- Bad, because of manual registration of each IdP and one ACS per alias [R01 §3].

### B — Keycloak with simpleSAMLphp as IdP proxy

- Good, because of full eduGAIN discovery (metarefresh) and the OID4VP module
  already integrated [R01 §3].
- Bad, because of two IAM stacks (PHP and Java), double sessions, more
  operations, and dependence on a single-maintainer module with open security
  findings [R01 §1, §3].

### C — SATOSA in front of Keycloak

- Good, because it is a proven pattern for very large IdP sets (used at CERN) [R01 §1, §3].
- Bad, because it only pays off with thousands of IdPs and brings no OID4VP
  support for EBSI [R01 §3].

### MyAcademicID/eduTEAMS as single upstream IdP

- Good, because it would reduce per-partner IdP configuration.
- Bad, because eligibility conditions were not verified [R01 §3].

## More information

- Specification §2 (actors and roles) and §4 (identity).
- `simplesamlphp-module-oid4vp` stays in its own repository (spec §11).
