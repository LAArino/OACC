<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Onboarding to OECP

These guides take an alliance and its universities from "we want a shared course catalogue" to "our courses are published and stay current". They describe **release 0.2.0** as it is. Where something is planned but not built, they say "not yet available in 0.2.0". The as-built specification is [spec v4.1](../spec-v4.1.md); the decisions behind these guides are rows 2, 3, 4, 12, 13, 14, 15 and 17 of the [decisions log](../decisions-log.md).

> **Before you start**
>
> - Know your role: alliance (Foundation or secretariat), hosting operator, partner admin (the person responsible for a university's course data) or partner IT.
> - Know how your university can deliver course data today: an OEAPI v5 endpoint, an export from the student information system (SIS), or only people and spreadsheets.
> - OECP never handles applications and stores no student data. It publishes course and offering descriptions.

## Which guide should I read?

```
Are you setting up OECP for the whole alliance (governance, server, identity)?
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

The technical companions, written for the people who prepare the data, are:

- [API integration guide](../guides/api-integration.md): what the harvester requests and how it maps OEAPI v5 fields.
- [CSV authoring guide](../guides/csv-authoring.md): columns, encodings, limits and every CSV error code.
- [Web form guide](../guides/web-form.md): the course wizard, offerings and overrides.

## The model on one page

**One deployment per alliance.** An alliance runs one OECP instance: one public catalogue at its own hostname, one Keycloak realm for administrators, one database. Alliance name, member universities and course attributes are configuration, not code.

**Organizations.** Every university is an *organization* with a short `slug` (for example `uibk`), names in English and its own languages, a country, a default time zone and its `schacHomeOrganization` domain. The alliance itself is also an organization (for example `aurora`); it can publish its own courses. Organizations are created from a seed file by the hosting operator (`oecp seed-organizations`) or by an alliance admin on the *Organizations* page.

**Roles.** There are two administrator roles, both protected by multi-factor authentication (password plus a one-time code app):

| Role | Can do |
|---|---|
| `alliance_admin` | Everything for every organization; manages organizations; invites and removes administrators; approves partner endpoints for harvesting; sees the network status |
| `partner_admin` | Courses, offerings, uploads, integration settings and sync history of their own organization |

Nobody signs up. Administrators are **invited** by e-mail; the first alliance admin is created from the command line. Roles are never derived from what a university's login system says.

**Three channels.** A university feeds its courses through one of:

| Channel | How it works | Effort for the university |
|---|---|---|
| **A. OEAPI harvest** | OECP's worker pulls the university's OEAPI v5 endpoint once a day (03:00 Brussels time by default) | Low, if the endpoint exists |
| **B. CSV upload** | Someone uploads `courses.csv` and `offerings.csv` in the admin console; files are checked in the browser and on the server, all or nothing | Low to medium; can be automated from the SIS |
| **C. Web form** | Someone enters each course and offering in a step-by-step wizard | Medium per course; no IT needed |

All three end in the same canonical model, so the public catalogue cannot tell them apart.

**One authoritative channel per organization.** Each organization chooses the channel that owns its records: `oeapi`, `csv` or `form` (the default). CSV and form can be mixed freely, because they write the same records. If the channel is `oeapi`, CSV uploads are refused and the form can only add overrides.

**Overrides.** When data comes from OEAPI, an administrator can still change a single field in the web form, for example add alliance attributes or "How to apply" instructions the endpoint cannot express. The change is stored as an *override* next to the harvested value and survives every later harvest until someone reverts it.

**Lifecycle.** Courses and offerings are `draft`, `published`, `withdrawn` or `cancelled`. Publishing needs an English title. A course appears in the catalogue's default listing when it is published and has a published offering that has not ended. Harvested courses that disappear from the endpoint for three complete harvests in a row are withdrawn automatically; a CSV upload never withdraws by omission.

## What 0.2.0 does not have yet

Plan around these gaps; each guide repeats the ones that affect it. Since 0.2.0 every administration task of these guides has a screen ([Guide A, step 7](alliance.md#7-the-administration-screens)); the admin API remains available for scripting.

- Login through a university's own identity provider (SAML/eduGAIN) has a screen ("Sign in through your university") but has not been verified end to end; administrators use local OECP accounts until their university's identity provider is connected and tested.
- No API keys or service accounts: scripts and unattended uploads need a token from an interactive sign-in.
- No real partner endpoint has been harvested yet; channel A is verified against the bundled mock partner only.
- No automated backups, privacy page, accessibility statement or GDPR document set.
- The portal interface is in English only.
