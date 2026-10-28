<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Security policy

## Supported versions

OACC is pre-production: the current release is 0.12.0 and no alliance runs it
in production yet. Security fixes are made on the `main` branch and released
as a patch of the latest minor version ([docs/RELEASING.md](docs/RELEASING.md#support-policy)).

| Version | Supported |
|---|---|
| 0.12.x | Yes, latest minor only (pre-production) |
| 0.1.x to 0.11.x | No |

Until 1.0 only the latest minor version is supported; the support window after
1.0 will be set by an ADR.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security
problem.**

Report it privately through **GitHub private vulnerability reporting**:
<https://github.com/LAArino/OACC/security/advisories/new> (*Security* tab →
*Report a vulnerability*). This is the preferred channel: the report, the
discussion and the fix stay in a private advisory until it is published. It is
available once the repository is public.

If you cannot use it, report by email to **`security@<alliance-domain>`**
(placeholder, to be replaced before the first production deployment).

Please include:

- the affected component (`api`, `worker`, `web`, Keycloak configuration,
  deployment files) and the version or commit;
- a description of the issue and its impact;
- steps to reproduce or a proof of concept;
- whether the issue is already public or known to others;
- how you would like to be credited, if at all.

Encrypt sensitive details if a public key is published alongside the address.

## What happens next

1. We acknowledge receipt within 5 working days.
2. We assess the report, confirm or reject it, and agree a severity with you.
3. We develop and test a fix, and prepare an advisory.
4. We release the fix and publish the advisory, crediting you unless you ask
   otherwise.

## Coordinated disclosure

OACC follows a **90-day coordinated disclosure** policy. We ask reporters not
to disclose a vulnerability publicly until a fix is released or 90 days have
passed since the report, whichever comes first. The period may be shortened
if the issue is actively exploited, or extended by mutual agreement when a fix
requires coordination with upstream projects or with operators of existing
deployments.

## Scope

In scope: the code and configuration in this repository, including the
Keycloak realm configuration in `identity/keycloak` and the reference
deployments in `deploy/`.

Out of scope:

- **`simplesamlphp-module-oid4vp`** is a separate repository with its own
  security policy. Report issues in that module there, not here.
- Vulnerabilities in upstream components (for example Keycloak, Traefik,
  PostgreSQL, Valkey, Nuxt or NestJS) should be reported to those projects.
  Tell us as well if OACC's default configuration makes the issue
  exploitable.
- Findings against a specific alliance's deployment that are caused by its
  local configuration or operation should be reported to that deployment's
  operator.
