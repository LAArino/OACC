<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Specification v4.0 as the implementation baseline (`docs/spec-v4.0.md`).
- Licensing under EUPL-1.2 with REUSE 3.2 metadata (`REUSE.toml`, `LICENSES/`).
- Governance and contribution documents: `README.md`, `CONTRIBUTING.md`
  (DCO sign-off, no CLA), `DCO`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `SECURITY.md`, `GOVERNANCE.md` and `publiccode.yml`.
- Architecture decision records 0001–0006 in `docs/adr/`.
- Admin onboarding (spec §2.1): Keycloak Admin API client for the confidential
  client `oecp-backend`; admin invitations (`POST`/`GET /api/admin/v1/invitations`,
  `DELETE /api/admin/v1/invitations/{id}`, `POST /api/admin/v1/invitations/accept`)
  with SHA-256-only token storage, fragment links, e-mail via SMTP (log fallback)
  and audit log rows; `GET /api/admin/v1/me` for role-less tokens.
- `oecp` CLI (`node dist/cli.js`): `seed-organizations` (upsert by slug; Aurora
  seed in `apps/api/db/seed/`) and `bootstrap-alliance-admin`.
- Docker Compose profile `dev` with Mailpit (`axllent/mailpit:v1.31.5`) as
  SMTP sink for Keycloak and the api (UI on `http://127.0.0.1:8025`), and
  `OECP_SMTP_STARTTLS` for relays without TLS.
- Traefik middleware `security-headers-api`: `Content-Security-Policy:
  default-src 'none'; frame-ancestors 'none'` on `/api` and `/oeapi`.

### Changed

- Compose quick start verified end to end on Docker Desktop (macOS): default
  hosts `oecp.localhost` and `auth.oecp.localhost`, `up --build --wait`,
  `docker compose wait keycloak-config`; `/health` and `/ready` stay internal
  (api healthcheck now probes `/ready`, web probes `/en`).
- keycloak-config-cli runs with `IMPORT_CACHE_ENABLED=false`, so every run
  enforces `realm-oecp.yaml`; `6.5.1-26.5.5` verified against Keycloak 26.8.1.

### Fixed

- Realm `oecp`: the declarative user profile was never imported (missing
  `userProfileEnabled`), so `oecp_org_id` was dropped and `org_id` never
  reached tokens.
- Realm `oecp`: role-less invited users got tokens without `aud`, `name` and
  `idp` because the role scope was on client scope `oecp`; it is now on client
  `oecp-admin`.
- Realm `oecp`: the `oecp-backend` service account got 403 on every Admin API
  call (realm-management roles not in its role scope).
- api image: `pnpm db:migrate` hung (pnpm 12 downloading its native binary and
  verifying the whole lockfile at run time) and failed on workspace files
  copied with mode 0600.
- web: `NUXT_PUBLIC_API_BASE` is the origin (the app appends `/api/...`);
  `NUXT_PUBLIC_I18N_BASE_URL` set for absolute hreflang links.

[Unreleased]: https://github.com/<org>/oecp/commits/main
