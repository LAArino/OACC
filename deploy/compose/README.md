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
| `mailpit` | `axllent/mailpit:v1.31.5` (MIT), profile `dev` | local SMTP sink with a web UI |
| `oeapi-mock` | built from `tools/oeapi-mock` (`node:22.23.3-alpine3.24`), profile `dev` | simulated partner university serving OEAPI v5.0 for the harvester |
| `test-saml-idp` | `kenchan0130/simplesamlphp:1.19.9` (MIT; SimpleSAMLphp LGPL-2.1), profile `dev` | test SAML IdP playing URV for the brokered admin path (realm IdP `urv`, `OECP_DEV_IDP_ENABLED=true`) |
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

Only the paths above are routed. In particular the api's `/health` and
`/ready` (served at the root of the container, outside `/api`) are **not**
reachable through Traefik: they are used by the container healthcheck only
(spec §3 lists the public paths; spec §10 asks for no needless exposure). On
the portal host they fall through to Nuxt and return its 404.

## Requirements

- Docker Engine 25+ with Compose v2.24+ (verified with Docker Desktop 29.8 on
  macOS, Compose v5.5).
- Ports 80 and 443 free on the host (change `OECP_HTTP_PORT`/`OECP_HTTPS_PORT`
  only behind another proxy: the public URLs assume 443).
- `openssl` to generate secrets.

## Quick start (local development)

All commands run from this directory (`deploy/compose`). This sequence was
verified end to end on an empty Docker host.

```sh
# 1. Configuration: copy the example and enable the `dev` block (Mailpit).
cp .env.example .env
sed -i.bak -e 's/^# COMPOSE_PROFILES=dev/COMPOSE_PROFILES=dev/' \
  -e 's/^# OECP_SMTP_HOST=mailpit/OECP_SMTP_HOST=mailpit/' \
  -e 's/^# OECP_SMTP_PORT=1025/OECP_SMTP_PORT=1025/' \
  -e 's/^# OECP_SMTP_STARTTLS=false/OECP_SMTP_STARTTLS=false/' .env && rm .env.bak
# (the duplicate OECP_SMTP_* lines further up are overridden: the last one wins)

# 2. Secrets (no trailing newline; see secrets/README.md)
chmod 700 secrets
for name in postgres_superuser_password oecp_db_password keycloak_db_password \
            keycloak_admin_password oecp_backend_client_secret grafana_admin_password; do
  [ -f "secrets/$name" ] || openssl rand -hex 32 | tr -d '\n' > "secrets/$name"
done
[ -f secrets/oecp_master_key ] || openssl rand -base64 32 | tr -d '\n' > secrets/oecp_master_key
chmod 644 secrets/*
git status --short --ignored .            # .env and secrets/* are listed as ignored (!!)

# 3. Build and start everything; --wait returns when every service is healthy
docker compose up -d --build --wait
docker compose wait keycloak-config       # realm import finished: prints exit status 0

# 4. Database schema (node-pg-migrate, forward-only SQL migrations)
docker compose run --rm api pnpm db:migrate

# 5. Organizations and the first alliance admin (spec §2.1 "Bootstrap")
docker compose run --rm -T api node dist/cli.js seed-organizations
docker compose run --rm -T api node dist/cli.js bootstrap-alliance-admin --email admin@example.org --org aurora
```

Step 5 needs an `api` image that contains the CLI (`apps/api/src/cli.ts`);
`bootstrap-alliance-admin` works only while no `alliance_admin` exists and
prints a 24-hour invitation link to stdout. With the `dev` profile the
invitation and Keycloak e-mails land in Mailpit.

Without the `dev` profile, leave `COMPOSE_PROFILES` and the `dev` SMTP lines
commented: Keycloak then has no mail relay (`OECP_SMTP_HOST` empty) and the
api only logs invitation e-mails.

Then open:

