<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0017: IdP metadata refresh from a pinned-signature aggregate

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R01] `docs/review/01-identity.md`, `docs/spec-v4.0.md` §4, [ADR-0004](0004-keycloak-only-identity-one-saml-idp-per-partner.md), `identity/keycloak/README.md`

## Context and problem statement

Each partner university signs in through its own SAML IdP, configured in
Keycloak as one identity provider per partner ([ADR-0004](0004-keycloak-only-identity-one-saml-idp-per-partner.md)).
Keycloak cannot consume a federation aggregate such as eduGAIN's: every IdP
holds a static copy of its signing certificates and endpoints [R01 §1]. IdPs
roll their keys and move endpoints; a stale certificate breaks sign-in for a
whole university, and Keycloak 26.8 ignores expired certificates outright.
v4.0 §4 asked for a daily job that verifies the aggregate and updates the
configured IdPs, keeping the last good configuration on failure.

Where does OECP take IdP metadata from, how does it decide it is authentic,
and what may it change in Keycloak?

## Decision drivers

- Authenticity: metadata decides who can sign in as an administrator, so it
  must be verified against a trust anchor chosen by the operator, never
  against keys found in the document itself.
- Availability: a federation outage or a bad download must not break sign-in.
- Minimal change: realm-as-code (`realm-oecp.yaml`) stays the source of
  every security setting; the job only touches what the metadata owns.
- Auditability: every change is attributable and reviewable without exposing
  certificate bodies.
- Bounded resources: the eduGAIN aggregate is about 94 MB (October 2026).

## Considered options

1. A worker job that downloads one signed aggregate (eduGAIN or a federation
   feed), verifies it against a **pinned** signing certificate with a strict
   signature profile, keeps a last good copy, and writes only a fixed set of
   managed keys per IdP through the Keycloak Admin API.
2. Per-entity metadata from an MDQ (Metadata Query) service.
3. Keycloak's own per-IdP "import from URL" (`metadataDescriptorUrl`) with
   periodic reload.
4. Manual updates through `realm-oecp.yaml` only.

## Decision outcome

Chosen option: **"aggregate with a pinned signing certificate and managed
keys"**, because it works with what eduGAIN and national federations publish
today, gives a single explicit trust anchor, and leaves every other IdP
setting under realm-as-code.

As built (`apps/api/src/identity/metadata-refresh/`, spec §4):

- **Source and limits.** `OECP_IDP_METADATA_URL` (HTTPS, also after
  redirects), 60 s timeout, `OECP_IDP_METADATA_MAX_BYTES` (default 50 MiB;
  Compose 150 MiB for eduGAIN), streamed to disk.
- **Trust.** The signature is checked with xml-crypto against the
  certificate in `OECP_IDP_METADATA_SIGNING_CERT_FILE` only (one PEM, RSA);
  `KeyInfo` is ignored. Profile: one enveloped `ds:Signature` directly under
  the root, exclusive c14n, RSA-SHA256, a single SHA-256 reference to the
  whole document; no DOCTYPE. A past `validUntil` is always refused, a missing
  one while `OECP_IDP_METADATA_REQUIRE_VALID_UNTIL=true` (default). Entities
  are extracted by a streaming parse of the same bytes (compared by SHA-256).
- **Availability.** The verified file is the last good copy
  (`OECP_IDP_METADATA_CACHE_DIR`); when a download or verification fails it is
  re-verified and used for up to 7 days after its download, then the run
  fails. A failing IdP keeps its current configuration; the others continue.
- **Managed keys.** `signingCertificate` (expired certificates dropped,
  warning 30 days before expiry, not-yet-valid ones kept for rollovers),
  `singleSignOnServiceUrl`, `postBindingAuthnRequest`,
  `singleLogoutServiceUrl`, `postBindingLogout`. Bindings follow the IdP's
  configured preference (POST by default). Only differing keys are written,
  after re-reading the IdP; flows, principal attribute, NameID policy,
  `hideOnLogin` and signature policy are never touched.
- **Audit.** One `idp.metadata_refresh` row per updated IdP, actor
  `system:metadata-refresh`, with keys, URLs and certificate fingerprints.
- **Schedule.** Daily at 04:15 UTC and about a minute after worker start
  (reusing a copy younger than 24 h), so values reset by a keycloak-config-cli
  re-import are restored quickly; CLI `oecp idp-metadata-refresh` with
  `--dry-run`, `--alias`, `--file`, `--no-verify` (file only); on demand
  through `POST /api/admin/v1/maintenance/jobs/idp-metadata-refresh/run`.

### Consequences

- Good, because the trust anchor is explicit, operator-controlled and
  independent of the document, and the signature profile rejects the
  wrapping and transform tricks that a permissive verifier would accept.
- Good, because a federation outage of up to a week does not affect sign-in,
  and one broken entity never blocks the others.
- Good, because realm-as-code keeps owning every security-relevant IdP
  setting.
- Bad, because xml-crypto needs the whole document in memory: with eduGAIN
  the worker needs at least 2 GB of memory (a synthetic 75 MB aggregate took
  about 750 MB RSS).
- Bad, because the pinned certificate must be rotated by the operator when
  the federation rolls its signing key; until then every run falls back to
  the cache and fails after 7 days.
- Bad, because keycloak-config-cli resets the managed keys to the committed
  values on every `docker compose up` until the next run; the start-up run
  narrows that window to about a minute.
- Neutral, because every run (daily, start-up, on demand) goes through the
  worker's `maintenance` queue since 0.4: it holds the maintenance advisory
  lock and is recorded in `maintenance_runs` (before 0.4 only on-demand runs
  were; the daily ones left logs and audit rows only).

### Confirmation

`apps/api/test/unit/idp-metadata.test.ts` (signature profile, parsing,
certificate policy, managed-key diff) and
`apps/api/test/unit/idp-metadata-refresh.service.test.ts` (download limits,
cache fallback, per-IdP outcomes, dry run, audit) on synthetic signed
aggregates; `apps/api/test/unit/cli.test.ts` (command line); dry runs
against the dev-profile test IdP's metadata (`identity/keycloak/README.md`).

## Pros and cons of the options

### Pinned-signature aggregate, managed keys

- Good, because it uses the federations' standard publication channel.
- Bad, because the aggregate is large and grows.

### MDQ per entity

- Good, because responses are small.
- Bad, because MDQ is not offered by every federation the alliance needs
  (hub-and-spoke federations such as SURFconext and WAYF publish
  aggregates), and it adds an online dependency at refresh time.

### Keycloak import from URL

- Good, because no OECP code is needed.
- Bad, because it expects one entity descriptor per URL, does not verify an
  aggregate signature against a pinned certificate and would overwrite
  settings that realm-as-code owns.

### Manual updates only

- Good, because nothing changes without review.
- Bad, because key rollovers and expiries would break sign-in until someone
  notices.

## More information

- Spec §4 (IdP metadata refresh), §10 (maintenance jobs), Appendix B
  (`OECP_IDP_METADATA_*`), Appendix C (CLI); operator procedure in
  `identity/keycloak/README.md` "Metadata refresh".
- Revisit when an MDQ service covers every partner federation, or when a
  streaming signature verifier removes the memory requirement.
