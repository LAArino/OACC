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
| `postgres` | built from `postgres:16.15` + pgBackRest 2.59.3 (`dockerfiles/postgres.Dockerfile`) | databases `oecp` and `keycloak`; WAL archiving |
| `valkey` | `valkey/valkey:8.1.10-alpine` (BSD-3) | BullMQ queues |
| `keycloak` | built from `quay.io/keycloak/keycloak:26.8.1` | admin authentication (SAML brokering, MFA) |
| `keycloak-config` | `adorsys/keycloak-config-cli:6.5.1-26.5.5` | one-shot: applies `identity/keycloak/realm-oecp.yaml` |
| `mailpit` | `axllent/mailpit:v1.31.5` (MIT), profile `dev` | local SMTP sink with a web UI |
| `oeapi-mock` | built from `tools/oeapi-mock` (`node:22.23.3-alpine3.24`), profile `dev` | simulated partner university serving OEAPI v5.0 for the harvester |
| `test-saml-idp` | `kenchan0130/simplesamlphp:1.19.9` (MIT; SimpleSAMLphp LGPL-2.1), profile `dev` | test SAML IdP playing URV for the brokered admin path (realm IdP `urv`, `OECP_DEV_IDP_ENABLED=true`) |
| `backup` | same image as `postgres`, profile `backup` | pgBackRest backups (weekly full, daily differential, PITR, 35 days), daily uploads archive, backup metrics |
| `otel-collector`, `prometheus`, `loki`, `grafana` | profile `observability` | metrics and logs (spec §10) |
| `alloy` | `grafana/alloy:v1.20.1` (Apache-2.0), profile `observability` | ships the container logs of the project to Loki ([Log retention](#log-retention)) |
| `docker-socket-proxy` | `tecnativa/docker-socket-proxy:v0.5.0` (Apache-2.0), profile `observability` | read-only Docker API for `alloy` (GET containers, events, networks only), internal network `docker-api` |
| `alertmanager` (`prom/alertmanager:v0.34.1`), `node-exporter` (`prom/node-exporter:v1.12.1`), `blackbox-exporter` (`prom/blackbox-exporter:v0.29.0`), all Apache-2.0 | profile `observability` | alert notifications (e-mail, webhook), disk and backup metrics, readiness probes |

```
Internet ─▶ traefik :443
  portal-host  /                     ─▶ web:3000
               /api, /oeapi          ─▶ api:3000   (rate limits: search 20 r/s,
                                                     suggest and /oeapi/v5 10 r/s, admin 30 r/s)
  auth-host    /realms/oecp, /resources ─▶ keycloak:8080
               /admin, /realms/master   ─▶ keycloak:8080 (IP allowlist)
networks: edge (traefik, web, api, keycloak; observability: prometheus, alertmanager,
          blackbox-exporter, grafana; dev: mailpit, oeapi-mock, test-saml-idp) ·
          backend, internal (postgres, valkey, api, worker, keycloak, keycloak-config;
          observability: every service but docker-socket-proxy; dev: mailpit,
          oeapi-mock) · egress (worker → partner OEAPI endpoints) · docker-api,
          internal (alloy → docker-socket-proxy; profile observability) ·
          backup: no network (Unix socket and volumes)
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
[ -f secrets/keycloak_saml_sig_key ] || bash ../../tools/scripts/gen-saml-keys.sh --dir secrets
chmod 644 secrets/*
git status --short --ignored .            # .env and secrets/* are listed as ignored (!!)

# 3. Build and start everything; --wait returns when every service is healthy
docker compose up -d --build --wait
docker compose ps -a keycloak-config --format '{{.Status}}'   # Exited (0): realm import finished
docker compose logs keycloak-config | grep -i import          # the realm file imported, no error

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
commented and set `OECP_SMTP_HOST` to a relay. With `OECP_SMTP_HOST` empty
Keycloak has no mail relay and the api refuses to start (`NODE_ENV=production`
in this file) unless `OECP_MAIL_LOG_LINKS=true`; it then sends nothing and logs
one warning per e-mail, the invitation text and link only at `LOG_LEVEL=debug`
(`bootstrap-alliance-admin` prints its link anyway).

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
docker compose --profile observability up -d    # add metrics, logs (Alloy → Loki) and alerting
docker compose --profile backup up -d           # add scheduled backups (pgBackRest)
scripts/restore-drill.sh                        # restore the latest backup into a scratch container
docker compose down                        # stop (volumes are kept)
```

`docker compose down -v` deletes **all data** (databases, uploads,
certificates **and the local backup repository** `pgbackrest-repo`); there is no undo.

## Configuration

- **`.env`** (from `.env.example`): hosts, ports, allowlists, SMTP, image tag;
  every variable is documented there.
- **`secrets/`**: Docker secrets (database passwords, Keycloak admin,
  `oecp-backend` client secret, `oecp_master_key`, the four SAML key-pair
  files `keycloak_saml_*`, Grafana admin; optional
  SMTP, alert SMTP and pgBackRest repo2 secrets); see
  [`secrets/README.md`](secrets/README.md). They are mounted under
  `/run/secrets/`, never passed as environment variables. The api/worker
  entrypoint injects the database password into `DATABASE_URL`.
- **`traefik/dynamic/middlewares.yaml`**: security headers, rate limits, TLS
  options.
- **`traefik/dynamic/tls.yaml.example`** and **`tls/`**: TLS with certificates
  issued by the hosting institution (copy the example to `tls.yaml`, git-ignored;
  PEM chains and keys in `tls/`, mounted read-only; [`tls/README.md`](tls/README.md)).
- **`identity/keycloak/realm-oecp.yaml`**: the realm as code; see
  [`identity/keycloak/README.md`](../../identity/keycloak/README.md).

### Branding

The alliance's own header image (home page and course list) and logo (site header) are
deployment configuration, never repository content: put the files in
[`branding/`](branding/README.md) (or the directory named by
`OECP_BRANDING_DIR`), which `web` mounts read-only and serves at
`/branding/<file>`. Enable them in `.env` with `OECP_HERO_IMAGE`
(e.g. `/branding/hero.jpg`), `OECP_HERO_IMAGE_ALT` (empty = decorative),
`OECP_HERO_IMAGE_COURSES` and `OECP_HERO_IMAGE_COURSES_ALT` (a different image
for the course list; empty = the home image) and `OECP_LOGO_IMAGE`
(e.g. `/branding/logo.svg`, alt text = `OECP_ALLIANCE_NAME`); all empty by
default. `OECP_FAVICON_IMAGE` (e.g. `/branding/favicon.svg`) replaces the
portal's own favicon. Partner logos need no variable: a file
`partner-<slug>.svg` (or `.png`, `.webp`, named after the organization's slug)
is shown next to that university's name on the course cards and the course
page, found through `/branding/index.json` (the directory's file list, re-read
at most once a minute). File-name rule, recommended sizes and permissions (uid
1000): [`branding/README.md`](branding/README.md).

### Local development profile (`dev`)

The `dev` profile adds Mailpit, the OEAPI mock and the test SAML IdP, in `compose.yaml` itself (like
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
end-to-end suite (also run in CI): [`tools/e2e-identity`](../../tools/e2e-identity/README.md).

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
| `api-docs` (`/api/public/v1/docs`, `/api/admin/v1/docs`, `/api/docs-assets/`; priority 110, above `api-admin`) | `security-headers` + `security-headers-api-docs` instead of `security-headers-api`: the OpenAPI viewer pages (vendored Redoc) need `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (Redoc injects `<style>` elements), `img-src 'self' data:`, `connect-src 'self'` (the `openapi.json`) and `worker-src 'self' blob:` (search index); everything else stays `'none'`. Plus `ratelimit-docs` (10 r/s, burst 20) |
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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_STARTTLS`, `SMTP_USER`, `SMTP_PASSWORD_FILE` | api, worker | from `OECP_SMTP_*` in `.env`; the password as Docker secret `smtp_password` (commented in `compose.yaml`) |
| `OECP_MAIL_LOG_LINKS` | api, worker | `false`: an empty `SMTP_HOST` stops the process (spec Appendix B) |
| `OECP_LOG_CLIENT_ADDRESSES` | api | `false`: request logs carry no client address nor User-Agent (spec §10) |
| `OECP_PUBLIC_BASE_URL` | api, worker | `https://${OECP_PORTAL_HOST}` (invitation links) |
| `NUXT_PUBLIC_API_BASE` | web | `https://${OECP_PORTAL_HOST}` (origin only: the app appends `/api/public/v1/...`) |
| `NUXT_PUBLIC_I18N_BASE_URL` | web | `https://${OECP_PORTAL_HOST}` (absolute hreflang links) |
| `NUXT_API_INTERNAL_BASE` | web | `http://api:3000` (server-side rendering) |
| `NUXT_PUBLIC_OIDC_AUTHORITY`, `NUXT_PUBLIC_OIDC_CLIENT_ID` | web | `https://${OECP_AUTH_HOST}/realms/oecp`, `oecp-admin` |
| `NUXT_PUBLIC_ALLIANCE_NAME` | web | from `OECP_ALLIANCE_NAME` |
| `NUXT_BRANDING_DIR`, `NUXT_PUBLIC_HERO_IMAGE`, `NUXT_PUBLIC_HERO_IMAGE_ALT`, `NUXT_PUBLIC_HERO_IMAGE_COURSES`, `NUXT_PUBLIC_HERO_IMAGE_COURSES_ALT`, `NUXT_PUBLIC_LOGO_IMAGE`, `NUXT_PUBLIC_FAVICON_IMAGE` | web | `/data/branding` and the `OECP_HERO_IMAGE*` / `OECP_LOGO_IMAGE` / `OECP_FAVICON_IMAGE` values ([Branding](#branding)) |
| `NUXT_CSP_MODE` | web | `enforce` (or `report-only`, `off`): the portal's nonce-based Content-Security-Policy |
| `OECP_UPLOADS_DIR` | api, worker | `/data/uploads` (volume `uploads`, CSV files kept 90 days) |
| `OECP_ALLOW_INSECURE_PARTNER_HTTP` | api, worker | `false` (development against `oeapi-mock` only) |
| `OECP_PUBLISH_RULE` | api, worker | `warn` (or `enforce`): IT Handbook publication rule |
| `OECP_DORMANCY_DRY_RUN`, `OECP_DORMANCY_DAYS`, `OECP_ACCOUNT_CLEANUP_DRY_RUN`, `OECP_ACCOUNT_DELETE_MONTHS` | api, worker | `true`, `180`, `true`, `12`: maintenance jobs stay dry runs until the alliance enables them |
| `OECP_RETENTION_HISTORY_MONTHS`, `…_SYNC_ERRORS_MONTHS`, `…_SYNC_RUNS_MONTHS`, `…_AUDIT_MONTHS`, `…_SOFT_DELETED_MONTHS` | api, worker | `12`, `12`, `24`, `36`, `12` (spec §10) |
| `OECP_IDP_METADATA_*` | api, worker | metadata refresh of the partner IdPs; empty `OECP_IDP_METADATA_URL` = disabled ([`identity/keycloak/README.md`](../../identity/keycloak/README.md)) |
| `OECP_METRICS_ENABLED`, `OECP_GIT_COMMIT` | api, worker | `true` (`/metrics` on the internal network), `unknown` (label of `oecp_build_info`) |

`OTEL_*` variables are passed for the observability profile; the application
reads every other variable listed above.

### Log retention

Spec §10 keeps application logs 90 days and access logs 30 days.

**Time-based retention: Loki, fed by Alloy (profile `observability`).** The
`alloy` service (Grafana Alloy, `observability/alloy.alloy`) discovers the
containers of this Compose project (label `com.docker.compose.project`, from
`COMPOSE_PROJECT_NAME`, default `oecp`) and streams their stdout/stderr to Loki
through the Docker API, which works the same on Linux hosts and on Docker
Desktop. Each stream is labelled `service` (the Compose service), `container`
and `project`; one-off `docker compose run` containers are skipped. Traefik
lines also get `log_type="access"` (a JSON access-log line) or `log_type="app"`
(Traefik's own log); api and worker numeric levels (pino) are named so that
Loki's `detected_level` works for every service. Loki (`observability/loki.yaml`)
deletes, through its compactor:

| Streams | Retention |
|---|---|
| `{service="traefik", log_type="access"}` (client addresses: personal data) | 30 days (`retention_stream`) |
| everything else | 90 days (`retention_period`) |

Query in Grafana (http://127.0.0.1:3001): dashboard **OECP logs** (folder
OECP: log volume by service and by level, errors and warnings, a log panel
filtered by `service` and a search box, the Traefik access log), or *Explore*
with data source Loki, e.g. `{service="api"} | json | res_statusCode >= 500`
or `{service="worker"} |= "harvest"`. Loki has no published port; from the
shell: `docker compose exec grafana wget -qO- 'http://loki:3100/loki/api/v1/label/service/values'`.
Alloy keeps its read positions in the volume `alloy_data`, so a restart does
not resend lines; logs written while Alloy was stopped are read on restart
from the json-file buffer, if still there.

**Docker socket proxy (trade-off).** Alloy never sees the Docker socket. The
`docker-socket-proxy` service (HAProxy) has the socket mounted read-only and
answers only `GET` on `/containers` (list, inspect, logs), `/events` and
`/networks` (Alloy's discovery lists them); every other endpoint and every
`POST`/`PUT`/`DELETE` gets 403. It sits on the internal network `docker-api`,
joined by `alloy` only (never `edge`). The proxy itself still needs the socket,
and container logs can contain whatever the applications write; it is the
narrowest exposure that gives container logs without host-specific paths
(`/var/lib/docker/containers` cannot be bind-mounted on Docker Desktop).

**Local fallback: Docker `json-file` (size-based).** Every service still logs to
Docker's `json-file` driver with rotation (`x-logging` in `compose.yaml`;
Traefik has its own `x-logging-traefik`). It is what `docker compose logs`
reads, Alloy's source, and the only copy when the `observability` profile is
not running:

| Variables | Default | Applies to |
|---|---|---|
| `OECP_LOG_MAX_SIZE` × `OECP_LOG_MAX_FILE` | `10m` × `5` (50 MB per container) | every service except Traefik |
| `OECP_TRAEFIK_LOG_MAX_SIZE` × `OECP_TRAEFIK_LOG_MAX_FILE` | `20m` × `10` (200 MB) | Traefik (its log and, when enabled, the access log) |

The driver's limits are **size-based**, not time-based: a container keeps at
most `max-file` × `max-size`, so the age covered depends on the volume. With
Alloy running, the time-based retention is Loki's and these sizes only need to
cover a few days (an Alloy or Loki outage); they can be reduced. Without the
`observability` profile, size them from what a container writes per day:

```sh
docker inspect --format '{{.LogPath}}' oecp-api-1   # then measure the file's growth over a day
```

For application logs choose `max-file` × `max-size` ≈ 90 × daily volume (e.g.
2 MB a day → `10m` × `18`); the oldest lines then go after about 90 days, or
earlier under a burst. For Traefik with the access log, ≈ 30 × daily volume,
and never more: client addresses are personal data. Changing the variables
recreates the containers (`docker compose up -d`).

**Traefik access log.** Off by default. `OECP_TRAEFIK_ACCESS_LOG=true` writes
one JSON line per request (request headers dropped; client address, method,
path, status, duration kept) to Traefik's stdout: Loki keeps it 30 days, the
json-file bound above applies locally. The commented lines in the `traefik`
service drop the client address too or write to a file (which then needs
`logrotate` and `USR1`, outside this file, and is not shipped by Alloy).

**API request logs** contain method, URL, status, duration and, for admin
requests, the JWT `sub`; never headers, client address or User-Agent.
`OECP_LOG_CLIENT_ADDRESSES=true` adds a salted SHA-256 (16 hex characters) of
the client address; the salt is random per process, so values cannot be
linked across restarts.

## Backups (profile `backup`)

Spec §10: pgBackRest for the whole PostgreSQL cluster (databases `oecp` and
`keycloak`, roles, settings), continuous WAL archiving for point-in-time
recovery (PITR), a full backup every week and a differential every other day,
35 days of recovery window, a second site, and a quarterly restore drill.

```
postgres ──archive_command──▶ pgBackRest repo1 (volume pgbackrest-repo) ──┐
   ▲  (every WAL segment, ≤ 5 min)                      repo2 (optional) ◀┘ second site: S3/MinIO or SFTP
   │ Unix socket (volume postgres_socket)
backup ── 02:00 UTC: full (Sunday) / diff ── uploads-YYYY-MM-DD.tar.gz ── oecp_backup.prom ──▶ node-exporter
```

- **Image.** `postgres` is built from `postgres:16.15` plus the PGDG packages
  `pgbackrest` and `jq` (pinned in `dockerfiles/postgres.Dockerfile`, about
  5 MB more), runs as uid 999. Same PostgreSQL minor and data volume as before,
  so an existing stack switches with `docker compose up -d --build postgres`;
  the WAL settings (`archive_mode=on`, `archive_command`, `wal_level=replica`,
  `archive_timeout=300`) are passed on the command line in `compose.yaml` and
  override `postgresql.conf` of the data directory.
- **WAL archiving** runs in the `postgres` container even without the `backup`
  profile. `OECP_WAL_ARCHIVE=auto` (default) archives once the stanza exists
  (created by the first start of `backup`); before that segments are dropped
  (no base backup exists to use them), so `docker compose up -d` alone never
  fills `pg_wal`. Set `on` in production once the stanza exists: a failing
  archive then keeps WAL and alerts (`OecpWalArchivingFailing`).
- **Schedule** (`postgres/bin/oecp-backup`, a sleep loop, no cron daemon):
  at start `stanza-create` (idempotent) and `check`, then a backup at once if
  the newest is older than `OECP_BACKUP_CATCHUP_HOURS` (24; a full if the
  repository is empty); daily at `OECP_BACKUP_TIME` (02:00 UTC) a `full` on
  `OECP_BACKUP_FULL_DAY` (7 = Sunday) or when the newest full is older than 7
  days, a `diff` otherwise, then the uploads archive.
- **Retention.** `postgres/pgbackrest.conf`: `repo1-retention-full-type=time`,
  `repo1-retention-full=35`: pgBackRest keeps every full backup (with its
  differentials and WAL) needed to restore any point of the last 35 days, so
  about six weekly fulls. Uploads archives: `OECP_BACKUP_UPLOADS_RETENTION_DAYS`
  (35), in `uploads/` of the same volume. Compressed with zstd, bundled,
  block-incremental differentials; repo1 is not encrypted (same host and
  protection as `postgres_data`).
- **Second site (repo2).** Copy `postgres/pgbackrest-repo2.env.example` to
  `.env.pgbackrest` (git-ignored, optional `env_file` of `postgres` and
  `backup`) and follow its steps: S3/MinIO or SFTP, always encrypted (Docker
  secrets `pgbackrest_repo2_*`), outbound network for both services. Every WAL
  segment and backup then goes to both repositories. The uploads archives are
  not pgBackRest data: copy `uploads/` of the volume yourself.
- **Metrics** for alerting: node-exporter's textfile collector reads
  `oecp_backup.prom` from the tmpfs volume `backup-metrics`, rewritten every
  minute from the repository (`pgbackrest info`), the archives and
  `pg_stat_archiver`: `oecp_backup_last_success_timestamp_seconds{type="pgbackrest"|"uploads"}`,
  `oecp_backup_last_duration_seconds{type}`, `oecp_backup_last_attempt_success{type}`,
  `oecp_backup_pgbackrest_last_full_timestamp_seconds`, `oecp_backup_pgbackrest_backups{backup_type}`,
  `oecp_wal_archive_last_success_timestamp_seconds`, `oecp_wal_archive_last_failure_timestamp_seconds`, …
  (list in the script header). Chosen over a sidecar because node-exporter also
  provides the disk metrics.
- **Permissions.** `backup` runs as uid 999 without network
  (`network_mode: none`), reads `postgres_data` read-only and the uploads
  through the api user's group (`group_add: ["1000"]`); PostgreSQL's Unix
  socket (trusted local connections) is shared only with it.

```sh
docker compose --profile backup up -d --build
docker compose logs -f backup
docker compose exec backup pgbackrest --stanza=oecp info          # backups, WAL range
docker compose exec backup oecp-backup backup full                # on demand (or diff, incr)
docker compose exec backup oecp-backup uploads
docker compose exec backup oecp-backup metrics                    # prints oecp_backup.prom
docker compose exec postgres psql -U postgres -c 'SELECT * FROM pg_stat_archiver'
```

### Restore drill and restore

`scripts/restore-drill.sh` restores into a **scratch container** (no network,
repository read-only, `archive_mode=off`, so production and the repository are
untouched), waits for WAL replay, checks the databases (oecp reachable,
`keycloak` exists with realm `oecp`, latest migration, checksums, row counts of
`courses`, `organizations`, `maintenance_runs` compared with the live
database) and prints a report with the restore and recovery times. Run it
quarterly (runbook §4).

```sh
scripts/restore-drill.sh                                         # latest backup + all WAL
scripts/restore-drill.sh --target-time '2026-10-15 05:25:30+00'  # point in time
scripts/restore-drill.sh --set 20261015-052418F                  # one backup, no WAL replay past it
scripts/restore-drill.sh --keep                                  # inspect afterwards
scripts/restore-drill.sh --repo 2 --env-file .env.pgbackrest     # from the second site
```

A **real restore** replaces the cluster: stop the writers, restore into the
`postgres_data` volume with the same image, start again (runbook §3):

```sh
docker compose stop api worker keycloak backup postgres
docker compose run --rm --no-deps postgres pgbackrest --stanza=oecp --delta \
  [--type=time --target='YYYY-MM-DD HH:MM:SS+00' --target-action=promote] restore
docker compose up -d --wait
```

## Alerting

The `observability` profile evaluates `observability/alert-rules.yml` in
Prometheus and notifies through Alertmanager. Prometheus scrapes the api
(`api:3000/metrics`) and worker (`worker:3001/metrics`) over the internal
network (Traefik does not route `/metrics`), the `/ready` endpoints through the
blackbox exporter, node-exporter (disk of the data volumes, backup textfile
metrics), Traefik, Keycloak, the OpenTelemetry Collector, Alertmanager, the
blackbox exporter and itself. The blackbox exporter also probes
`https://traefik:443/` (job `tls`, module `http_tls`, certificate not
verified) for `probe_ssl_earliest_cert_expiry`; it sends no portal host as
SNI, so it sees Traefik's default certificate: in production make the portal
certificate the default, otherwise the probe watches Traefik's self-generated
one. With ACME: labels
`traefik.tls.stores.default.defaultgeneratedcert.resolver=le` and
`…domain.main=${OECP_PORTAL_HOST}` on `traefik`. With institution-issued
certificates: `defaultCertificate` in `traefik/dynamic/tls.yaml` (copied from
`tls.yaml.example`).

| Alert | Condition (spec §10 in bold) | Severity |
|---|---|---|
| `OecpHarvestFailing` | **2 consecutive failed OEAPI harvests** of a partner | warning |
| `OecpBackupTooOld` | **newest pgBackRest or uploads backup older than 26 h** | critical |
| `OecpBackupMissing`, `OecpBackupFailed`, `OecpBackupMetricsStale`, `OecpBackupNoRecentFull` | no backup metrics for 1 h; last attempt failed; backup service stopped; no full for 8 days | critical / warning |
| `OecpWalArchivingFailing` | archive_command failing for 15 min | critical |
| `OecpDiskSpaceLow` | **disk > 80 %** (warning), > 90 % (critical) | warning / critical |
| `OecpIdpCertificateExpiring` | SAML signing certificate of an enabled partner IdP in Keycloak (latest of its certificates) expires within 30 days (warning) or 7 days (critical) | warning / critical |
| `OecpIdpCertificateExpired`, `OecpIdpCertificateCheckStale` | every signing certificate of an enabled IdP expired; the worker has not read the certificates from Keycloak for 24 h | critical / warning |
| `OecpTlsCertificateExpiring`, `OecpTlsProbeFailing` | certificate Traefik serves on :443 expires within 21 days (warning: ACME renews at 30, so renewal is failing; with institution-issued certificates, renewal is due) or 7 days (critical); TLS probe failing for 15 min | warning / critical |
| `OecpIdpMetadataRefreshFailed`, `…Stale` | **metadata-refresh failure**; no success for 26 h | warning |
| `OecpApiHigh5xxRate`, `OecpEdgeHigh5xxRate` | **5xx > 1 %** of api responses (or per Traefik service) for 10 min, above 0.05 req/s | warning |
| `OecpServiceDown`, `OecpServiceNotReady` | api or worker not scraped / `/ready` failing for 2 min | critical |
| `OecpMaintenanceJobFailed`, `OecpMaintenanceJobStale`, `OecpHarvestStuck`, `OecpMonitoringTargetDown` | a maintenance run failed; a daily job without success for 26 h; harvest running 6 h; exporter down | warning |

**Receivers** (`.env`, rendered into `observability/alertmanager/alertmanager.yml.tmpl`
by its `entrypoint.sh` at every start): e-mail to `OECP_ALERT_EMAIL_TO` through
`OECP_ALERT_SMTP_HOST`/`_PORT`/`_REQUIRE_TLS` (default: the application's
`OECP_SMTP_*`; with the `dev` block alert mail lands in Mailpit), optional
SMTP AUTH (`OECP_ALERT_SMTP_USER`, secret `alert_smtp_password`), sender
`OECP_ALERT_EMAIL_FROM`; and/or a generic webhook `OECP_ALERT_WEBHOOK_URL`
(Alertmanager's JSON payload). Critical alerts repeat every 2 h, warnings every
12 h. Inhibitions: a critical alert silences its warning level; an api or
worker that is down or not ready silences the alerts about its work.

Grafana provisions the dashboards **OECP logs** ([Log retention](#log-retention))
and **OECP overview** (folder OECP: status,
requests and 5xx ratio, p95 latency by route, harvest status per partner,
maintenance jobs, IdP metadata, backup age and duration, disk, days to the
IdP and TLS certificate expiry) and an
Alertmanager data source (Alerting > Alert list, silences). Grafana
(`127.0.0.1:${GRAFANA_PORT}`, default 3001) and Alertmanager
(`127.0.0.1:${ALERTMANAGER_PORT}`, default 9093) listen on the server's loopback
only; Prometheus has no published port
(`docker compose exec prometheus wget -qO- localhost:9090/api/v1/alerts`).
Alertmanager is started with `--web.external-url=http://127.0.0.1:${ALERTMANAGER_PORT}`,
so the "View In Alertmanager" button of an alert mail points at that loopback
address (without it the button carries the container id, which resolves nowhere).
From your workstation it opens through an SSH tunnel, together with Grafana:

```sh
ssh -N -L 3001:127.0.0.1:3001 -L 9093:127.0.0.1:9093 <operator>@<host>
# then http://127.0.0.1:3001 (Grafana) and http://127.0.0.1:9093 (Alertmanager, and the link in the mail)
```

If you change a port in `.env`, change the same number on the local side of the
tunnel, because the link in the mail keeps `${ALERTMANAGER_PORT}`.

Validate after editing (CI runs the three checks on every push; the delivery test is manual):

```sh
docker run --rm --entrypoint promtool -v "$PWD/observability:/c:ro" -w /c prom/prometheus:v3.15.0 check rules alert-rules.yml
docker run --rm --entrypoint promtool -v "$PWD/observability:/c:ro" -w /c prom/prometheus:v3.15.0 test rules alert-rules.test.yml
docker compose --profile observability exec alertmanager amtool check-config /alertmanager/alertmanager.yml
docker compose --profile observability exec alertmanager amtool --alertmanager.url=http://127.0.0.1:9093 \
  alert add OecpTestAlert severity=warning component=monitoring   # delivery test
```

## Production checklist

1. **DNS and TLS.** Point the portal and auth hosts at the server. In the
   `traefik` service, either uncomment the *PRODUCTION* block (ACME with the
   TLS-ALPN challenge, `ACME_EMAIL`) **or**, for certificates issued by the
   hosting institution, put the PEM chains and keys in `tls/` (names and
   permissions in [`tls/README.md`](tls/README.md)), check them with `openssl
   x509 -noout -dates -subject -ext subjectAltName`, copy
   `traefik/dynamic/tls.yaml.example` to `traefik/dynamic/tls.yaml` and run
   `docker compose up -d traefik`; never both. Renew the latter by hand every
   year ([runbook](../../docs/production/runbook.md#certificate-renewal-institution-issued):
   replace the files, then `touch traefik/dynamic/tls.yaml`, Traefik does not
   watch the PEM files). Remove `--api.insecure` and the
   dashboard port. Consider a Docker socket proxy instead of the raw socket.
2. **Allowlists.** Set `KEYCLOAK_ADMIN_ALLOWLIST` to the operators' networks.
   If a load balancer fronts Traefik, configure `forwardedheaders.trustedips`
   and the rate-limit `ipStrategy` (comments in the files) so limits apply
   per client.
3. **Keycloak admin.** `KEYCLOAK_ADMIN_USER` of the `master` realm is the
   configuration service account of `keycloak-config` (no MFA, never deleted;
   password only in `secrets/keycloak_admin_password`, rotated per
   `secrets/README.md`); create separate permanent `master` administrators with
   MFA for people, behind the allowlist.
4. **Secrets.** Generate on the server, keep an offline copy of
   `oecp_master_key`.
5. **Mail.** Never enable the `dev` profile; set `OECP_SMTP_*` to the host
   institution relay (`OECP_SMTP_STARTTLS=true` if it offers TLS; SMTP AUTH
   with `OECP_SMTP_USER` and the `smtp_password` secret). Keep
   `OECP_MAIL_LOG_LINKS=false`.
6. **Logs.** Run the `observability` profile so that Alloy ships the logs to
   Loki (90 days, Traefik access log 30 days; section
   [Log retention](#log-retention)); otherwise size the json-file rotation for
   the retention of spec §10. Enable the Traefik access log only with a 30-day
   bound.
7. **Backups (spec §10).** Run the `backup` profile; configure repo2 (second
   site, encrypted, [Backups](#backups-profile-backup)) and copy the uploads
   archives there; set `OECP_WAL_ARCHIVE=on` once the stanza exists; run
   `scripts/restore-drill.sh` before go-live and quarterly.
8. **Alerting.** Run the `observability` profile with `OECP_ALERT_EMAIL_TO`
   (and/or `OECP_ALERT_WEBHOOK_URL`) set; send a test alert
   ([Alerting](#alerting)). Make the portal certificate (ACME or
   institution-issued) Traefik's default so that the TLS expiry probe watches
   it. Prefer a node-exporter on the host itself
   for disk alerts on every filesystem.
9. **Images.** Build in CI, sign with cosign and pin by digest
   (`OECP_IMAGE_TAG`) rather than building on the server.
10. **SAML.** Create the SAML key pairs (`tools/scripts/gen-saml-keys.sh`, in
   step 2 above) and register the SP metadata that
   `tools/scripts/sp-metadata.mjs` generates from them (see
   [`identity/keycloak/scripts/sp-metadata.md`](../../identity/keycloak/scripts/sp-metadata.md));
   it can be sent to the federation before the server has DNS and TLS.

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
- **`backup` restarts, "stanza-create/check failed":** `docker compose logs
  backup postgres`. `check` needs archive_command to work: with
  `OECP_WAL_ARCHIVE=off` it fails; after a repository change run
  `docker compose exec backup pgbackrest --stanza=oecp stanza-create` again.
- **`pg_wal` grows:** archiving is failing (`SELECT * FROM pg_stat_archiver`,
  `last_failed_wal`); with `OECP_WAL_ARCHIVE=on` this happens until the stanza
  exists or the repository is reachable again.
- **Restore drill: "unable to restore while PostgreSQL is running":** a kept
  scratch container was killed; `docker volume rm oecp_restore-drill-pgdata`.