| URL | What |
|---|---|
| `https://oecp.localhost/` | public catalogue; redirects to `/en` (accept the self-signed certificate) |
| `https://oecp.localhost/en/admin` | admin dashboard (login through Keycloak) |
| `https://oecp.localhost/oeapi/v5/` | public read API |
| `https://auth.oecp.localhost/admin/` | Keycloak admin console: user `KEYCLOAK_ADMIN_USER` (default `admin`), password in `secrets/keycloak_admin_password`; reachable only from `KEYCLOAK_ADMIN_ALLOWLIST` |
| `http://127.0.0.1:8025/` | Mailpit (profile `dev`): every e-mail sent by Keycloak and the api |
| `http://127.0.0.1:8090/` | OEAPI v5.0 mock partner (profile `dev`), HTTP Basic `oecp` / `oecp-mock-secret` |
| `http://127.0.0.1:8091/simplesaml/` | test SAML IdP (profile `dev`), users in `test-saml-idp/users.json` |
| `http://127.0.0.1:8080/dashboard/` | Traefik dashboard (local development only) |
| `http://127.0.0.1:3001/` | Grafana (profile `observability`), user `admin`, password in `secrets/grafana_admin_password` |

`*.localhost` names resolve to the loopback address in current browsers and
in `curl` on macOS (and most Linux distributions), without `/etc/hosts`
entries; add `127.0.0.1 oecp.localhost auth.oecp.localhost` to `/etc/hosts`
for tools that do not. Use `curl -k` because of the self-signed certificate.
Inside containers `oecp.localhost` is the container itself, so server-side
code must use internal addresses (`http://api:3000`, `http://keycloak:8080`).

### Smoke test

```sh
curl -sk -o /dev/null -w '%{http_code} %{redirect_url}\n' https://oecp.localhost/      # 302 → /en
curl -sk https://oecp.localhost/en | grep -o '<html[^>]*>'                            # lang="en", no Set-Cookie
curl -sk -i 'https://oecp.localhost/oeapi/v5/courses?pageSize=1' | head -1            # 200, OEAPI v5 envelope
curl -sk -i https://oecp.localhost/api/admin/v1/me | grep -i www-authenticate         # 401, WWW-Authenticate: Bearer
curl -sk https://auth.oecp.localhost/realms/oecp/.well-known/openid-configuration | grep -o '"issuer":"[^"]*"'
# → "issuer":"https://auth.oecp.localhost/realms/oecp"
```

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

### Local development profile (`dev`)

The `dev` profile adds Mailpit and the OEAPI mock, in `compose.yaml` itself (like
`observability`) rather than in an override file, so `docker compose config`
shows one complete model and the production deployment simply never enables
the profile. Mailpit listens for SMTP on `mailpit:1025` (Docker networks only)
and serves its UI and REST API on `127.0.0.1:${MAILPIT_PORT:-8025}`. The
`.env` settings route all mail to it:

```sh
COMPOSE_PROFILES=dev          # plain `docker compose ...` includes the profile
OECP_SMTP_HOST=mailpit
OECP_SMTP_PORT=1025
OECP_SMTP_STARTTLS=false      # Mailpit offers no TLS; Keycloak's STARTTLS is mandatory when enabled
```

`keycloak-config` runs again on every `docker compose up -d`, so changed SMTP
settings reach the realm with the next `up`. To check delivery, trigger
an execute-actions e-mail for a test user (Admin console > Users > Credentials
> "Credential reset") and look at `http://127.0.0.1:8025/`.

#### OEAPI mock partner (`oeapi-mock`)

A dependency-free Node server that plays a partner university's Open
Education API v5.0 endpoint (consumer profile `eduxchange`) with a synthetic
University of Innsbruck dataset: 25 courses (20 tagged for eduXchange), 40
offerings, 3 academic sessions and deliberate edge cases for the harvester
(spec §6.2). Details, edge-case list and identifiers:
[`tools/oeapi-mock/README.md`](../../tools/oeapi-mock/README.md).

| Setting | Value |
|---|---|
| Base URL from api and worker | `http://oeapi-mock:8090` (networks `backend`, `edge`) |
| Base URL from the host | `http://127.0.0.1:${OEAPI_MOCK_PORT:-8090}` |
| Authentication | HTTP Basic, user `oecp`, password `oecp-mock-secret` (`OEAPI_MOCK_AUTH`) |
| Consumer profile | `eduxchange` |
| Dataset | `OEAPI_MOCK_DATASET=/app/data/uibk.json`; `/app/data/uibk-next-run.json` for the next run |

