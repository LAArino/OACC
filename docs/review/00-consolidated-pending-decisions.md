<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# OECP v3.0: consolidated review and pending decisions

> Translated from the Spanish original on 2026-10-15; the Spanish text is in the Git history of this file. Quotations of specification v3.0 are translated from its Spanish original ([archived](../archive/spec-v3.0-original.es.md)).

Date: 2026-10-14. Source: three independent reviews (identity, data model and ingestion, architecture/stack/licences) in this folder, validated from the main session. Where I have checked a statement directly myself it is marked **[verified]**; the rest comes from the partial reports with their sources.

## 1. Short verdict

The idea is sound and the scope is the right one for an alliance. But specification v3.0 cannot be programmed yet: it has open "A or B" decisions, an identity layer more ambitious than the MVP needs, a data model that lacks the tables on which the interface it describes depends, and several technical statements that do not hold as written.

Recommendation: settle the decisions of section 4, rewrite the spec as v4.0 (in English) and start with an MVP without a wallet and with only OEAPI v5 harvest + CSV + form.

## 2. Findings that change the specification

### 2.1 Identity

- **The `simplesamlphp-module-oid4vp` module is yours** (LAArino, EUPL-1.2, v1.0.0 of September 2026, last push 2026-10-08) **[verified]**. The spec presents it as an external "open-source" component; it should say that it is part of the project, because that changes how the maintenance risk (a single maintainer) and the audit risk (no external audit) are read.
- **Two security flaws in `PresentationVerifier.php` [verified by reading `main`]:**
  1. The issuer key is resolved from the `kid` in the VC header (any `did:key` will do) and trust is then checked against the `iss` claim. Nothing requires the DID of the `kid` to be that of `iss`. An attacker can sign a VC with their own key and put the DID of a trusted university as `iss`.
  2. There is no holder binding: nothing checks that the signer of the VP matches `credentialSubject.id`, so a stolen VC can be presented from another wallet.
  In addition, only the first VC is processed, `exp` of the VP is optional, `did:web` resolution and the Universal Resolver make outgoing requests to URLs controlled by whoever presents (SSRF), and without a trust list the module accepts any issuer in "development mode".
