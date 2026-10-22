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
| `keycloak_saml_sig_key`, `keycloak_saml_sig_cert` | keycloak-config | Key pair of the realm's SAML signing key (RSA 3072, self-signed certificate, 10 years), imported as the key provider `oecp-saml-signing` |
| `keycloak_saml_enc_key`, `keycloak_saml_enc_cert` | keycloak-config | Same for the SAML encryption key (`oecp-saml-encryption`) |
| `grafana_admin_password` | grafana (profile `observability`) | Grafana `admin` password |

Optional, commented out in `compose.yaml` until used:

| File | Used by | Content |
|---|---|---|
| `smtp_password` | api, worker | SMTP AUTH password (`OECP_SMTP_USER`) |
| `alert_smtp_password` | alertmanager (profile `observability`) | SMTP AUTH password for alert mail (`OECP_ALERT_SMTP_USER`) |
| `pgbackrest_repo2_cipher_pass` | postgres, backup (profile `backup`) | Encryption passphrase of pgBackRest repo2, the second site (`openssl rand -base64 48`); without it repo2 cannot be restored: keep it with the offline copy |
| `pgbackrest_repo2_s3_key_secret` | postgres, backup | S3 secret access key of repo2 |

Files named `dev_*` are not Docker secrets: `dev_alliance_admin_password` and
`dev_alliance_admin_totp` hold the password and TOTP seed of the standing local
dev alliance admin, which the identity end-to-end suite signs in as
([`tools/e2e-identity`](../../../tools/e2e-identity/README.md)). The suite keeps
the secrets of the test accounts it creates in its own state directory, not
here (older `dev_partner_admin_totp` and `dev_visiting_scholar_totp` files are
no longer used).

Any file named `pgbackrest_<option>` mounted into `postgres` or `backup` sets
that pgBackRest option (`postgres/bin/pgbackrest`); see
[`../postgres/pgbackrest-repo2.env.example`](../postgres/pgbackrest-repo2.env.example).

## Create them

Run from `deploy/compose/`. Files must have **no trailing newline** (Keycloak
and keycloak-config-cli read them verbatim) and must be readable by the
container users (postgres uid 999, keycloak uid 1000, node uid 1000), so the
directory is private and the files are world-readable inside it:

**Never `cat` a secret into a terminal whose output will be shared** (screen
share, pasted session, ticket): check one with `less` or `wc -c`.

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

The four `keycloak_saml_*` files come from `tools/scripts/gen-saml-keys.sh`
(run from the repository root or pass `--dir`; it refuses to overwrite
existing files without `--force`):

```sh
bash ../../tools/scripts/gen-saml-keys.sh --dir secrets
```

Each of them is **one line of base64 without PEM armor**: the private key as
PKCS#8 DER, the certificate as X.509 DER. This is deliberate. keycloak-config-cli
substitutes the file into `realm-oecp.yaml` before the YAML is parsed, a PEM
file would be folded onto one line there, and Keycloak removes the
`-----BEGIN ...-----` markers with a pattern that would then swallow the key.
The equivalent openssl commands, for one pair (`sig`; repeat with `enc`):

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out sig.pem
openssl req -new -x509 -sha256 -days 3650 -key sig.pem \
  -subj '/O=Open Alliance Course Catalogue/CN=OECP SAML signing' -out sig.crt
openssl pkcs8 -topk8 -nocrypt -in sig.pem -outform DER | base64 | tr -d '\n' > secrets/keycloak_saml_sig_key
openssl x509 -in sig.crt -outform DER | base64 | tr -d '\n' > secrets/keycloak_saml_sig_cert
shred -u sig.pem sig.crt 2>/dev/null || rm -P sig.pem sig.crt   # or keep them in the offline copy
```

To inspect a certificate again:
`base64 --decode < secrets/keycloak_saml_sig_cert | openssl x509 -inform DER -noout -subject -enddate -fingerprint -sha256`.

PKCS#8 is written explicitly (`openssl pkcs8 -topk8 -nocrypt`) because
`openssl pkey -outform DER` produces the PKCS#1 form on OpenSSL 3.0, and the
key provider expects PKCS#8. `base64 | tr -d '\n'`
gives one line on BSD and GNU alike.

Why they exist: Keycloak generates its own realm keys when it creates the
realm, so the SAML certificates in the SP metadata registered at the
federation would change with every database reinstall, and would not exist
before the server does. With these files the certificates are known in
advance (`tools/scripts/sp-metadata.mjs` reads the `*_cert` files, so the
metadata can be produced and registered before the server has DNS and TLS)
and survive a reinstall. **Existing installations:** `compose.yaml` mounts the
files into `keycloak-config`, so create them before the next
`docker compose up`; the first import then adds the two key providers and the
SP certificates change once (re-send the metadata).

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

- **`grafana_admin_password`:** Grafana reads it only at its first start
  (`GF_SECURITY_ADMIN_PASSWORD__FILE`); changing the file alone changes
  nothing afterwards. To rotate, write the new value to the file (one line, no
  newline, mode 644) and reset the password inside Grafana:

  ```sh
  docker compose exec -T grafana grafana cli admin reset-admin-password --password-from-stdin < secrets/grafana_admin_password
  curl -s -o /dev/null -w '%{http_code}\n' -u "admin:$(cat secrets/grafana_admin_password)" http://127.0.0.1:3001/api/user   # 200
  ```

  The CLI prints nothing on success (verified on the pilot on 2026-10-21).

- **`keycloak_saml_*`:** only on purpose. A new pair changes the SP
  certificates that the federation (SIR/RedIRIS, eduGAIN) and every partner IdP
  hold. Plan it like the runbook says (section 2): add the new pair under new
  secret names (wired by hand in `compose.yaml`) as a second provider pair in
  `realm-oecp.yaml` with `active: false`, publish the new certificates in the
  metadata next to the old ones (`tools/scripts/sp-metadata.mjs --sig-cert
  OLD --sig-cert NEW`), wait until the federation has exported it, then make the
  new keys active and finally drop the old pair
  ([`identity/keycloak/scripts/sp-metadata.md`](../../../identity/keycloak/scripts/sp-metadata.md)).

Keep an offline, access-controlled copy of `oecp_master_key` (without it the
encrypted partner credentials in the database cannot be recovered) and of the
four `keycloak_saml_*` files (without them a reinstall changes the registered
SP certificates).
