<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Open European Campus Portal (OECP)

Status: 0.1.0, pre-production (no real partner data yet); specification v4.1 (as built)

OECP is an open-source web application that publishes the course offer of a
European University alliance as one public catalogue and one read API. Partner
universities feed their courses through three channels: scheduled harvesting of
their Open Education API (OEAPI, formerly OOAPI) endpoints, CSV upload, or a web
form. An anti-corruption layer normalises every channel into one canonical model
before publication, and the published catalogue is exposed again as an
OEAPI v5-compatible read API so that others can harvest it. OECP is
alliance-agnostic: the alliance name, partners, domains, logos, colours and UI
languages are configuration, and one deployment serves one alliance. Its first
deployment targets the Aurora alliance. OECP never handles applications or
enrolment and stores no student data.

The full specification is [docs/spec-v4.0.md](docs/spec-v4.0.md).

## Architecture

- **Edge:** Traefik v3 terminates TLS, routes, rate-limits and sets security headers ([ADR-0003](docs/adr/0003-traefik-edge-proxy.md)).
- **Web:** Nuxt 4 / Vue 3 renders the public catalogue server-side and the admin dashboard client-side ([ADR-0002](docs/adr/0002-vue3-nuxt-ssr-catalogue.md)).
- **Backend:** one NestJS modular monolith, one image, two processes: `api` (HTTP) and `worker` (BullMQ on Valkey) ([ADR-0001](docs/adr/0001-modular-monolith-on-nestjs.md)).
- **Data:** PostgreSQL 16 holds the canonical model, full-text search and history; ingestion is pull-only OEAPI harvesting plus CSV and form ([ADR-0005](docs/adr/0005-pull-only-oeapi-harvesting-canonical-model.md)).
- **Identity:** Keycloak authenticates administrators only, with one SAML IdP per partner (eduGAIN) and mandatory MFA; the public portal never touches it ([ADR-0004](docs/adr/0004-keycloak-only-identity-one-saml-idp-per-partner.md)).

## Repository layout

```
.
├── apps/
│   ├── api/              NestJS backend: `api` and `worker` processes
│   └── web/              Nuxt public catalogue and admin dashboard
├── packages/
│   └── schemas/          Canonical model, CSV template, OEAPI DTOs, error codes
├── identity/
│   └── keycloak/         Realm as code, themes, SP metadata scripts
├── deploy/
│   ├── compose/          Docker Compose reference deployment (MVP)
│   └── helm/             Helm chart (v1)
└── docs/
    ├── adr/              Architecture decision records (MADR)
    ├── research/         Background research
    ├── review/           Reviews of specification v3.0
    ├── decisions-log.md  Owner decisions
    └── spec-v4.0.md      Current specification
```

See [docs/README.md](docs/README.md) for an index of the documentation.

## Quick start

The reference deployment is Docker Compose; the verified first-run path
(services, secrets, migrations, first alliance administrator, optional
`dev` profile with a mail sink and a simulated OEAPI partner) is in
[deploy/compose/README.md](deploy/compose/README.md). Developer tooling:
[tools/oeapi-mock](tools/oeapi-mock/README.md) (simulated partner) and
[tools/e2e-identity](tools/e2e-identity/README.md) (browser check of the
administrator onboarding).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
(Developer Certificate of Origin sign-off, no CLA),
the [Code of Conduct](CODE_OF_CONDUCT.md), [GOVERNANCE.md](GOVERNANCE.md) and,
for vulnerabilities, [SECURITY.md](SECURITY.md). Notable changes are recorded
in [CHANGELOG.md](CHANGELOG.md).

## Licence

Copyright 2026 Lluís Alfons Ariño  
Licensed under the EUPL

OECP is licensed under the [European Union Public Licence v. 1.2](LICENSE)
(EUPL-1.2), English version. The EUPL's network clause means that anyone who operates a modified
version of OECP as a network service must make the source code of that version
available. Trivial configuration files are dedicated to the public domain
(CC0-1.0). Licensing information for every file is declared in
[REUSE.toml](REUSE.toml) following the [REUSE](https://reuse.software)
specification; the licence texts are in [LICENSES/](LICENSES/).
