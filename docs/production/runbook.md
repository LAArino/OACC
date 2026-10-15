<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Production runbook: OECP at the hosting institution

For the hosting operator (URV for Aurora). It complements [deploy/compose/README.md](../../deploy/compose/README.md) (installation), [Guide A](../onboarding/alliance.md) (alliance set-up), [identity/keycloak/README.md](../../identity/keycloak/README.md) and [RELEASING.md](../RELEASING.md). Commands run in `deploy/compose` on the production host. Written for release 0.3.0 and updated for the unreleased changes after it (maintenance page, account clean-up, log retention; see the CHANGELOG); where something is planned but not built, this runbook says so.

## 1. Topology and environments

One Docker Compose project on one host (spec §3): `traefik` (TLS, routing, rate limits) → `web` (Nuxt), `api` (NestJS), `keycloak`; `worker` (same image as `api`: harvests, CSV jobs, maintenance, IdP metadata refresh); `postgres` 16 (databases `oecp`, `keycloak`); `valkey` (queues, rebuildable); volumes `postgres_data`, `uploads`, `idp-metadata`, `traefik_acme`, `valkey_data`. Networks: `edge`, `backend`, `egress` (worker → partner OEAPI endpoints only).

| Environment | Hosts | Purpose |
|---|---|---|
| Production | `[TO COMPLETE: portal host]`, `[TO COMPLETE: auth host]` (same registrable domain, spec §4) | Live catalogue |
| Staging | `[TO COMPLETE: or "none"]` | Upgrade rehearsal, restore drills |
| Development | `oecp.localhost` (profile `dev`) | Never with real data |

Server: `[TO COMPLETE: host name, OS, CPU, RAM ≥ 4 GB with 2 GB for the worker, disk]`. Public outbound IP (given to partners for their allowlists): `[TO COMPLETE]`. Never enable the `dev` profile (Mailpit, OEAPI mock, test IdP) or `OECP_ALLOW_INSECURE_PARTNER_HTTP` in production.

## 2. Secrets inventory and rotation

Files in `deploy/compose/secrets/` (mode 700 directory), mounted as Docker secrets ([secrets/README.md](../../deploy/compose/secrets/README.md)). Keep an offline, access-controlled copy of all of them: `[TO COMPLETE: where]`.

| Secret | Used by | Rotation |
|---|---|---|
| `postgres_superuser_password` | postgres | `ALTER ROLE postgres PASSWORD …`, update file; yearly `[TO COMPLETE]` |
| `oecp_db_password`, `keycloak_db_password` | api, worker / keycloak | `ALTER ROLE`, update file, `docker compose up -d --force-recreate api worker` (or `keycloak`) |
| `keycloak_admin_password` | bootstrap of the `master` realm, keycloak-config | Replace the bootstrap admin by a permanent `master` admin with MFA at installation; keep the file in sync with the account keycloak-config-cli uses |
| `oecp_backend_client_secret` | keycloak-config, api, worker | Update file, `docker compose run --rm keycloak-config`, recreate `api` and `worker`. High impact: the client manages realm users |
| `oecp_master_key` (`key_version` 1) | api, worker | **Rotation not implemented**: one key version is supported. Never replace the file alone (stored credentials would no longer decrypt). If compromised: get new credentials from every partner, write a new key, recreate `api` and `worker`, re-enter each credential in *Integration settings* and re-run `store-secret` for `SURFEDUHUB_SECRET_REF` |
| `grafana_admin_password` | grafana (profile `observability`) | Update file and recreate |
| Federation signing certificate (PEM, public) | worker (`OECP_IDP_METADATA_SIGNING_CERT_FILE`) | Not secret but the only trust anchor of the metadata refresh. Replace before the federation's key rollover, after checking its fingerprint with a second source (Guide A, step 3) |
| Partner OEAPI credentials | `secrets` table | Per access agreement; replace in *Integration settings* (write-only) |
| SURFeduhub credential, if used | `secrets` table (`store-secret`) | `[TO COMPLETE: used or not]` |
| ACME account, TLS keys | volume `traefik_acme` | Automatic renewal |
| Keycloak realm keys (token signing, SAML SP signing and encryption) | `keycloak` database | Rotating SAML SP keys requires new SP metadata at the federation (SIR/RedIRIS) and at every partner IdP: plan it |

