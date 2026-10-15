<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0003: Traefik as edge proxy

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R00] `docs/review/00-consolidated-pending-decisions.md`, [R03] `docs/review/03-architecture-stack-licences.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

Specification v3.0 named "Traefik / Kong" as API gateway and promised a stack
free of commercial lock-in [R03 §1]. The review found that Kong Gateway's code
remains Apache-2.0 but, since version 3.10 (March 2025), there are no
pre-built OSS images and the free mode is gone; plugins such as OIDC are paid.
There is no official announcement; the community, Supabase and a FOLIO ADR
confirm it [R03 §1; R00 §2.3]. Using Kong would mean building it from source
or moving to a commercial tier.

What should OECP use at the edge for TLS, routing, rate limiting and security
headers?

## Decision drivers

- Open-source licence and freely available images, consistent with the
  project's promise of no vendor lock-in [R03 §1, §2].
- Native discovery in Docker and Kubernetes, matching the Compose (MVP) and
  Helm (v1) deliverables [DL 10; spec §10].
- Automatic TLS (ACME), per-IP rate limiting, security headers and IP
  allowlists without an extra database [R03 §1].
- The architecture needs routing, not API management (keys, monetisation,
  developer portal) [R03 §1].

## Considered options

1. Traefik Proxy v3 (MIT).
2. Kong Gateway.
3. Plain NGINX (or another static reverse proxy) with manual configuration.

## Decision outcome

Chosen option: **Traefik Proxy v3**, because it provides native Docker and
Kubernetes discovery, automatic TLS, rate limiting and ForwardAuth without its
own database, under the MIT licence, and the architecture does not need
Kong's API-management features [R03 §1; DL 10].

Traefik routes (spec §3):

- portal host: `/` → Nuxt; `/api/public` and `/oeapi/v5` → `api`
  (anonymous); `/api/admin` → `api` (bearer JWT, validated in the backend);
- auth host: `/realms/oecp` → Keycloak; the Keycloak admin console is
  IP-allowlisted at Traefik.

It enforces TLS 1.2+, HSTS and per-IP rate limits: search 20 req/s, suggest
and `/oeapi/v5` 10 req/s, admin 30 req/s (spec §10).

### Consequences

- Good, because routing is declared next to services (Compose labels,
  Kubernetes resources), so the same model serves both deliverables.
- Good, because certificates are obtained and renewed automatically.
- Good, because no gateway database or commercial licence is needed.
- Bad, because Traefik does not validate JWTs natively in its OSS edition;
  authentication and authorisation remain in the NestJS backend, which is the
  intended contract anyway (spec §4).
- Neutral, because a deployment that already runs another proxy can place it
  in front of, or instead of, Traefik by reproducing the routes and limits.

### Confirmation

The Compose deployment defines routes, rate limits and headers as Traefik
configuration; end-to-end tests exercise the public and admin paths through
the proxy.

## Pros and cons of the options

### Traefik Proxy v3

- Good, because MIT, with native discovery, ACME, rate limiting and
  ForwardAuth [R03 §1].
- Bad, because advanced API-management features are not available, but none
  is required.

### Kong Gateway

- Good, because of a mature plugin ecosystem and API management.
- Bad, because no OSS images or free mode since 3.10 and OIDC plugins are
  paid, breaking the no-lock-in promise [R03 §1].

### Plain NGINX

- Good, because it is widely known and fast.
- Bad, because routing, certificates and rate limits are maintained by hand
  and there is no native service discovery.

## More information

- Specification §3 (architecture) and §10 (security).
- Sources cited in [R03]: Kong discussion #14405, Supabase changelog, FOLIO
  DR-000045.
