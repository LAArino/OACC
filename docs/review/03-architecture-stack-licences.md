<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Critical review of OECP v3.0: architecture, stack, licences and project definition

> Translated from the Spanish original on 2026-10-15; the Spanish text is in the Git history of this file. Quotations of specification v3.0 are translated from its Spanish original ([archived](../archive/spec-v3.0-original.es.md)).

## 0. Architecture gaps (section 1)

- **Missing components:** search engine (the "real-time autocompletion" requires choosing between PostgreSQL FTS and a dedicated engine), a job queue for the CSV, a *harvesting* scheduler, file storage and e-mail.
- **Monolith or microservices:** the text says "independent containers", but the diagram puts the ACL inside the Backend Core. I recommend a **modular monolith**.
- **No machine-to-machine authentication** for the *push* channel (API key, OAuth2 *client credentials* or mTLS).
- **Contradiction:** "indexes in real time" does not fit with periodic *harvesting*.
- **Data lifecycle undefined:** draft/published, courses that disappear from the source, conflicts between channels and the source of the "remaining seats".
- **High operational load for a small team:** Java, PHP, Node/Python and PostgreSQL at the same time.

## 1. "A or B" decisions to close before writing code

**Backend: NestJS (TypeScript).** The spec requires validating the CSV in the browser and on the server: with TypeScript end to end, the same Zod schema, the canonical model and the OEAPI DTOs serve on both sides, with a single language, one toolchain and one CI. NestJS's opinionated structure gives coherence when several universities contribute. FastAPI is just as valid if the team already masters Python; what matters is to decide.

**Frontend: Vue 3 + Nuxt.** A lower learning curve for university IT staff who contribute occasionally; official router, state (Pinia) and i18n; Nuxt provides the SSR that catalogue SEO needs. All MIT. Accessibility depends on choosing a proven component library (for example, Reka UI).

**Gateway: Traefik Proxy (MIT).**
- Native discovery in Docker and Kubernetes, automatic TLS, *rate limiting* and ForwardAuth without a database of its own. The architecture does not need Kong's API management.
- **A nuance on Kong:** the Kong Gateway OSS code is still Apache 2.0, but since 3.10 (March 2025) there are no prebuilt OSS images and *free mode* has disappeared. There is no official announcement; the community, Supabase and a FOLIO ADR confirm it. Plugins such as OIDC are paid. Kong would force us to build the code ourselves or move to a commercial tier, exactly what section 6 promises to avoid.

## 2. Licences

- **Compatibility:** MIT, Apache 2.0, LGPL and the PostgreSQL License are permissive or weak copyleft; they can be incorporated into an EUPL work or linked with it. The list of compatible licences in the EUPL appendix (GPL-2.0/3.0, AGPL-3.0, LGPL-2.1/3.0, MPL-2.0, EPL, OSL-3.0, CeCILL, LiLiQ, CC BY-SA 3.0 for data) governs something else: **redistributing a combined EUPL work under another licence**. Deploying Keycloak, Traefik or PostgreSQL without modifying them does not create a derivative work; only what is **modified** does (Keycloak themes or SPIs, modules, *forks*). **The table of section 6 mixes the two** and must separate "deployed dependency" from "derived code".
- **simpleSAMLphp:** it is **LGPL-2.1-or-later** (with bundled libraries under other licences, such as xmlseclibs under BSD); the document only says "LGPL".
- **simplesamlphp-module-oid4vp:** **EUPL-1.2** (Packagist, LAArino). It is at v1.0.0 and has almost no adoption, so there is a *bus factor* risk. It should stay in its own repository.
- **Contributing to Apache 2.0 projects:** patches to Keycloak are contributed under Apache 2.0. There is a problem only if they start as EUPL code with several authors, so they are best developed directly in the upstream repository.
- **EUPL has a network clause:** giving access to the essential functionalities counts as distribution, so whoever deploys a modified version must publish its code. This should be said explicitly.
- **Care when extending the stack:** better **Valkey** (BSD) than Redis (RSAL/SSPL/AGPL) and **OpenBao** (MPL-2.0) than Vault (BUSL). Grafana and Loki are AGPL, no problem if they are not modified.
- **Governance:**
  - **DCO** instead of a CLA (*inbound = outbound* EUPL-1.2); a CLA is only needed to be able to change the licence.
  - Contributor Covenant 2.1, SECURITY.md, GOVERNANCE.md, `publiccode.yml` and REUSE/SPDX.
  - **Ownership:** the repository and the trademark should belong to the **legal entity of the alliance** or, if there is none, to a coordinating university with a signed agreement.
  - Check that the Erasmus+ *grant agreement* allows publication under EUPL.

## 3. Missing non-functional requirements

