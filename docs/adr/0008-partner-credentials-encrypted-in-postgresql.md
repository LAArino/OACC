<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0008: Partner credentials encrypted in PostgreSQL behind `secret_ref`

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R02] `docs/review/02-data-model-and-ingestion.md`, [R03] `docs/review/03-architecture-stack-licences.md`, [RP] `docs/research/partner-oeapi-endpoints.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

No partner publishes an anonymous OEAPI endpoint [RP]. Direct harvesting
[DL 14] means OECP holds one credential per partner (HTTP Basic, bearer token
or API-key header), plus one alliance-level HTTP Basic credential for the
SURFeduhub fallback (spec §6.2.2). The reviews require these credentials to
be kept in a vault and never in clear [R02 §2; R03 §2], and the licence review
recommends OpenBao (MPL-2.0) over HashiCorp Vault (BUSL) when a vault is
added [R03 §2].

A vault is one more stateful service with its own unsealing, backup, high
availability and access policies. For an MVP with at most a handful of
partner credentials, run by one maintainer [DL 10] on Docker Compose, that
cost is high, while the threat to address is concrete: a database dump,
backup or read-only SQL access must not reveal partner credentials, and
administrators must never see a stored credential again.

How should OECP store partner credentials in the MVP without closing the
door to a vault later?

## Decision drivers

- Credentials unreadable from database dumps, backups and replicas.
- Write-only through the admin API and never logged.
- No extra stateful service in the MVP [DL 10].
- A stable reference so that a vault can replace the storage without
  changing `partner_integrations` or the harvester.
- Key rotation possible without a schema change.

## Considered options

1. Application-level AES-256-GCM in a `secrets` table, master key from a file
   (Docker secret), referenced as `db:<uuid>`; OpenBao later behind the same
   reference.
2. OpenBao (or Vault) from the MVP.
3. `pgcrypto` encryption inside PostgreSQL.
4. Credentials as environment variables or Docker secrets per partner.

## Decision outcome

Chosen option: **encrypted rows in PostgreSQL referenced by `db:<uuid>`**,
because it protects credentials at rest with no new service, and the
reference keeps OpenBao a drop-in provider for v1 (spec §10 Security, §12).

As built (`apps/api/src/secrets/secrets.service.ts`, `secrets.module.ts`,
migration `0001_init`):

- Table `secrets` (`id`, `purpose`, `key_version`, 12-byte `nonce`,
  `ciphertext` with the 16-byte GCM tag appended). Each write uses a fresh
  random nonce.
- The master key is read from `OECP_MASTER_KEY_FILE` (Compose: Docker secret
  `/run/secrets/oecp_master_key`), base64 of exactly 32 random bytes
  (`openssl rand -base64 32`). It is loaded lazily, so a missing key fails
  only when a secret is used (`oecp.secrets.unavailable`).
- Additional authenticated data binds each ciphertext to its row id, purpose
  and key version: a ciphertext copied to another row does not decrypt.
- `partner_integrations.secret_ref` holds `db:<uuid>`; the CHECK constraint
  also admits `openbao:<path>`, which the service refuses until the v1
  provider exists. `SURFEDUHUB_SECRET_REF` uses the same format.
- The admin API is write-only: omitting `secret` keeps it, `null` deletes the
  row (hard delete), a string replaces the ciphertext in place under the same
  reference. Changes are audited as `set`/`replaced`/`deleted`, never with
  values. The CLI `oecp store-secret --purpose <label>` reads the secret on
  stdin and prints only the reference.
- `key_version` is stored with every row; new rows use version 1. Rotation
  (re-encrypting rows under a new key version) is not implemented yet.

### Consequences

- Good, because dumps and backups contain only ciphertext; the master key
  lives outside the database and outside backups of it.
- Good, because the admin UI and API never return a credential.
- Good, because a v1 OpenBao provider only adds a resolver for `openbao:`
  references; existing `db:` rows keep working during a migration.
- Bad, because whoever holds both the master key and the database can read
  every credential; the key file must be protected like a private key and
  backed up separately (losing it means re-entering every credential).
- Bad, because the plaintext exists in the api and worker memory while a
  harvest runs.
- Bad, because rotation needs a re-encryption command that does not exist yet.

### Confirmation

Unit tests in `apps/api/test/unit/secrets.service.test.ts` (round trip,
tampered row, wrong key, AAD binding); integration tests of the integration
endpoints check write-only behaviour and audit rows.

## Pros and cons of the options

### Encrypted rows with a master key file

- Good, because it adds no service and keeps references stable.
- Bad, because key custody and rotation are the operator's job.

### OpenBao from the MVP

- Good, because of policies, audit devices, leases and rotation built in.
- Bad, because of unsealing, storage, HA and backup of one more service for a
  handful of secrets; planned for v1 [R03 §2].

### `pgcrypto`

- Good, because encryption happens in the database.
- Bad, because the key travels in SQL statements and can reach logs and
  `pg_stat_statements`; it gives no protection against a database superuser.

### Environment variables or per-partner Docker secrets

- Good, because they are simple.
- Bad, because adding a partner would need a redeployment, and admins could
  not manage credentials from the dashboard.

## More information

- Spec §6.2.2, §10 Security, §12 (OpenBao in v1); [R03 §2].
- Related: [ADR-0009](0009-direct-partner-oeapi-access-with-host-approval.md).
- Production runbook items (key backup, rotation procedure) are tracked in
  `docs/backlog.md`.