## 3. Backups and point-in-time recovery

**Status:** OECP ships **no backup**. pgBackRest (WAL archiving to a second site, weekly full, daily differential, 35 days, PITR) is planned (spec §10, backlog). Until it exists, run this interim procedure daily (`[TO COMPLETE: cron or scheduler, time]`); recovery point objective is then 24 hours.

```sh
TS=$(date -u +%Y%m%dT%H%MZ); DEST=[TO COMPLETE: backup directory]
docker compose exec -T postgres pg_dumpall -U postgres --globals-only > "$DEST/globals-$TS.sql"
docker compose exec -T postgres pg_dump -U postgres -Fc oecp     > "$DEST/oecp-$TS.dump"
docker compose exec -T postgres pg_dump -U postgres -Fc keycloak > "$DEST/keycloak-$TS.dump"
docker run --rm -v oecp_uploads:/data:ro -v "$DEST":/out alpine tar czf "/out/uploads-$TS.tgz" -C /data .
```

The volume name depends on the Compose project name (`docker volume ls`). Then: encrypt the files (they hold personal data, password hashes and TOTP secrets) `[TO COMPLETE: tool, key custody]`, copy them to `[TO COMPLETE: second site]`, delete copies older than `[TO COMPLETE: e.g. 35 days]`. Valkey and `idp-metadata` need no backup (schedules are re-registered at worker start; the aggregate is downloaded again).

## 4. Restore drill

Quarterly and before go-live, on a staging host or a separate Compose project (`docker compose -p oecp-drill …`) with copies of the secrets: start `postgres` on an empty volume (the init script creates roles and databases), then for each database:

```sh
docker compose exec -T postgres psql -U postgres -c 'DROP DATABASE oecp' -c 'CREATE DATABASE oecp OWNER oecp TEMPLATE template0'
docker compose exec -T postgres pg_restore -U postgres -d oecp --exit-on-error < oecp-<TS>.dump
```

Same for `keycloak`; restore `uploads`; start everything; `docker compose run --rm api pnpm db:migrate` must report no pending migration; run the smoke test of the Compose README; sign in as an administrator; compare course counts with production. Record date, duration (recovery time) and problems: `[TO COMPLETE: drill log location]`.

## 5. Upgrades