- **Hosting:** who hosts? One instance per alliance or multi-alliance? I recommend **one deployment per alliance** with several organizations inside it.
- **Deployment:** Docker Compose as the reference in the MVP and Helm in v1.
- **Continuity:** set an SLO (for example, 99.5 %), RPO/RTO, PostgreSQL *backups* with PITR and restore tests. Plan for peaks near the *application deadlines*.
- **Observability:** OpenTelemetry, Prometheus/Grafana and centralised logs. The partners' "traffic light" needs real metrics.
- **GDPR:** there is personal data (administrator attributes, audit and probably teaching staff inside `raw_payload`). The following must be defined: the **controller** (the alliance's entity, or joint controllers under art. 26), the **processor** (*hosting*, with a DPA under art. 28), retention of the JSONB and the record of processing activities (art. 30). Public analytics must be cookieless or use self-hosted Matomo.
- **Accessibility:** Directive (EU) 2016/2102 requires public universities to comply with EN 301 549, that is, **WCAG 2.1 AA**, with an accessibility statement and a complaints mechanism. I recommend aiming for WCAG 2.2 right away.
- **i18n of the interface:** the spec covers the languages of the content, not those of the interface. The languages, the fallback language and who translates (for example, with Weblate) remain to be decided.
- **Open data and SEO:** expose a **public read API compatible with OEAPI v5** so that eduXchange, SURFeduhub or other alliances can harvest the catalogue. Consider ELM export and the EWP *Courses API*. Add JSON-LD schema.org/Course and a sitemap.
- **Security:** target OWASP ASVS L2; encrypted partner keys (OpenBao or pgcrypto); CSV limits and protection against CSV injection; *rate limiting* of the search engine in Traefik; SBOM, Renovate and SAST.
- **Quality:** unit tests of the *transformers*, contract tests against the OEAPI OpenAPI, E2E and a11y with axe; CI/CD with image signing.

## 4. Scope by phase

| Phase | Includes | Deferred because… |
|---|---|---|
| **MVP** | Public catalogue (search with PG FTS, filters, course page); panel with form (C) and CSV (B); Keycloak with institutional SAML/eduGAIN login and RBAC per organization; public OEAPI v5 API (read); Compose; WCAG AA; interface in EN and one more language | — |
| **v1** | OEAPI **v5** *ingest* (pull + push); synchronisation monitor; organization management; observability; Helm; dedicated search engine if PG is not enough | Depends on the partners having a real API |
| **v2** | EUDI wallet/OID4VP; OEAPI **v4**; version console; analytics dashboard; ELM/EWP export | The **wallet** adds little to a *staff* panel that already has an institutional IdP, and the ecosystem of academic attestations is still maturing. **v4** is a version older than the current one (v5): it is justified only if a specific partner needs it. **Analytics** blocks no one |

## 5. Definition of the repository and the project

- **Monorepo:** `apps/api`, `apps/web` (Nuxt with public and admin *layers*), `packages/schemas` (canonical model, OEAPI DTOs, CSV template), `identity/keycloak`, `identity/simplesamlphp` (configuration only), `deploy/compose`, `deploy/helm`, `docs/adr`. The OID4VP module stays in its own repository.
- **ADRs** in MADR format; the three decisions of section 1 would be ADR-0001 to 0003.
- **Language:** **English** in the code, the documentation, the ADRs and the *issues*, because that is what makes an EUPL project transferable. User guides can be translated later.
- **Naming:** the standard is now called **Open Education API (OEAPI)**, formerly OOAPI. The document mixes both names, including the `ooapi_v4` enum and the `/ooapi/` routes: unify on "OEAPI". It also mixes "W3C-VC" with SD-JWT.
- **Missing:** a *product owner*, team, budget, timeline, partner inventory (who has an API and of which version), success metrics, support model and responsibility for the accuracy of the content.

## 6. Questions the owner must answer before programming

1. Which legal entity owns the code, the repository and the OECP trademark, and who acts as controller under the GDPR?
2. Who hosts and operates the production instance, with what budget and with what SLO, RPO and RTO?
3. What technical profile does the real team have, to confirm NestJS + Vue/Nuxt + Traefik?
4. How many partners expose an OEAPI today, of which version, and who will use CSV or the form?
5. Should OECP publish its own catalogue as an OEAPI v5 read API so that others can harvest it?
6. Can the MVP do without the EUDI wallet and OEAPI v4?
7. What data freshness is required, above all for the seats, and who answers for their accuracy?
8. Which interface languages are mandatory at launch, and who maintains the translations?
9. Is a draft, review and publication flow needed, or does each partner publish directly?
10. Are DCO with *inbound = outbound* EUPL-1.2 and English as the project language accepted?

---

**Sources:** [Kong #14405](https://github.com/Kong/kong/discussions/14405) · [Supabase changelog](https://supabase.com/changelog/48048-self-hosted-supabase-envoy-becomes-the-default-api-gateway-breaking-change.md) · [FOLIO DR-000045](https://folio-org.atlassian.net/wiki/spaces/TC/pages/1464008822) · [simpleSAMLphp COPYING](https://e.math.cornell.edu/lib/simplesamlphp/COPYING) · [oid4vp on Packagist](https://packagist.org/packages/laarino/simplesamlphp-module-oid4vp) · [EUPL v1.2](https://interoperable-europe.ec.europa.eu/sites/default/files/distribution/access_url/2024-10/e5101c2c-40b6-428e-a16e-a6ac9ade8a01/EUPL_v1.2.pdf) · [EUPL overview 2020](https://interoperable-europe.ec.europa.eu/sites/default/files/news/2020-12/EUPL%20overview%202020.pdf) · [UOC, accessibility](https://www.uoc.edu/en/accessibility) · [OEAPI specification](https://github.com/open-education-api/specification) · [GÉANT](https://connect.geant.org/2026/06/17/towards-an-interoperable-european-education-area)
