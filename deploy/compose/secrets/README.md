<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Docker secrets

`compose.yaml` mounts each file in this directory as a Docker secret under
`/run/secrets/<name>` in the services that need it. **Never commit them**: the
`.gitignore` here only lets `README.md`, `.gitkeep` and `.gitignore` through.

| File | Used by | Content |
|---|---|---|
| `postgres_superuser_password` | postgres | Password of the `postgres` superuser |
| `oecp_db_password` | postgres (init), api, worker | Password of role `oecp`, owner of database `oecp` |
| `keycloak_db_password` | postgres (init), keycloak | Password of role `keycloak`, owner of database `keycloak` |
| `keycloak_admin_password` | keycloak, keycloak-config | Password of the temporary bootstrap admin of the `master` realm |
| `oecp_backend_client_secret` | keycloak-config, api, worker | Secret of the confidential client `oecp-backend` (spec §3) |
| `oecp_master_key` | api, worker | AES-256-GCM master key of the `secrets` table (spec §10): 32 random bytes, base64 |
| `grafana_admin_password` | grafana (profile `observability`) | Grafana `admin` password |

Optional, commented out in `compose.yaml` until used:

| File | Used by | Content |
|---|---|---|
| `smtp_password` | api, worker | SMTP AUTH password (`OECP_SMTP_USER`) |
| `alert_smtp_password` | alertmanager (profile `observability`) | SMTP AUTH password for alert mail (`OECP_ALERT_SMTP_USER`) |
| `pgbackrest_repo2_cipher_pass` | postgres, backup (profile `backup`) | Encryption passphrase of pgBackRest repo2, the second site (`openssl rand -base64 48`); without it repo2 cannot be restored: keep it with the offline copy |
| `pgbackrest_repo2_s3_key_secret` | postgres, backup | S3 secret access key of repo2 |

Any file named `pgbackrest_<option>` mounted into `postgres` or `backup` sets
that pgBackRest option (`postgres/bin/pgbackrest`); see
[`../postgres/pgbackrest-repo2.env.example`](../postgres/pgbackrest-repo2.env.example).

## Create them

Run from `deploy/compose/`. Files must have **no trailing newline** (Keycloak
and keycloak-config-cli read them verbatim) and must be readable by the
container users (postgres uid 999, keycloak uid 1000, node uid 1000), so the
directory is private and the files are world-readable inside it:

```sh
cd deploy/compose
chmod 700 secrets
for name in postgres_superuser_password oecp_db_password keycloak_db_password \
            keycloak_admin_password oecp_backend_client_secret grafana_admin_password; do
  [ -f "secrets/$name" ] || openssl rand -hex 32 | tr -d '\n' > "secrets/$name"
done
[ -f secrets/oecp_master_key ] || openssl rand -base64 32 | tr -d '\n' > secrets/oecp_master_key
chmod 644 secrets/*
```

On a shared host, prefer restricting the files to the container uids
(`chown`) or a dedicated group instead of mode 644.

## Rotation

- **Database passwords:** `ALTER ROLE ... PASSWORD` in PostgreSQL, update the
  file, then `docker compose up -d --force-recreate` the affected services.
  The init script only runs on an empty data volume.
- **`oecp_backend_client_secret`:** update the file and run
  `docker compose run --rm keycloak-config`, then recreate api and worker.
- **`oecp_master_key`:** never replace in place; rotation adds a new key
  version (spec §10, `key_version`) through the application.
- **`keycloak_admin_password`:** only used when Keycloak first creates the
  temporary admin. Replace that admin by a permanent one with MFA, then keep
  the file in sync with whatever account keycloak-config-cli uses.

Keep an offline, access-controlled copy of `oecp_master_key`: without it the
encrypted partner credentials in the database cannot be recovered.