```sh
docker compose --profile dev up -d --build oeapi-mock
curl -s -u oecp:oecp-mock-secret 'http://127.0.0.1:8090/courses?consumer=eduxchange&pageSize=2'
docker compose exec api wget -qO- \
  --header="Authorization: Basic $(printf %s oecp:oecp-mock-secret | base64)" \
  'http://oeapi-mock:8090/courses?pageSize=2'
docker compose logs -f oeapi-mock          # one line per request
```

To point a partner integration at it, give the organization (in the admin
UI or API) `access_mode` `direct`, `base_url` `http://oeapi-mock:8090`,
`auth_scheme` `basic` with a secret holding `oecp:oecp-mock-secret`, and
`consumer_profile` `eduxchange`. The production outbound rules of spec
§6.2.6 (`https` on port 443 only, private addresses refused) reject this
URL by design; api and worker accept it only with the development-only
switch `OECP_ALLOW_INSECURE_PARTNER_HTTP=true` (default `false`, never in
production). To simulate the next run (withdrawal by absence, change
detection), set `OEAPI_MOCK_DATASET=/app/data/uibk-next-run.json` in `.env`
and run `docker compose up -d oeapi-mock`; set `OEAPI_MOCK_FAIL_RATE`,
`OEAPI_MOCK_RATE_LIMIT_PER_SEC` or `OEAPI_MOCK_LATENCY_MS` the same way to
exercise retries and back-off.

#### Test SAML IdP (`test-saml-idp`)

