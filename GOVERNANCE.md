<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Governance

This document describes how the Open European Campus Portal (OECP) project is
run, how decisions are made and how an alliance adopts the software.

## Roles

### Maintainer

The project is maintained by its author, **Lluís Alfons Ariño**, who released
the code under EUPL-1.2 ([docs/decisions-log.md](docs/decisions-log.md),
row 2). The maintainer:

- reviews and merges pull requests;
- facilitates and records decisions as ADRs;
- manages releases, the changelog and security advisories;
- enforces the [Code of Conduct](CODE_OF_CONDUCT.md).

Further maintainers may be appointed by the existing maintainers from among
regular contributors, through an ADR or a pull request to this file, under the
decision process below. The list of maintainers is kept in this file.

### Contributors

Anyone who submits issues, pull requests, reviews or documentation under the
rules in [CONTRIBUTING.md](CONTRIBUTING.md) (DCO sign-off, inbound = outbound
EUPL-1.2, no CLA).

### Adopting alliances

European University alliances that deploy OECP. They do not gain decision
rights over the project by deploying it, but are encouraged to contribute
and to take part in discussions.

## Decision process

1. **Routine changes** (bug fixes, documentation, refactoring, dependency
   updates) are decided by maintainer review of the pull request.
2. **Significant decisions** (architecture, dependencies, data model and
   schemas, public API contracts, identity, security, licensing, governance)
   are recorded as **Architecture Decision Records** in
   [docs/adr/](docs/adr/) using the MADR template; see
   [docs/adr/README.md](docs/adr/README.md).
3. **Lazy consensus.** An ADR pull request is open for comment for at least
   **7 calendar days**. If no maintainer or contributor raises a reasoned
   objection in that period, the ADR is accepted and merged. Objections are
   addressed in the discussion by revising the ADR, rejecting it, or
   recording the dissent under its consequences.
4. **Tie-breaking.** If consensus cannot be reached, the maintainers decide
   by simple majority; while there is a single maintainer, that maintainer
   decides and records the reasoning in the ADR.
5. **Urgent security fixes** may be merged without waiting for the comment
   period; they are documented afterwards.

Any change to this document, to the project licence or to the ownership of
the repository is a significant decision and follows the ADR process.

## How an alliance adopts and deploys OECP

OECP is alliance-agnostic: one deployment serves one alliance, and
everything specific to an alliance is configuration, not code
([docs/spec-v4.0.md](docs/spec-v4.0.md) §1, §10). The usual path is:

1. **Assign responsibilities.** Decide which legal entity acts as GDPR
   controller and which hosts the service as processor, and sign an art. 28
   GDPR contract between them; carry out the DPIA and keep the records of
   processing before go-live (spec §10). For the first deployment, Aurora
   Foundation is controller and URV is processor
   ([decisions log](docs/decisions-log.md), row 2).
2. **Deploy** with the reference Docker Compose deployment in
   `deploy/compose` (MVP) or the Helm chart in `deploy/helm` (v1), without
   forking the code.
3. **Configure the alliance:** partner organizations and sub-units, domains,
   logos, colours, theme tokens and UI languages through the `organizations`
   table, the Keycloak realm and the Nuxt runtime configuration (spec §1).
4. **Register the identity service provider** in the hosting institution's
   national federation with eduGAIN export and the required entity
   categories, and add one SAML IdP per partner (spec §4).
5. **Onboard partners** channel by channel: OEAPI harvesting for partners
   with an endpoint (with a bilateral access agreement and credential), CSV
   or web form for the others (spec §6).
6. **Comply with the EUPL.** Operating a modified version as a network
   service obliges the operator to publish the source code of that version.
   Contributing changes upstream avoids maintaining a divergent copy.

Adopting alliances are asked to tell the maintainers about their deployment
so that their needs can inform the roadmap.

## Roadmap

The roadmap is the delivery-phase plan in
[docs/spec-v4.0.md §12](docs/spec-v4.0.md#12-delivery-phases): an MVP
(public portal, `/oeapi/v5`, OEAPI v5 harvesting, CSV and form channels,
Keycloak SAML with MFA, Docker Compose), then v1 (OEAPI v6, Helm, OpenBao,
partner UI languages and more) and v2 (wallet login, EWP Courses API,
analytics, ELM/LOQ export). Changes to the roadmap are significant decisions
and follow the ADR process.
