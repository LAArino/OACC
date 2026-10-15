<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Critical review: OECP v3.0 identity layer (section 2 and the RBAC of 5.2)

> Translated from the Spanish original on 2026-10-15; the Spanish text is in the Git history of this file. Quotations of specification v3.0 are translated from its Spanish original ([archived](../archive/spec-v3.0-original.es.md)).

*Verification date: 2026-10-14. Scope: identity and authorization only.*

## 1. Factual checks

| Statement in the spec | Status | Detail |
|---|---|---|
| `simplesamlphp-module-oid4vp` is an existing open-source module | **Correct, but immature** | Repository `LAArino/simplesamlphp-module-oid4vp`, EUPL-1.2, maintained by a single person (Lluís Alfons Ariño). v1.0.0 of 2026-09-09, about 15 commits, 3 installs on Packagist, 0 dependents. There are PHPUnit tests and a simulated wallet. No external audit. |
| The wallet delivers an EAA "W3C VC (SD-JWT / JWT)" | **Incorrect** | The module accepts only **W3C VCs in JWT** (ES256, DIDs `did:key/jwk/web/ebsi/blue`). SD-JWT VC, DCQL and `direct_post.jwt` are listed as *planned*. Moreover, SD-JWT VC is an IETF format and not a W3C VC. |
| "12-step verification pipeline" | **Exists, but is incomplete** | The 12 steps are in `PresentationVerifier.php`. Missing: revocation (StatusList, *planned*), holder binding and binding of the issuer key (see below). |
| "EUDI Wallet" | **Misleading** | The ARF/HAIP requires **SD-JWT VC and mdoc**, a client identified by X.509 (`x509_san_dns`/`x509_hash`), an access certificate and an RP registration certificate. The module is designed for wallets of the EBSI/BLUE ecosystem (DID-based) and not for the national EUDI wallets. |
| eduGAIN: "native limitations of Keycloak" | **Correct** | Keycloak does not import federation aggregates: each IdP is added separately, with one ACS per alias. The established pattern is to put a proxy in front (SATOSA at CERN, or SSP). Keycloak 26.8 (2026-10-01) does not change this. |
| Keycloak does not do OID4VP | **No longer true** | Keycloak 26.8 ships an **experimental** OID4VP verifier (feature `oid4vc-vp`) with SD-JWT VC, DCQL and `x509_hash`. According to a third-party analysis, it does not enforce the DCQL query and is not production-ready. |
| MyAcademicID is a "DC4EU credential framework" | **Imprecise** | MyAcademicID is above all **GÉANT's IAM proxy (eduTEAMS)** for Erasmus+/ESCI, which relies on eduGAIN and eIDAS and carries the ESI. There is a MyAcademicID VC schema in EBSI, but it is secondary. |
| EducationalID / AllianceID | **Partly verified** | Both are EBSI schemas (`VerifiableEducationalID`, "Verifiable AllianceID") defined with alliances and GÉANT. **I could not verify** that DC4EU presents them as a "catalogue of three frameworks", nor the exact scope of AllianceID (in EBSI: "natural person participating in the Alliance"). |
| ESI | **Correct** | `urn:schac:personalUniqueCode:int:esi:<country-code|sHO>:<code>`. It is released only for **active students**, so it is irrelevant for the staff who use the panel. |
| BLUE | **Not verified** | The BLUE network (CRUE/RedIRIS) exists. I found no public documentation of `did:blue` or of its Trusted Issuers Registry. |
| eIDAS2: "mandatory wallets" | **Overstated** | Member States must offer a wallet by **2026-12-24**. The registration of RPs is governed by Implementing Regulation (EU) 2025/848. No text requires a catalogue portal to accept wallets for its staff panel. The dates come from secondary sources and should be confirmed in the OJEU. |

**Security findings in the module** (reading of `main` on 2026-10-14; to be confirmed with tests before production):

1. **The issuer key is not bound to `iss`.** The key is resolved from `kid` in the VC header, but trust is checked against the `iss` claim. Nothing requires the DID of `kid` to match `iss`. This would allow forging a VC signed with one's own `did:key` and with the `iss` of a trusted university.
2. **There is no holder binding.** Nothing checks that the signer of the VP is `credentialSubject.id`, so a stolen VC can be reused in another VP.
3. `exp` of the VP is optional. Only the first VC is processed.
4. `did:web` resolution and the *Universal Resolver* make outgoing requests to URLs controlled by whoever presents the credential, with a risk of SSRF and privacy leaks.
5. If no trust list is configured, the module accepts any `did:key` in "development" mode. This must be blocked in production.

## 2. Design gaps that block implementation

