<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Controller–processor contract checklist (GDPR art. 28): Aurora Foundation and URV

Checklist for negotiating the data processing agreement under which **Universitat Rovira i Virgili (URV)** hosts and operates OECP on behalf of the **Aurora Foundation** [DL 2]. It does not replace a contract template: use the one the parties' legal services prefer (for example the European Commission's standard contractual clauses for art. 28, Implementing Decision (EU) 2021/915) and check each item here against it. Section B lists the items of the bilateral access agreements with harvested partners [DL 14].

Tick each item when the contract covers it, and note the clause.

## A. Contract between the Aurora Foundation (controller) and URV (processor)

### A.1 Parties and subject matter (art. 28(3), first sentence)

- [ ] Parties, representatives and signatories: `[TO COMPLETE]`.
- [ ] Subject matter: hosting and operation of the OECP deployment for the Aurora alliance ([runbook](runbook.md), topology).
- [ ] Duration: `[TO COMPLETE: start date, term, renewal]`.
- [ ] Nature and purposes: the processing activities 1–6 and 8 of the [RoPA](ropa.md).
- [ ] Types of personal data and categories of data subjects: as in the RoPA (administrators, invited persons, instructors, staff behind contact mailboxes, visitors in technical logs).
- [ ] Obligations and rights of the controller (art. 28(3), first sentence; art. 24).

### A.2 Mandatory clauses, art. 28(3)(a)–(h)

| Item | Content to agree | Clause |
|---|---|---|
| (a) Documented instructions | The controller's instructions are: run OECP as documented in the release in use and in the runbook; apply the configuration decided by the controller (retention values, `OECP_PUBLISH_RULE`, `OECP_DORMANCY_DRY_RUN`, partner approvals); no other use of the data. Channel for further instructions: `[TO COMPLETE]`. The processor informs the controller if an instruction infringes data protection law (art. 28(3), last subparagraph). Transfers outside the EEA only on instruction | `[TO COMPLETE]` |
| (b) Confidentiality | Every person with access (system administrators, DBAs, backup operators) bound by confidentiality; list of roles with access `[TO COMPLETE]` | `[TO COMPLETE]` |
| (c) Security (art. 32) | Annex of technical and organisational measures: the measures of spec §10 and the [RoPA](ropa.md) (TLS, MFA for administrators, encrypted partner credentials, Docker secrets, RBAC, IP allowlist of the Keycloak console, rate limits, retention jobs, minimisation), plus the processor's infrastructure measures (physical security, patching, host hardening, network segmentation, monitoring, backups) `[TO COMPLETE]`. Whether the Spanish National Security Framework (ENS) applies to this system and at which category: `[TO COMPLETE: URV]` | `[TO COMPLETE]` |
| (d) Sub-processors | Prior specific or general written authorisation; current list in A.3; notice period for changes `[TO COMPLETE]`; same obligations flowed down (art. 28(4)) | `[TO COMPLETE]` |
| (e) Assistance with data subject rights | URV runs the technical steps on request: export or delete rows, purge history rows of a person, delete a Keycloak account (DPIA R5); response time `[TO COMPLETE: e.g. 5 working days]` so the controller can answer within one month (art. 12(3)) | `[TO COMPLETE]` |
| (f) Assistance with art. 32–36 | Security, breach notification (A.5), DPIA (provide facts and measures), prior consultation if needed | `[TO COMPLETE]` |
| (g) Deletion or return at the end | At the end of the service, at the controller's choice: return (database dumps of `oecp` and `keycloak`, `uploads` volume, CSV and OEAPI exports from `/oeapi/v5`) and/or deletion of databases, volumes, secrets and backups, within `[TO COMPLETE]` days, with a written certificate; backups deleted when their retention expires `[TO COMPLETE: maximum]` | `[TO COMPLETE]` |
| (h) Demonstrating compliance and audits | Information on request; audits and inspections by the controller or an auditor it mandates, with notice `[TO COMPLETE]`; costs `[TO COMPLETE]`; existing certifications or reports accepted as evidence `[TO COMPLETE]` | `[TO COMPLETE]` |

### A.3 Sub-processors

As built, OECP itself uses **no sub-processor**: every service runs in the Compose deployment on the processor's hosts. Check each item:

