<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Docker Compose reference deployment (MVP)

The reference deployment of OECP for one alliance (spec v4.0 §3, §10;
[DL 10]). One `compose.yaml`, plain `docker compose` commands, no wrapper
scripts.

| Service | Image | Role |
|---|---|---|
| `traefik` | `traefik:v3.7.14` (MIT) | TLS, routing, per-IP rate limits, security headers |
| `web` | built from `apps/web` | Nuxt: SSR public catalogue, client-rendered `/admin` |
| `api` | built from `apps/api` | NestJS HTTP API: `/api/public`, `/api/admin`, `/oeapi/v5` |
| `worker` | same image as `api` | BullMQ processors and schedules (harvester, metadata refresh) |
| `postgres` | `postgres:16.15` | databases `oecp` and `keycloak` |
| `valkey` | `valkey/valkey:8.1.10-alpine` (BSD-3) | BullMQ queues |
| `keycloak` | built from `quay.io/keycloak/keycloak:26.8.1` | admin authentication (SAML brokering, MFA) |
| `keycloak-config` | `adorsys/keycloak-config-cli:6.5.1-26.5.5` | one-shot: applies `identity/keycloak/realm-oecp.yaml` |
| `otel-collector`, `prometheus`, `loki`, `grafana` | profile `observability` | metrics and logs (spec §10) |

```
Internet ─▶ traefik :443
  portal-host  /                     ─▶ web:3000
               /api, /oeapi          ─▶ api:3000   (rate limits: search 20 r/s,
                                                     suggest and /oeapi/v5 10 r/s, admin 30 r/s)
  auth-host    /realms/oecp, /resources ─▶ keycloak:8080
               /admin, /realms/master   ─▶ keycloak:8080 (IP allowlist)
networks: edge (traefik, web, api, keycloak) · backend, internal (postgres, valkey,
          api, worker, keycloak) · egress (worker → partner OEAPI endpoints)
```

## Requirements

- Docker Engine 25+ with Compose v2.24+ (Docker Desktop is fine).
- Ports 80 and 443 free on the host (change `OECP_HTTP_PORT`/`OECP_HTTPS_PORT`
  only behind another proxy: the public URLs assume 443).
- `openssl` to generate secrets.

## Quick start (local development)

All commands run from this directory (`deploy/compose`).

```sh
# 1. Configuration and secrets
cp .env.example .env                      # defaults: portal.localhost, auth.localhost
# create the secret files, see secrets/README.md (one loop of openssl commands)

# 2. Build and start everything
docker compose up -d --build
docker compose ps                         # wait until services are healthy;
                                          # keycloak-config exits with code 0

# 3. Database schema (node-pg-migrate, forward-only SQL migrations)
docker compose run --rm api pnpm db:migrate

# 4. Organizations and the first alliance admin (spec §2.1 "Bootstrap")
docker compose exec api node dist/cli.js seed-organizations
docker compose exec api node dist/cli.js bootstrap-alliance-admin --email admin@example.org --org aurora
```

> **Placeholder:** the `cli.js` commands (`seed-organizations`,
> `bootstrap-alliance-admin`) are specified in spec §2.1 but not implemented
> yet in `apps/api`; the command names may change. `bootstrap-alliance-admin`
> works only while no `alliance_admin` exists and prints a 24-hour invitation
> link to stdout.

Then open:

| URL | What |
|---|---|
| `https://portal.localhost/` | public catalogue (accept the self-signed certificate) |
| `https://portal.localhost/en/admin` | admin dashboard (login through Keycloak) |
| `https://portal.localhost/oeapi/v5/` | public read API |
| `https://auth.localhost/admin/` | Keycloak admin console: user `KEYCLOAK_ADMIN_USER` (default `admin`), password in `secrets/keycloak_admin_password`; reachable only from `KEYCLOAK_ADMIN_ALLOWLIST` |
| `http://127.0.0.1:8080/dashboard/` | Traefik dashboard (local development only) |
| `http://127.0.0.1:3001/` | Grafana (profile `observability`), user `admin`, password in `secrets/grafana_admin_password` |

`*.localhost` resolves to the loopback address in current browsers. For
command-line tools add `127.0.0.1 portal.localhost auth.localhost` to
`/etc/hosts` if needed, and use `curl -k` because of the self-signed
certificate.

## Everyday commands