- **Who the RP or verifier is.** The alliance usually has no legal personality. It must be decided which entity registers with the national registrar (Regulation 2025/848), obtains the access and registration certificates, and appears as the controller.
- **Issuer trust framework.** The spec does not say whether EBSI TIR, BLUE, the eIDAS Trusted Lists or a static list will be used. Nor who registers the issuers of each partner or how they are revoked.
- **No credential proves "admin of University X".** EducationalID, AllianceID and MyAcademicID attest identity or affiliation (at best, `staff`). **Roles such as `uni_valencia_admin` cannot be derived from external attributes**: they must be assigned locally.
- **Role provisioning.** Missing: the invitation or account-creation flow, who assigns the roles (the global admin?), the *bootstrap* of the first global admin, automatic removal and periodic recertification.
- **Role model.** One role per university (`uni_valencia_admin`) does not scale. A `partner_admin` role plus an `organization_id` claim is better, using Keycloak Organizations or groups. The table that maps `schacHomeOrganization` to `organization_id` is also missing.
- **Stable identifier and account linking.** `eduPersonPrincipalName` can be reassigned. SAML `subject-id`/`pairwise-id` is preferable. In the module, `eduPersonTargetedID` is an md5 of the DID and is not pairwise. Linking the SAML identity with the wallet identity must be done **explicitly and with an active session**: never automatically by e-mail, because that opens the door to account takeover.
- **Registration in eduGAIN.** The SP must be registered in a national federation (for example SIR/RedIRIS) with entity categories. R&S probably **does not apply** to a management panel. The appropriate choice is **REFEDS Personalized + CoCo v2**, plus Sirtfi and a privacy policy. Without this, many IdPs will not release attributes.
- **MFA and level of assurance.** It must be decided whether the REFEDS MFA Profile (`AuthnContextClassRef`) is required or a local second factor in Keycloak (WebAuthn/TOTP). For users with write permissions on the catalogue, I recommend making it mandatory.
- **Sessions.** Missing: the TTL of the access token, refresh, SSO idle/max, logout and its propagation (SLO between SSP, Keycloak and the SPA) and immediate revocation of roles.
- **Public portal.** It must be stated explicitly that it **does not go through Keycloak**: no session cookies and separate gateway routes.
- **GDPR.** Missing: the RPA, the **DPIA** (because of the verifiable credentials and the logs), the **joint-controllership** agreement (art. 26) between partners, the retention of attributes in Keycloak and in the SSP session files, and minimisation. The ESI must not be stored if it is not used.
- **One credential per authsource.** Supporting the three frameworks requires three authentication sources and three mappings. The "invariability of the core" holds only if the backend consumes nothing but `organization_id` and the role.

## 3. Simplification: is simpleSAMLphp needed in the MVP?

**The real problem is small.** The panel is used only by the staff of about 9–10 partners, not by "the whole eduGAIN federation".

- **Option A (recommended for the MVP): Keycloak alone.** One SAML IdP is configured per partner, with signed metadata from eduGAIN or the national federation and scheduled refresh. Local MFA, no wallet. *Pros:* a single stack (Java), a smaller attack surface, simpler logout. *Cons:* each IdP added by hand, ACS per alias (how the SP metadata is published in the federation must be checked) and no wallet at all.
- **Option B: Keycloak with SSP as IdP proxy** (the current design). It makes sense **only if wallet login is an MVP requirement**. *Pros:* full eduGAIN discovery (metarefresh) and the OID4VP module already integrated. *Cons:* two IAMs (PHP and Java), double session, more operation, and the dependency on a single-maintainer module with the security flaws listed above.
- **Option C: SATOSA in front of Keycloak.** This is the proven pattern at CERN. It pays off only if thousands of IdPs are needed, and it brings no OID4VP for EBSI.
- **Alternative to evaluate:** connecting as a single IdP to **MyAcademicID/eduTEAMS**, which GÉANT offers to alliances. I did not verify the eligibility conditions.

**Recommendation:** start with Option A. The contract with the backend is the Keycloak JWT (`organization_id` and the role), so SSP with OID4VP, or Keycloak's native verifier when it matures, can be added later as one more IdP without touching the core. Before that phase 2, points 1 and 2 of the module must be fixed and SD-JWT VC support added if real EUDI wallets are wanted.

## 4. Questions the owner must answer before programming

1. Is wallet login essential in the MVP, or can it wait for phase 2 behind Keycloak?
2. Which legal entity acts as controller and as the RP registered with the eIDAS2 registrar?
3. Who assigns and removes the partner admin and global admin roles, and how is the first global admin created?
4. Which stable user identifier is used (`subject-id`, `pairwise-id`, ePPN), and how are the SAML and wallet identities explicitly linked?
5. In which national federation is the SP registered, and with which entity categories (Personalized, CoCo v2, Sirtfi)?
6. Which minimum attributes are required from each IdP, and what happens if a partner does not release them?
7. Is MFA required of all administrators, and is the IdP's MFA accepted or is a local one imposed?
8. Which issuer trust framework (EBSI, BLUE, eIDAS Trusted Lists) is accepted, and who governs it?
9. Which credential format will be supported (W3C JWT-VC for EBSI or SD-JWT VC/mdoc for EUDI), and by when?
10. Who drafts the DPIA and the joint-controllership agreement, and what retention applies to attributes and logs?

---
**Sources:** [Packagist page of the module](https://packagist.org/packages/laarino/simplesamlphp-module-oid4vp) · [GitHub repository](https://github.com/LAArino/simplesamlphp-module-oid4vp) · [Keycloak 26.8](https://www.keycloak.org/2026/10/keycloak-2680-released) · [Skycloak on OID4VP in KC 26.8](https://skycloak.io/blog/keycloak-26-8-openid4vp-eudi-relying-party/) · [Keycloak/InCommon forum](https://forum.keycloak.org/t/integrating-keycloak-with-the-incommon-federation/11061) · [MyAcademicID IAM (GÉANT)](https://trustidentity.geant.org/myacademicid-iam/) · [ESI (SWITCH)](https://help.switch.ch/eduid/docs/unis/idm/identifiers/esi/) · [EducationalID, EBSI](https://ec.europa.eu/digital-building-blocks/sites/download/attachments/737411130/20240507_Educational_Identification_Sprint3_EBSI_BIG_Day_v1.0.pdf) · [Registration of RPs (eID Easy)](https://www.eideasy.com/blog/eudiw-relying-party-registration) · [eIDAS2 deadlines (Garrigues)](https://www.garrigues.com/en_GB/garrigues-digital/european-digital-identity-wallet-now-has-timetable-tasks-be-completed-december)
