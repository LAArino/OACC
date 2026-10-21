<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Production documents: templates for going live

This folder holds the legal and operational documents an alliance needs before it runs OECP in production with real partner data. They address the backlog item "Docs: GDPR set (RoPA, DPIA, art. 28 contract checklist) and accessibility statement" and the go-live items of spec [§10](../spec-v4.1.md#10-non-functional-requirements) and [§12](../spec-v4.1.md#12-delivery-phases).

They are **templates and drafts**, written against release 0.3.0 (the runbook and the RoPA brought up to release 0.8.0) for the first deployment: the **Aurora alliance**, with the **Aurora Foundation as controller** and **Universitat Rovira i Virgili (URV) as processor** hosting the infrastructure [DL 2], and the partner universities as independent controllers of the data they supply [DL 24]. They describe what the software does, as built, so that legal and operations staff do not have to reverse-engineer it. They do not take legal decisions:

- Every value someone has to supply or decide is marked **`[TO COMPLETE: …]`**. Search for that string before signing anything.
- Where the law offers a choice (legal basis, retention beyond the defaults, supervisory authority), the documents list **candidates**; the controller chooses, with its data protection officer (DPO).
- Where the implementation does not yet match a target in the specification, the documents say so and point to the backlog item. Do not delete these notes to make a document look complete: fix the gap or record the accepted risk.

Since release 0.5.0 backups (pgBackRest with WAL archiving and a quarterly restore drill) and alerting (Prometheus, Alertmanager, Grafana) are implemented, and since 0.7.0 container logs are shipped to Loki (90 days, Traefik access log 30 days) and the expiry of partner IdP and TLS certificates is alerted; the [runbook](runbook.md) describes them in sections 3, 4, 7 and 10, which replace the interim procedures of the earlier drafts. The *Backups* entry of the [RoPA](ropa.md#8-backups) describes the 35-day pgBackRest window as built; the second site and its location remain `[TO COMPLETE]`.

Another alliance can reuse the set: replace the names of the Aurora Foundation, URV, the partners and the Spanish authorities, and re-check every statement against its own deployment.

## The documents

| Document | What it is | Legal reference |
|---|---|---|
| [ropa.md](ropa.md) | Record of processing activities: one entry per processing activity of OECP (administrators, invitations, logging, catalogue publication, ingestion, maintenance, backups), with purposes, legal basis candidates, data, recipients, transfers, retention and security measures | GDPR art. 30 |
| [dpia.md](dpia.md) | Data protection impact assessment outline: screening, description, necessity and proportionality, risk register, measures mapped to the implemented controls, residual risk, DPO opinion, sign-off | GDPR art. 35, 36 |
| [art28-processor-checklist.md](art28-processor-checklist.md) | Checklist for the controller–processor contract between the Aurora Foundation and URV, plus the items of the bilateral access agreements with harvested partners | GDPR art. 28, 32, 33 [DL 14] |
| [privacy-notice-draft.md](privacy-notice-draft.md) | Draft privacy notice for the Aurora pilot, built from the RoPA and the DPIA, for the Foundation to review, complete and publish at `/en/privacy` | GDPR art. 13, 14 |
| [accessibility-statement.md](accessibility-statement.md) | Accessibility statement template for the public portal and the administration panel | Directive (EU) 2016/2102, EN 301 549 |
| [accessibility-audit-2026-10.md](accessibility-audit-2026-10.md) | Accessibility audit of release 0.7.0 (October 2026): method, scope, findings with fixes, automated results before and after, the screen-reader session script and the known limitations for the statement | WCAG 2.1 AA, EN 301 549 |
| [runbook.md](runbook.md) | Production runbook: topology, secrets, backups and restore, upgrades, identity operations, monitoring, incidents, capacity, housekeeping | spec §3, §4, §10 |
| [acceptance-test-plan.md](acceptance-test-plan.md) | Acceptance test plan for release 0.10.0 at the Aurora pilot, run on the real server by people in the real roles: nine scenario groups (alliance and partner administration, CSV, web form, public portal and APIs, revocation, operations, accessibility) in local-account mode, with result tables, a defect log and a sign-off block | Guide A go-live checklist |
| [go-public-checklist.md](go-public-checklist.md) | GitHub settings and checks before making the repository public: history secret scan, data consent, screenshots, features, security settings, the `main` ruleset, description and topics, the releases afterwards | — |

A **privacy notice** (GDPR art. 13 and 14) is written for the public by the controller, from the RoPA; [privacy-notice-draft.md](privacy-notice-draft.md) is a draft for the Aurora pilot for the Foundation to review. The portal has no `/privacy` or `/accessibility` page in 0.10.0; since the release after 0.10.0 it serves both from the deployment's branding directory (`branding/privacy.en.md` and `branding/accessibility.en.md`, with a link in the footer, and a 404 until the English file exists). The privacy notice URL, `https://<portal host>/en/privacy`, is also what the federation registration of the service provider needs ([Guide A, step 3](../onboarding/alliance.md#3-identity)).

## Who completes what

| Role | In Aurora | Completes | Approves |
|---|---|---|---|
| **Controller** | Aurora Foundation | RoPA (purposes, legal basis, retention decisions, contacts); DPIA (screening decision, risk acceptance, sign-off); art. 28 contract (instructions, sub-processor approval, audit rights); access agreements with partners; accessibility statement (publisher, feedback contact) | Everything below, as the accountable party (art. 5(2), 24) |
| **Controller's DPO** | `[TO COMPLETE: DPO of the Aurora Foundation, or the person advising it if no DPO is designated (art. 37)]` | DPIA opinion (art. 35(2)); review of the RoPA and of the privacy notice | — |
| **Processor** | URV | Its own processor record (art. 30(2)); security measures and sub-processor list for the art. 28 contract; breach notification path; backup and restore evidence | Runbook contents for its infrastructure |
| **Processor's DPO** | `[TO COMPLETE: DPO of URV]` | Review of the art. 28 contract and of the security annex | — |
| **Hosting operator** | URV IT team `[TO COMPLETE: unit]` | Runbook (hosts, contacts, backup schedule, monitoring), the technical facts in the RoPA and the DPIA (retention as configured, measures as deployed) | — |
| **Partner universities** | UIBK, UICE, VUA, UDE (harvested) and URV, UNINA, UP, CBS, UPEC (manual channels) | Access agreement (harvested partners); confirmation that published instructor names and contact mailboxes match their own catalogues and their own privacy notices [DL 21 a] | Their part of the access agreement |
| **OECP maintainers** | Project owner | Keep these templates accurate for each release; answer technical questions | — |

The partner universities are **independent controllers**: each is responsible for the data it supplies (instructors, contacts) and the Aurora Foundation for the published catalogue; there is no joint controllership under art. 26 [DL 24]. Each bilateral access agreement records it (section B of the [art. 28 checklist](art28-processor-checklist.md#b-access-agreement-with-each-harvested-partner)).

## Order of work

The legal track takes one to three months; the technical track ([Guide A](../onboarding/alliance.md)) runs in parallel. Recommended order:

1. **Facts first.** The hosting operator reads the [runbook](runbook.md), fills its `[TO COMPLETE]` items for the target hosts (topology, backup site, contacts) and confirms the retention values actually configured. Everything else depends on these facts.
2. **RoPA.** The controller completes [ropa.md](ropa.md): legal basis per activity, retention decisions, recipients. The processor keeps its own record of the categories of processing it carries out on the Foundation's behalf (art. 30(2)); the RoPA entries give it the material.
3. **DPIA screening.** With the RoPA in hand, the controller and its DPO run the screening in [dpia.md](dpia.md). If a DPIA is carried out, complete it **before go-live** (art. 35(1): prior to the processing); consult the supervisory authority only if a high residual risk remains (art. 36).
4. **Art. 28 contract.** Negotiate the contract between the Foundation and URV with [art28-processor-checklist.md](art28-processor-checklist.md); attach the security measures of the DPIA and the runbook as the technical annex.
5. **Access agreements.** Sign one with each harvested partner before its harvest is enabled (section B of the checklist; [Guide B, step 2](../onboarding/partner-with-oeapi.md#2-sign-the-access-agreement)).
6. **Accessibility.** Run the screen-reader session of the [October 2026 audit](accessibility-audit-2026-10.md#7-what-remains-for-a-human-assistive-technology-session) and review the sign-in pages, then complete and publish [accessibility-statement.md](accessibility-statement.md).
7. **Privacy notice.** Complete and approve [privacy-notice-draft.md](privacy-notice-draft.md) from the RoPA, publish it as `branding/privacy.en.md` (the portal serves it at `/en/privacy`) and give that URL to the federation registration.
8. **Go-live review.** Tick the [Guide A go-live checklist](../onboarding/alliance.md#go-live-checklist); re-run the restore drill of the runbook.

## Keeping the documents current

Review the set at least once a year and whenever one of these happens: a new OECP minor release (check its CHANGELOG for new personal data, new retention jobs or new environment variables), a new partner or a new channel for a partner, the first connected partner identity provider, a change of hosting (including a new backup site), Phase 2 (wallet login, spec §4), or a data breach. Record each review in the table below.

| Date | Reviewed by | Release | Changes |
|---|---|---|---|
| `[TO COMPLETE]` | `[TO COMPLETE]` | 0.3.0 | First completion of the templates |
