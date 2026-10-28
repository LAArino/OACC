<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Onboarding to OACC

These guides take an alliance and its universities from "we want a shared course catalogue" to "our courses are published and stay current". They describe **release 0.11** as it is. Where something is planned but not built, they say so ("not yet available in 0.11"). The as-built specification is [spec v4.1](../spec-v4.1.md); the decisions behind these guides are rows 2, 3, 4, 12, 13, 14, 15, 17, 22, 24 and 25 of the [decisions log](../decisions-log.md).

> **Before you start**
>
> - Know your role: alliance (Foundation or secretariat), hosting operator, partner admin (the person responsible for a university's course data) or partner IT.
> - Know how your university can deliver course data today: an OEAPI v5 endpoint, an export from the student information system (SIS), or only people and spreadsheets.
> - OACC never handles applications and stores no student data. It publishes course and offering descriptions.

## Which guide should I read?

```
Are you the IT team that installs and runs the server for the alliance?
├── Yes → Guide E: hosting-operator.md
│         (then Guide A, steps 3–6, together with the alliance)
└── No
    │
    Are you setting up OACC for the whole alliance (governance, identity, organizations)?
    ├── Yes → Guide A: alliance.md
    └── No, I represent one university
        │
        Does your university already run an OEAPI v5 endpoint
        (for example the one eduXchange harvests)?
        ├── Yes → Guide B: partner-with-oeapi.md
        └── No
            │
            Does your IT team have time to build or schedule an integration
            (a few days to a few weeks)?
            ├── Yes → Guide C: partner-with-integration-capacity.md
            │         (build an OEAPI endpoint, then Guide B;
            │          or generate the CSV files automatically)
            └── No  → Guide D: partner-manual.md
                      (web form and hand-made CSV files)
```

| Guide | For | Typical example in the Aurora deployment |
|---|---|---|
| [A. Alliance](alliance.md) | Alliance Foundation, hosting operator | Aurora Foundation (data controller) and URV as host |
| [B. Partner with an OEAPI endpoint](partner-with-oeapi.md) | Partner admin and partner IT | Universität Innsbruck, which already serves eduXchange |
| [C. Partner with integration capacity](partner-with-integration-capacity.md) | Partner IT, partner admin | A university with an SIS export team but no OEAPI endpoint |
| [D. Partner without integration capacity](partner-manual.md) | Partner admin | A small international office maintaining a handful of courses |
| [E. Hosting operator](hosting-operator.md) | Hosting operator (the institution's IT team) | URV IT installing the Aurora pilot on `lspurv.urv.cat`: day 0 requests, installation with a check at every step, go-live, day-2 operation |
| [Administrator lifecycle](administrator-lifecycle.md) | Alliance office, hosting operator | Invitation, sign-in mode, removal, dormancy, account clean-up and recertification: defaults and choices [DL 26] |
| [Sign-in paths](identity-paths.md) | Alliance admin, hosting operator, partner admin and partner identity team | Federated (eduGAIN) or local accounts: which mode for a university, both paths step by step, what the identity team must provide, the agreements needed to federate through a national hub [DL 22, DL 29] |

Once your account works, the user manuals take you through the administration panel screen by screen, with screenshots: [partner administrator manual](../manuals/partner-admin.md) and [alliance administrator manual](../manuals/alliance-admin.md).

The technical companions, written for the people who prepare the data, are:

- [API integration guide](../guides/api-integration.md): what the harvester requests and how it maps OEAPI v5 fields.
- [CSV authoring guide](../guides/csv-authoring.md): columns, encodings, limits and every CSV error code.
- [Web form guide](../guides/web-form.md): the course wizard, offerings and overrides.

## The model on one page

**One deployment per alliance.** An alliance runs one OACC instance: one public catalogue at its own hostname, one Keycloak realm for administrators, one database. Alliance name, member universities and course attributes are configuration, not code.

**Organizations.** Every university is an *organization* with a short `slug` (for example `uibk`), names in English and its own languages, a country, a default time zone and its `schacHomeOrganization` domain. The alliance itself is also an organization (for example `aurora`); it can publish its own courses. Organizations are created from a seed file by the hosting operator (`oecp seed-organizations`) or by an alliance admin on the *Organizations* page.

**Roles.** There are two administrator roles, both protected by multi-factor authentication (a password or the university's own login, plus a one-time code app):

| Role | Can do |
|---|---|
| `alliance_admin` | Everything for every organization; manages organizations; invites and removes administrators; approves partner endpoints for harvesting; sees the network status |
| `partner_admin` | Courses, offerings, uploads, integration settings and sync history of their own organization |

Nobody signs up. Administrators are **invited** by e-mail; the first alliance admin is created from the command line. Roles are never derived from what a university's login system says.

**Sign-in mode per organization** [DL 22]. Each organization signs in one way, set by its *Identity provider alias*: none means local accounts (the panel's *OACC accounts*), the permanent mode of the alliance organization and of universities outside eduGAIN, and the interim mode of universities in eduGAIN whose identity provider is not connected yet; an alias means the university's own login through eduGAIN. An organization can move from local to federated later; a mix of local and federated administrators within one organization is not supported ([Guide A, step 3](alliance.md#3-identity)). Both paths side by side, with who does what: [sign-in paths](identity-paths.md).

**Three channels.** A university feeds its courses through one of:

| Channel | How it works | Effort for the university |
|---|---|---|
| **A. OEAPI harvest** | OACC's worker pulls the university's OEAPI v5 endpoint once a day (03:00 Brussels time by default) | Low, if the endpoint exists |
| **B. CSV upload** | Someone uploads `courses.csv` and `offerings.csv` in the admin console; files are checked in the browser and on the server, all or nothing | Low to medium; can be automated from the SIS |
| **C. Web form** | Someone enters each course and offering in a step-by-step wizard | Medium per course; no IT needed |

All three end in the same canonical model, so the public catalogue cannot tell them apart.

**One authoritative channel per organization.** Each organization chooses the channel that owns its records: `oeapi`, `csv` or `form` (the default). CSV and form can be mixed freely, because they write the same records. If the channel is `oeapi`, CSV uploads are refused and the form can only add overrides.

**Overrides.** When data comes from OEAPI, an administrator can still change a single field in the web form, for example add alliance attributes or "How to apply" instructions the endpoint cannot express. The change is stored as an *override* next to the harvested value and survives every later harvest until someone reverts it.

**Lifecycle.** Courses and offerings are `draft`, `published`, `withdrawn` or `cancelled`. Publishing needs an English title. A course appears in the catalogue's default listing when it is published and has a published offering that has not ended. Harvested courses that disappear from the endpoint for three complete harvests in a row are withdrawn automatically; a CSV upload never withdraws by omission.

## What 0.11 does not have yet

Plan around these gaps; each guide repeats the ones that affect it. Every administration task of these guides has a screen ([Guide A, step 7](alliance.md#7-the-administration-screens)); the admin API remains available for scripting.

Backups and alerting are built and are switched on by the hosting operator ([Guide A, step 9](alliance.md#9-operate)): the Compose profile `backup` runs pgBackRest with continuous WAL archiving, weekly full and daily differential backups, a 35-day recovery window and a daily archive of the uploads, checked by a quarterly restore drill (`deploy/compose/scripts/restore-drill.sh`); the profile `observability` adds Prometheus alert rules (including the expiry of partner IdP signing certificates and of the TLS certificate), Alertmanager (e-mail or webhook), container logs shipped to Loki (90 days, Traefik access log 30 days; since 0.7.0) and the Grafana dashboards *OECP overview* and *OECP logs*. See the Compose README sections [Backups](../../deploy/compose/README.md#backups-profile-backup), [Restore drill and restore](../../deploy/compose/README.md#restore-drill-and-restore), [Alerting](../../deploy/compose/README.md#alerting) and [Log retention](../../deploy/compose/README.md#log-retention), and the runbook sections [3](../production/runbook.md#3-backups-and-point-in-time-recovery), [4](../production/runbook.md#4-restore-drill), [7](../production/runbook.md#7-monitoring-and-alerts) and [10](../production/runbook.md#10-log-and-data-retention).

- Login through a university's own identity provider (SAML/eduGAIN) is verified against a simulated IdP only; each real partner IdP must be connected and tested (see Guide A, step 3). Through the SIR2 hub (decision 29, in progress) one real test sign-in has worked (2026-10-28); the production registration is still to come.
- No API keys or service accounts: scripts and unattended uploads need a token from an interactive sign-in.
- No real partner endpoint has been harvested yet; channel A is verified against the bundled mock partner only.
- Until the operator configures the second backup site (encrypted pgBackRest repo2, documented but not yet exercised), every backup lives on the production host only. The in-host monitoring cannot report the host itself down: that needs an external check (runbook section 7, "Still manual").
- The portal serves the privacy notice and the accessibility statement (`/en/privacy`, `/en/accessibility`) only once the alliance has written them and put them in the branding directory; the GDPR document set, the accessibility statement and the runbook exist as templates and drafts in `docs/production/` that the alliance must complete.
- The portal interface is in English only.