Order from [RELEASING.md](../RELEASING.md#migrations): read the CHANGELOG (`BREAKING` items, new variables, migration notes); **back up**; `docker compose stop worker`; build or pull the new images; **migrate with the new image**; then start the new `api`, `worker`, `web`:

```sh
OECP_IMAGE_TAG=X.Y.Z docker compose build api web keycloak   # until images are published
OECP_IMAGE_TAG=X.Y.Z docker compose run --rm api pnpm db:migrate
OECP_IMAGE_TAG=X.Y.Z docker compose up -d --wait
```

Rollback = restore the backup taken before the upgrade (down migrations are a development aid). Only the latest minor is supported. After the upgrade check worker health, `maintenance_runs` and the next harvest.

## 6. Identity operations

**Realm re-import.** `keycloak-config` applies `identity/keycloak/realm-oecp.yaml` on every `docker compose up`: never edit declared objects in the console (reverted), and objects removed from the file are deleted. It also **resets partner IdP certificates and endpoints to the committed values** until the worker's start-up metadata refresh, about 60 s after the worker starts (spec §4). If `OECP_IDP_METADATA_URL` is unset or `OECP_IDP_METADATA_REFRESH_ON_START=false`, the reset lasts until 04:15 UTC: brokered sign-in can fail meanwhile. Keep committed certificates current; after any `up`, check the worker log for the refresh.

**Partner IdP onboarding:** procedure in the Keycloak README ("Adding a partner IdP"): organization first, IdP block (alias = slug), principal `subject-id` or `pairwise-id`, apply, regenerate and resubmit SP metadata, test with an invitation. Not yet verified with a real eduGAIN IdP (backlog).

**Certificate expiry.** The refresh drops expired IdP certificates and warns 30 days ahead; an IdP without a valid certificate fails. Watch the worker log (no alerting). Federation signing key: section 2. TLS: Traefik renews; check expiry monthly.

## 7. Monitoring and alerts

There is **no alerting** in 0.3.0 and no OpenTelemetry SDK in the apps (spec §10). Until there is, set up:

| Check | How | Frequency |
|---|---|---|
| External availability | HTTPS probe of `/en`, `/oeapi/v5/`, `https://<auth host>/realms/oecp/.well-known/openid-configuration` `[TO COMPLETE: monitoring system]` | 1–5 min |
| Container health | `docker compose ps`: every service *healthy* (worker healthcheck = internal `/ready`) | Probe or daily |
| Worker schedules | `docker compose exec worker node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.text()).then(console.log)"` lists jobs and next runs | Weekly |
| Maintenance runs | Admin panel *Maintenance* (`/en/admin/maintenance`, alliance admins; or `GET /api/admin/v1/maintenance/runs`, Guide A, step 9): latest run of `history-partitions`, `idp-metadata-refresh`, `csv-retention`, `retention`, `dormancy`, `account-cleanup` *Succeeded* | Weekly |
| Harvest failures | *Network status* and *Sync history* in the panel; `oecp.oeapi.mass_absence` stops withdrawals silently | Weekly |
| IdP metadata refresh | *Maintenance* page, job *IdP metadata refresh*: every run (daily, start-up, manual) with one line per IdP in its details; a failed IdP fails the run. Expiry warnings also in `docker compose logs --since 24h worker \| grep -i metadata` | Daily once an IdP is connected |
| Disk | `postgres_data`, `uploads`, Docker logs, backup directory | Weekly |

**Mail:** Mailpit is development only. Production needs `OECP_SMTP_HOST` set to the institutional relay `[TO COMPLETE: relay host and port]`: relay by source address, or SMTP AUTH (`OECP_SMTP_USER` and the Docker secret `smtp_password`, `OECP_SMTP_PASSWORD_FILE=/run/secrets/smtp_password`); `OECP_SMTP_STARTTLS=true` (Compose default) requires TLS. With `NODE_ENV=production` the api **refuses to start** without an SMTP host unless `OECP_MAIL_LOG_LINKS=true`; keep it `false`. Without an SMTP host (development) nothing is sent: one warning line per mail, and the text with the invitation link only at `LOG_LEVEL=debug`; treat any such debug line as a leaked credential and revoke the invitation.

## 8. Incident response

Breach path and timing: [art. 28 checklist, A.5](art28-processor-checklist.md#a5-personal-data-breaches-art-33-34) (controller notifies the authority within 72 hours, art. 33). First actions:

- **Administrator account compromised.** *Organizations* > organization > *Administrators* > *Remove* (roles and sessions revoked, audit `admin.revoke`; tokens already issued live ≤ 5 min). In the Keycloak console disable the user and remove its OTP credential. Review its actions: `docker compose exec postgres psql -U postgres -d oecp -c "SELECT occurred_at, action, entity_type, entity_id FROM audit_log WHERE actor_sub = '<sub>' ORDER BY occurred_at DESC"`; check integration changes (host approvals) and course status changes; correct through the panel.
- **Partner credential leaked.** Partner revokes it and issues a new one; replace it in *Integration settings*.
- **`oecp_backend_client_secret` or Keycloak master admin compromised.** Rotate at once (section 2); review Keycloak admin events (kept 90 days) and realm roles.
- **Master key and database both exposed.** Treat every partner credential as leaked; rotation procedure of section 2.
- **Invitation link exposed.** Revoke it (*Invitations* > *Revoke*); resend.
- **Bad data published.** Override or withdraw in the panel; disable the partner's harvest if needed.

Record every incident: `[TO COMPLETE: incident register]`.

## 9. Capacity

Worker ≥ **2 GB** RAM when the IdP metadata refresh uses the eduGAIN aggregate (about 750 MB measured for 75 MB; eduGAIN about 94 MB); Compose sets no limit; if needed `NODE_OPTIONS=--max-old-space-size=3072`. Uploads ≤ 5 MiB per file, 10 per hour per organization, kept 90 days. Raw payload history grows with changes only, 12–13 months kept. Search target p95 < 300 ms at 50 req/s is not measured. `[TO COMPLETE: measured sizes after the first months]`.

## 10. Log and data retention

**Logs.** Targets: application logs 90 days, Traefik access logs 30 days (spec §10). Configured in Compose ([Log retention](../../deploy/compose/README.md#log-retention)):

- Every container logs to Docker's `json-file` driver with rotation: `OECP_LOG_MAX_SIZE` × `OECP_LOG_MAX_FILE` (default 10m × 5), Traefik `OECP_TRAEFIK_LOG_MAX_SIZE` × `OECP_TRAEFIK_LOG_MAX_FILE` (20m × 10). The bound is **size-based**: measure each container's daily volume (`docker inspect --format '{{.LogPath}}' <container>`) and size the files for about 90 days (Traefik with access log: 30 days, never more). Chosen values: `[TO COMPLETE: sizes per container, date measured]`.
- The Traefik access log is **off by default**; `OECP_TRAEFIK_ACCESS_LOG=true` writes one JSON line per request with the client address but no request headers. Enabled: `[TO COMPLETE: yes/no, reason]`.
- API request logs carry method, URL, status, duration, request id and, for admin requests, the JWT `sub`; never headers, client address or User-Agent. `OECP_LOG_CLIENT_ADDRESSES=true` adds a salted SHA-256 of the address (salt random per process).
- Loki (profile `observability`) keeps 90 days (`observability/loki.yaml`, compactor), but nothing ships logs to it yet (backlog "Ship container logs to Loki"). Prometheus keeps 30 days. Keycloak events: 90 days (realm).

**Data.** The worker's `retention` job (04:45 UTC) deletes, besides old run errors, runs, audit entries, invitations and maintenance runs, the courses, offerings and organizations soft-deleted more than `OECP_RETENTION_SOFT_DELETED_MONTHS` (12) months ago (an organization only once nothing refers to it; counted `soft_deleted_organizations_kept` otherwise). The `account-cleanup` job (05:15 UTC) deletes the Keycloak accounts of former administrators 12 months after their roles were removed (`OECP_ACCOUNT_DELETE_MONTHS`); it runs in **dry run** until `OECP_ACCOUNT_CLEANUP_DRY_RUN=false`: `[TO COMPLETE: date enabled, after the Foundation reviewed a dry run]`. Harvested raw payloads are stored without person data (`coordinators`, `persons`, person members of `ext`). Data deleted by these jobs survives in backups until they expire (section 3).

## 11. Housekeeping checklist

**Weekly:** maintenance runs succeeded; network status and failed harvests; worker log errors; disk space; backup files present.
**Monthly:** restore one backup file (integrity); TLS and IdP certificate expiry; review `Administrators` panels; on the *Maintenance* page, review the latest `account-cleanup` run (dry run: the accounts it would delete and the kept ones with their reason; enabled: the deleted accounts); check the log volumes against the rotation sizes (section 10); apply OS and image security updates; check for a new OECP patch release.
**Quarterly:** restore drill; review the dormancy dry run on the *Maintenance* page until it is switched on; secrets offline copy current.
**Yearly:** rotate database and client secrets; review this runbook, the RoPA and the DPIA; recertify administrators with the Foundation.

## 12. Contacts

| Role | Name | Contact | Hours |
|---|---|---|---|
| Hosting operator on call | `[TO COMPLETE]` | `[TO COMPLETE]` | `[TO COMPLETE]` |
| URV security team / CSIRT | `[TO COMPLETE]` | `[TO COMPLETE]` | |
| URV DPO | `[TO COMPLETE]` | `[TO COMPLETE]` | |
| Aurora Foundation (controller) | `[TO COMPLETE]` | `[TO COMPLETE]` | |
| Foundation DPO | `[TO COMPLETE]` | `[TO COMPLETE]` | |
| Alliance administrators (at least two) | `[TO COMPLETE]` | `[TO COMPLETE]` | |
| Federation operator (SIR/RedIRIS) | `[TO COMPLETE]` | `[TO COMPLETE]` | |
| OECP maintainers (security reports) | see [SECURITY.md](../../SECURITY.md) | `[TO COMPLETE]` | |