- **The spec describes something the module does not do.** It accepts only W3C VCs in JWT (ES256, DIDs); SD-JWT VC, DCQL and `direct_post.jwt` are listed as planned. The national EUDI wallets (ARF/HAIP) require SD-JWT VC or mdoc, a client identified by X.509 and an RP registration certificate. Today the module fits the EBSI/BLUE ecosystem, not "the EUDI Wallet". The text "W3C VC (SD-JWT / JWT)" mixes two different formats.
- **Keycloak 26.8 (2026-10-01) already ships an experimental OID4VP verifier** with SD-JWT VC and DCQL. It is not production-ready, but it changes the justification of section 2.
- **No academic credential proves "admin of University X".** EducationalID, AllianceID and MyAcademicID attest identity or affiliation. Administration roles must be assigned locally, and the `uni_valencia_admin` model (one role per university) does not scale: a `partner_admin` role plus an `organization_id` claim is better.
- **MyAcademicID** is above all GÉANT's IAM proxy for Erasmus+/ESCI, not a "DC4EU credential framework". The ESI is released only for active students, so it is of no use for the staff of the panel.
- **simpleSAMLphp is unnecessary for the MVP.** The panel is used by the managers of 9 or 10 partners, not by the whole of eduGAIN. Keycloak alone, with one SAML IdP per partner and local MFA, is enough. The contract with the backend is the Keycloak JWT, so the proxy with OID4VP (or Keycloak's native verifier when it matures) can be added later as one more IdP.
- **Missing:** registration of the SP in the national federation with entity categories (REFEDS Personalized + CoCo v2 + Sirtfi), a stable identifier (`subject-id`/`pairwise-id`, not ePPN), the flow for adding and removing administrators and the bootstrap of the first global admin, an MFA policy, session times and propagated logout, a DPIA and a joint-controllership agreement (GDPR art. 26), and the explicit statement that the public portal does not go through Keycloak.

### 2.2 Data model and ingestion

- **Name and versions.** OEAPI and OOAPI are the same SURF standard; the current name is OEAPI. The stable version is v5.0; v6.0 is a release candidate (`v6.0-rc.3`, 2026-09-30) and breaks compatibility with v5 (it removes `educationSpecifications`, renames resources, adds `offeringState`). v4 is legacy. The ingestor should be planned as **v5 + v6**, not v4 + v5. Use one name throughout the document, including the enum and the routes.
- **OEAPI is pull.** Each university serves it with paginated GETs, without webhooks or a delta parameter. A "push" route `/api/v1/ingest/ooapi/v5` needs a contract of its own that the spec does not define. Recommendation: Channel A is a scheduled harvester; push is at most a notification that triggers a harvest. Withdrawals can only be detected by absence in a complete harvest.
- **The delivery-mode ENUM does not match OEAPI** (v5: `distance-learning`, `on campus`, `online`, `hybrid`, `situated`; v6: `blended`, `coil`, `hybrid`, `online`, `presential`, extensible). No source distinguishes synchronous from asynchronous, so that filter would have no data.
- **Languages:** OEAPI v5 uses three-letter ISO 639-2 and texts as arrays typed by BCP 47 language; the spec uses ISO 639-1 and two fixed columns. An explicit mapping and a real multilingual structure (a `course_texts` table or JSONB per language) are needed. `title_en NOT NULL` excludes partners without English.
- **SQL blockers:** there is no `organizations` table (with hierarchy, SCHAC, Erasmus code, PIC); there is no `UNIQUE (organization_id, ext_id)` nor `UNIQUE (course_id, ext_offering_id)`, so every re-ingestion duplicates; the PKs are VARCHAR with no generation rule; there is no lifecycle state or soft delete, so a partner cannot unpublish; `ON DELETE CASCADE` silently deletes offerings.
- **Tables that the UI presupposes and that do not exist:** `partner_integrations` (channel, endpoint, version, credentials in a vault), `sync_runs`, `sync_errors`, `academic_sessions`. Without them there is no history monitor, no synchronisation configuration, no traffic light and no deprecation by version.
- **Fields that the public course page needs and that are missing:** application URL, keywords, level (bachelor/master, EQF), assessment, hours, contact, campus, `enrollStartDate`, time zone. The "remaining seats" have no source: OEAPI offers `enrolledNumberStudents`; it has to be brought in with a freshness timestamp, or the promise withdrawn.
- **ELM** is not limited to credentials: the LOQ profile covers learning opportunities. The "alignment" only counts if an export to LOQ is defined. **ISCED-F** needs a CHECK, a multilingual reference table and multi-value support.
- **EWP Courses API** is a catalogue channel that many partners have even when they have no OEAPI; the spec ignores it.
- **Search:** decide on PostgreSQL (tsvector per language + pg_trgm + unaccent; Catalan has no stemmer out of the box) or a dedicated engine. The current schema constrains both options.

### 2.3 Architecture, stack and licences

- **Kong no longer keeps the promise of section 6:** the code is still Apache 2.0, but since 3.10 (March 2025) there are no OSS images and no free mode, and plugins such as OIDC are paid. Recommendation: **Traefik**.
- **Recommended A/B decisions:** NestJS (TypeScript end to end, the same Zod schema in browser and server for the CSV validator), Vue 3 + Nuxt (SSR for catalogue SEO, low learning curve), Traefik. FastAPI is valid if the team is a Python team; what matters is to decide.
- **The licence table mixes two things:** deploying Keycloak, Traefik or PostgreSQL without modifying them does not create a derivative work; only what is modified (themes, SPIs, forks) matters. simpleSAMLphp is LGPL-2.1-or-later. EUPL has a network clause: whoever deploys a modified version must publish its code. When extending the stack: Valkey instead of Redis, OpenBao instead of Vault.
- **Governance:** DCO (not a CLA), Contributor Covenant, SECURITY.md, GOVERNANCE.md, `publiccode.yml`, REUSE/SPDX. Ownership of the repository and the trademark: the legal entity of the alliance or a coordinating university, with a signed agreement. Check that the Erasmus+ grant agreement allows EUPL.
- **Missing non-functional requirements:** hosting and operation, SLO/RPO/RTO, backups with PITR, observability, GDPR (controller/processor, retention of the JSONB, record of processing activities), accessibility (Directive 2016/2102 requires EN 301 549 = WCAG 2.1 AA; aim for 2.2), i18n of the interface (not only of the content), a public OEAPI v5 read API so that others can harvest the catalogue, JSON-LD schema.org/Course, security (OWASP ASVS L2, encrypted partner keys, CSV injection, rate limiting, an allowlist of destinations to avoid SSRF), contract tests against the OEAPI OpenAPI.
- **Architecture:** a search engine, a job queue, a harvest scheduler, file storage and e-mail are missing. "Independent containers" and "ACL inside the Backend Core" contradict each other: a modular monolith is better. There is no machine-to-machine authentication for the push channel.

## 3. Proposed phases

| Phase | Includes | Deferred because |
|---|---|---|
| MVP | Public catalogue (PG FTS, filters, course page), public OEAPI v5 read API, panel with form and CSV, Keycloak with SAML per partner and RBAC per organization, MFA, Docker Compose, WCAG AA, UI in EN + one language | |
| v1 | OEAPI v5 harvester (and v6 when it leaves RC), synchronisation monitor, organization management, observability, Helm, dedicated search engine if PG is not enough | Depends on which partners have a real API |
| v2 | Wallet (OID4VP via SSP or native Keycloak), EWP Courses API, OEAPI v4 if a partner requires it, version console, analytics, ELM/LOQ export | The wallet adds little to a staff panel with an institutional IdP, and the module needs the fixes of 2.1 and SD-JWT VC before production |

## 4. Decisions you must take before writing code

Ordered by impact. Each one blocks something specific.

1. **MVP scope:** without a wallet and without OEAPI v4, with Keycloak alone? Blocks the whole identity architecture.
2. **Ownership and GDPR:** which legal entity owns the code and the trademark, is the controller, and is the RP registered under eIDAS2 when the time comes? Blocks licences, the DPIA and the registration of the SP in eduGAIN.
3. **Channel A, pull or push:** scheduled harvest of each partner's OEAPI, or does someone send payloads? If push, who, and with what contract? Blocks the design of the ACL.
4. **Partner inventory:** how many have OEAPI (v5 or v6), how many EWP, how many only CSV or form? Blocks the priority of the channels and whether EWP is included.
5. **Natural key and lifecycle:** what is the stable identifier of a course and an offering per organization, what states exist, and how does a partner unpublish from each channel? Blocks the schema.
6. **Multilingualism:** is English mandatory, or are courses published in the local language only, with what fallback, and how many languages per partner? Blocks the schema and search.
7. **Delivery-mode vocabulary:** is that of OEAPI v6 adopted, or one of our own, and where would synchronous/asynchronous come from? Blocks the public filter and the CSV template.
8. **Remaining seats:** from the SIS via OEAPI, managed in the portal, or out of scope? Blocks the public course page.
9. **Roles and account creation:** who assigns and removes partner and global administrators, how is the first one created, is MFA required? Blocks Keycloak.
10. **Stack and team:** NestJS + Vue/Nuxt + Traefik, or FastAPI because the team is a Python team? Who hosts and operates, with what budget and SLO? Blocks the scaffolding.
11. **Language and governance of the project:** English in code, docs and issues, DCO with inbound = outbound EUPL-1.2, monorepo? Blocks the first commit.
12. **Mixed channels:** can an organization combine channels, and what prevails when an ingested value is edited by hand? Blocks the manual CRUD.

## 5. Immediate action independent of the portal

Fix in `simplesamlphp-module-oid4vp`, before any deployment: (a) require the DID of the VC's `kid` to match `iss`, or resolve the key from `iss` and not from the `kid`; (b) check that the DID of the VP signer matches `credentialSubject.id`; (c) block the mode without a trust list outside development; (d) restrict `did:web` resolution and the Universal Resolver to allowed domains; (e) make `exp` mandatory in the VP and explicitly process or reject VPs with several VCs.