SimpleSAMLphp configured from [`test-saml-idp/`](test-saml-idp/) as the IdP
of partner URV (entity ID `https://idp.urv.test/saml2/idp`), published on
`127.0.0.1:${OECP_DEV_IDP_PORT:-8091}` for the browser; the realm's IdP `urv`
points at it when `.env` sets `OECP_DEV_IDP_ENABLED=true` (applied by
`keycloak-config`). Keycloak never calls it (HTTP-POST binding through the
browser); it reads Keycloak's SP descriptor over the `edge` network for the
encryption certificate. Setup, design and pitfalls:
[`identity/keycloak/README.md`](../../identity/keycloak/README.md#test-saml-idp-dev-profile);
end-to-end scripts: [`tools/e2e-identity`](../../tools/e2e-identity/README.md).

```sh
docker compose --profile dev up -d test-saml-idp
docker compose --profile dev run --rm keycloak-config   # with OECP_DEV_IDP_ENABLED=true
```

### Security headers and rate limits

| Router | Middlewares |
|---|---|
| `web` (portal host, `/`) | `security-headers` (HSTS, nosniff, `X-Frame-Options: SAMEORIGIN` (silent session restore iframe), referrer and permissions policy, COOP); the nonce-based CSP is the application's job |
| `api` (`/api`, `/oeapi`) | `security-headers` + `security-headers-api` (`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; …`) |
| `api-search`, `api-suggest`, `oeapi`, `api-admin` | the above plus `ratelimit-search` (20 r/s, burst 40), `ratelimit-suggest` and `ratelimit-oeapi` (10 r/s, burst 20), `ratelimit-admin` (30 r/s, burst 60); excess requests get 429 |
| `auth`, `auth-admin` (auth host) | `security-headers-auth` (transport headers only; Keycloak sets its own CSP), plus the IP allowlist on `auth-admin` |

### Keycloak admin allowlist

`KEYCLOAK_ADMIN_ALLOWLIST` is matched against the source address Traefik
sees. With Docker Desktop for Mac every request from the host arrives from
`192.168.65.1`, so the private ranges in `.env.example` let the host in. To
lock it down locally set `KEYCLOAK_ADMIN_ALLOWLIST=192.168.65.1/32` (only the
host), or `127.0.0.1/32` to close `/admin` and `/realms/master` completely
(verified: both return 403 while `/realms/oecp` keeps working). Changing the
value recreates `keycloak`; Traefik needs a few seconds after the container
turns healthy before it routes to it again. In production list only the
operators' networks; behind a load balancer configure
`forwardedheaders.trustedips` and an `ipStrategy` so the real client address
is checked.

### Application environment

| Variable | Service | Value in this deployment |
|---|---|---|
| `DATABASE_URL` | api, worker | `postgres://oecp@postgres:5432/oecp` + password from `DATABASE_PASSWORD_FILE` |
| `VALKEY_URL` | api, worker | `redis://valkey:6379/0` |
| `KEYCLOAK_ISSUER` | api, worker | `https://${OECP_AUTH_HOST}/realms/oecp` (exact `iss`) |
| `KEYCLOAK_JWKS_URL` | api, worker | `http://keycloak:8080/realms/oecp/protocol/openid-connect/certs` (internal) |
| `OECP_MASTER_KEY_FILE` | api, worker | `/run/secrets/oecp_master_key` |
| `KEYCLOAK_ADMIN_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET_FILE` | api, worker | `http://keycloak:8080`, `oecp`, `oecp-backend`, `/run/secrets/oecp_backend_client_secret` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | api, worker | from `OECP_SMTP_*` in `.env` |
| `OECP_PUBLIC_BASE_URL` | api, worker | `https://${OECP_PORTAL_HOST}` (invitation links) |
| `NUXT_PUBLIC_API_BASE` | web | `https://${OECP_PORTAL_HOST}` (origin only: the app appends `/api/public/v1/...`) |
| `NUXT_PUBLIC_I18N_BASE_URL` | web | `https://${OECP_PORTAL_HOST}` (absolute hreflang links) |

`OTEL_*` variables are passed for the observability profile; the application
reads every other variable listed above.

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
5. **Mail.** Never enable the `dev` profile; set `OECP_SMTP_*` to the host
   institution relay (`OECP_SMTP_STARTTLS=true` if it offers TLS).
6. **Backups (spec §10).** pgBackRest for both databases (WAL archiving to a
   second site, weekly full, daily differential, 35-day retention) is not part
   of this file yet; it will be added as a sidecar or host service. Back up the
   `uploads` volume daily.
7. **Images.** Build in CI, sign with cosign and pin by digest
   (`OECP_IMAGE_TAG`) rather than building on the server.
8. **SAML.** Register the SP metadata (see
   [`identity/keycloak/scripts/sp-metadata.md`](../../identity/keycloak/scripts/sp-metadata.md)).

## Troubleshooting

- **`keycloak-config` exits non-zero:** `docker compose logs keycloak-config`.
  Most errors are invalid values substituted into `realm-oecp.yaml` (for
  example an empty URL) or a wrong admin password file. Note that it logs
  skipped sections only at debug level: add
  `LOGGING_LEVEL_DE_ADORSYS=debug` to its environment to see them.
- **404 from Traefik on a host:** the target container is unhealthy or
  (re)starting (Traefik ignores unhealthy containers and needs a few seconds
  after a container turns healthy), or `OECP_PORTAL_HOST`/`OECP_AUTH_HOST`
  does not match the URL.
- **`invalid_token` / issuer mismatch in the API:** `KEYCLOAK_ISSUER` must be
  exactly `https://<auth host>/realms/oecp`, the host users see.
- **Keycloak "Failed to send email":** with `starttls` enabled Keycloak
  requires the relay to offer STARTTLS; set `OECP_SMTP_STARTTLS=false` for a
  relay without TLS and run `docker compose up -d` again.
- **`pnpm db:migrate` hangs or downloads packages:** the image predates the
  fixes in `dockerfiles/api.Dockerfile` (pnpm 12 native binary baked in,
  `pnpm_config_verify_deps_before_run=false`); rebuild the `api` image.
- **Catalogue pages show the error message under SSR:** the web container
  cannot reach `https://<portal host>` (inside the container it is not
  Traefik); server-side fetches use `NUXT_API_INTERNAL_BASE`
  (`http://api:3000`), so check that it is set and that `api` is healthy.
- **Postgres init script did not run:** it only runs on an empty
  `postgres_data` volume.