- [ ] **Container images** pulled from public registries (Docker Hub, Quay) are software supplied to URV, not services that process personal data: they are **not** sub-processors. The supply chain is a security matter (pin digests, scan images: spec §10, runbook).
- [ ] **Hosting infrastructure**: in-house data centre of URV, or a cloud or colocation provider `[TO COMPLETE]`. An external provider with access to the hosts or the disks **is** a sub-processor.
- [ ] **Backup site**: in-house or external `[TO COMPLETE]`. An external backup site or storage service **is** a sub-processor; state its location.
- [ ] **Mail relay**: URV's institutional relay `[TO COMPLETE]`; an external mail service would be a sub-processor (it carries invitation e-mails).
- [ ] **Certificate authority** (ACME, e.g. Let's Encrypt): receives only host names and the operator's contact e-mail; not a sub-processor for the data in this contract.
- [ ] **Federation metadata** (eduGAIN, national federation): OECP downloads public metadata; no personal data is sent.
- [ ] **SURFeduhub** (fallback access mode, spec §6.2.2), if used: it relays partner course data. Qualification `[TO COMPLETE: used or not; role]`.
- [ ] **Remote support** by any third party (contractors, the OECP maintainers): `[TO COMPLETE: none, or listed with their access]`.

### A.4 Processor's other obligations

- [ ] Record of the categories of processing carried out for the controller (art. 30(2)).
- [ ] Designated DPO of URV and contact (art. 37): `[TO COMPLETE]`.
- [ ] Data stays in `[TO COMPLETE: country]`; no transfer outside the EEA without instruction and a chapter V safeguard.
- [ ] Changes of the deployment that affect personal data (new release with new data, new log pipeline, new hosting) announced to the controller in advance: `[TO COMPLETE: notice period]`.
- [ ] Upgrades follow [RELEASING.md](../RELEASING.md) (backup, migrate, then images); the processor keeps the deployed version current with the supported minor version.
- [ ] Retention jobs kept running and checked weekly; failures reported to the controller (runbook, monitoring).

### A.5 Personal data breaches (art. 33, 34)

- [ ] The processor notifies the controller **without undue delay** after becoming aware of a breach (art. 33(2)); target `[TO COMPLETE: e.g. 24 hours]`, so the controller can notify the supervisory authority **within 72 hours** (art. 33(1)).
- [ ] Content of the processor's notice: nature, categories and approximate numbers of data subjects and records, likely consequences, measures taken or proposed, contact point (art. 33(3)); information may be given in phases (art. 33(4)).
- [ ] Notification path: URV security team `[TO COMPLETE]` → Foundation contact `[TO COMPLETE]` → Foundation DPO → lead supervisory authority `[TO COMPLETE: authority competent for the Aurora Foundation]`; data subjects informed by the controller if the risk is high (art. 34). URV's own obligations, if any, towards its authorities `[TO COMPLETE]`.
- [ ] Partners informed when their staff or their data are affected: `[TO COMPLETE]`.
- [ ] The processor keeps a log of incidents and assists the controller's breach register (art. 33(5)).
- [ ] Typical OECP incidents and first actions: [runbook](runbook.md), "Incident response".

### A.6 Contacts

| Role | Foundation | URV |
|---|---|---|
| Contract owner | `[TO COMPLETE]` | `[TO COMPLETE]` |
| DPO | `[TO COMPLETE]` | `[TO COMPLETE]` |
| Security / breach contact (24/7?) | `[TO COMPLETE]` | `[TO COMPLETE]` |
| Operations | `[TO COMPLETE]` | `[TO COMPLETE]` |

## B. Access agreement with each harvested partner

For UIBK, UICE, VUA and UDE, and any later partner harvested through OEAPI [DL 13, DL 14]. Process: [Guide B, step 2](../onboarding/partner-with-oeapi.md#2-sign-the-access-agreement). One agreement per partner; sign it before the partner's host is approved.

- [ ] **Parties**: the partner university and the Aurora Foundation (controller of the catalogue); the role of each for the republished data `[TO COMPLETE: independent controllers or joint controllers (art. 26), with the arrangement if joint]`.
- [ ] **Consent to republish eduXchange-tagged data**: the partner agrees that data it exposes under its eduXchange consumer profile is reused in the OECP catalogue and served through the anonymous `/oeapi/v5` read API (spec §10 "eduXchange data reuse").
- [ ] **No onward serving to eduXchange**: OECP answers `consumer=eduxchange` with an empty page [DL 19]; eduXchange keeps harvesting the partner directly.
- [ ] **Scope**: consumer profile used (default `eduxchange`), which courses (all tagged, or a subset), harvest schedule (default daily).
- [ ] **Personal data**: instructors are taken only from coordinators the endpoint returns with names; the partner confirms these names are already public in its own catalogue for the same courses and that its staff are informed (art. 14) [DL 21 a]. Contact e-mails are functional mailboxes [DL 18 c]. Raw source documents are kept 12 months for diagnosis.
- [ ] **Credential**: who issues it, how it is transmitted (never by plain e-mail), rotation interval `[TO COMPLETE]`, immediate revocation on request; OECP stores it encrypted (ADR-0008).
- [ ] **Network**: OECP's outbound IP address on the partner's allowlist; host approval by the alliance through a trusted channel (ADR-0009).
- [ ] **Corrections and withdrawals**: the partner corrects at source; courses missing from complete harvests are withdrawn after `withdraw_after_absences` runs (default 3, ADR-0015); urgent removals through the alliance contact.
- [ ] **Rights requests and breaches**: each party forwards requests concerning the other's data within `[TO COMPLETE]` days; breach information between the parties `[TO COMPLETE]`.
- [ ] **Contacts**: technical and data protection contacts on both sides.
- [ ] **Term and exit**: duration, notice, what happens to the harvested data on exit (withdrawal from the catalogue, history kept up to 12 months, or deleted on request) `[TO COMPLETE]`.