```sh
docker compose logs -f api worker          # follow application logs
docker compose run --rm api pnpm db:migrate     # after pulling new migrations
docker compose run --rm keycloak-config    # re-apply the realm after editing realm-oecp.yaml
docker compose up -d --build api worker web     # redeploy the application
docker compose --profile observability up -d    # add metrics and logs
docker compose down                        # stop (volumes are kept)
```

`docker compose down -v` deletes **all data** (databases, uploads,
certificates); there is no undo.

## Configuration

- **`.env`** (from `.env.example`): hosts, ports, allowlists, SMTP, image tag;
  every variable is documented there.
- **`secrets/`**: Docker secrets (database passwords, Keycloak admin,
  `oecp-backend` client secret, `oecp_master_key`); see
  [`secrets/README.md`](secrets/README.md). They are mounted under
  `/run/secrets/`, never passed as environment variables. The api/worker
  entrypoint injects the database password into `DATABASE_URL`.
- **`traefik/dynamic/middlewares.yaml`**: security headers, rate limits, TLS
  options.
- **`identity/keycloak/realm-oecp.yaml`**: the realm as code; see
  [`identity/keycloak/README.md`](../../identity/keycloak/README.md).

### Application environment

| Variable | Service | Value in this deployment |
|---|---|---|
| `DATABASE_URL` | api, worker | `postgres://oecp@postgres:5432/oecp` + password from `DATABASE_PASSWORD_FILE` |
| `VALKEY_URL` | api, worker | `redis://valkey:6379/0` |
| `KEYCLOAK_ISSUER` | api, worker | `https://${OECP_AUTH_HOST}/realms/oecp` (exact `iss`) |
| `KEYCLOAK_JWKS_URL` | api, worker | `http://keycloak:8080/realms/oecp/protocol/openid-connect/certs` (internal) |
| `OECP_MASTER_KEY_FILE` | api, worker | `/run/secrets/oecp_master_key` |
| `NUXT_PUBLIC_API_BASE` | web | `https://${OECP_PORTAL_HOST}/api` |

The compose file also passes a few **proposed** variables that the
application does not read yet (`OECP_UPLOADS_DIR`, `KEYCLOAK_ADMIN_*`,
`SMTP_*`, `NUXT_API_INTERNAL_BASE`, `NUXT_PUBLIC_OIDC_*`, `OTEL_*`); they are
marked as such in `compose.yaml`.

## Production checklist

1. **DNS and TLS.** Point the portal and auth hosts at the server. In the
   `traefik` service, uncomment the *PRODUCTION* block (ACME with the
   TLS-ALPN challenge, `ACME_EMAIL`), remove `--api.insecure` and the
   dashboard port. Consider a Docker socket proxy instead of the raw socket.
2. **Allowlists.** Set `KEYCLOAK_ADMIN_ALLOWLIST` to the operators' networks.
   If a load balancer fronts Traefik, configure `forwardedheaders.trustedips`
   and the rate-limit `ipStrategy` (comments in the files) so limits apply
   per client.
3. **Keycloak admin.** Replace the temporary bootstrap admin by a permanent
   `master` realm admin with MFA.
4. **Secrets.** Generate on the server, keep an offline copy of
   `oecp_master_key`.
5. **Backups (spec §10).** pgBackRest for both databases (WAL archiving to a
   second site, weekly full, daily differential, 35-day retention) is not part
   of this file yet; it will be added as a sidecar or host service. Back up the
   `uploads` volume daily.
6. **Images.** Build in CI, sign with cosign and pin by digest
   (`OECP_IMAGE_TAG`) rather than building on the server.
7. **SAML.** Register the SP metadata (see
   [`identity/keycloak/scripts/sp-metadata.md`](../../identity/keycloak/scripts/sp-metadata.md)).

## Troubleshooting

- **`keycloak-config` exits non-zero:** `docker compose logs keycloak-config`.
  Most errors are invalid values substituted into `realm-oecp.yaml` (for
  example an empty URL) or a wrong admin password file.
- **404 from Traefik on a host:** the target container is unhealthy (Traefik
  ignores unhealthy containers) or `OECP_PORTAL_HOST`/`OECP_AUTH_HOST` does not
  match the URL.
- **`invalid_token` / issuer mismatch in the API:** `KEYCLOAK_ISSUER` must be
  exactly `https://<auth host>/realms/oecp`, the host users see.
- **Postgres init script did not run:** it only runs on an empty
  `postgres_data` volume.
