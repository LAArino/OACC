<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Identity as code: Keycloak realm `oecp`

Keycloak is OECP's only identity component and authenticates administrators
only; the public portal never touches it (spec v4.0 §3, §4;
[ADR-0004](../../docs/adr/0004-keycloak-only-identity-one-saml-idp-per-partner.md)).
Everything that can be declared about the realm lives here and is applied by
[keycloak-config-cli](https://github.com/adorsys/keycloak-config-cli)
(service `keycloak-config` in [`deploy/compose`](../../deploy/compose/)).

```
identity/keycloak/
├── realm-oecp.yaml        realm, SAML keys, roles, clients, client scope, flows, IdPs
├── sp-metadata.config.example.yaml   organization, contacts, MDUI of the SP metadata
├── sp-metadata.indexes.json          ACS index of every IdP alias (append-only)
├── scripts/
│   └── sp-metadata.md     user guide of the multi-ACS SP metadata generator (spec §4)
└── README.md

tools/scripts/gen-saml-keys.sh    creates the SAML key pairs (Docker secrets)
tools/scripts/sp-metadata.mjs     the SP metadata generator
```

EUPL-1.2 login themes will be added under `themes/` and copied into the
Keycloak image by `deploy/compose/dockerfiles/keycloak.Dockerfile`.

## What `realm-oecp.yaml` declares

| Area | Content | Spec |
|---|---|---|
| Realm | `oecp`, no self-registration, no remember-me, brute-force protection, password policy ≥ 12 characters for local users, events kept 90 days | §2.1, §2.2, §10 |
| Lifetimes | access token 5 min, SSO idle 30 min, SSO max 8 h, rotating single-use refresh tokens, no offline tokens | §2.2 |
| Roles | realm roles `partner_admin`, `alliance_admin` (assigned by the API only) | §2, §4 |
| User profile | `oecp_org_id` (lowercase UUID), `schacHomeOrganization`, `displayName`; every attribute admin-editable only; undeclared attributes are dropped | §2.1, §4 |
| Client `oecp-admin` | public, Authorization Code + PKCE (S256), redirect `https://{portal}/en/admin/*`, minimum ACR `mfa`, no direct access grants; role scope `partner_admin`, `alliance_admin` | §4 |
| Client `oecp-api` | bearer-only, used only as audience | §4 |
| Client `oecp-backend` | confidential, service account with `manage-users`, `view-users`, `manage-identity-providers`, `view-identity-providers`, the same four roles in its role scope (`clientScopeMappings`) | §3, §4 |
| Client scope `oecp` | `aud` ∋ `oecp-api`, `org_id`, flat `roles`, `idp`, `name`; no role scope mappings | §4 JWT contract |
| ACR | realm map `{"mfa": 2}` | §4 |
| Flows | `oecp-browser-mfa`, `oecp-post-broker-mfa`, `oecp-first-broker-login` | §2.1, §2.2 |
| SAML keys | key providers `oecp-saml-signing` (RS256) and `oecp-saml-encryption` (RSA-OAEP), priority 200, imported from the Docker secrets `keycloak_saml_*` (see [SAML keys and SP metadata](#saml-keys-and-sp-metadata)) | §4 |
| IdPs | `example-partner` (disabled SAML template) with attribute importers; `urv`, the development test IdP (enabled only with `OECP_DEV_IDP_ENABLED=true`, see below) | §4 |

### Claims and where they come from

| Claim | Source in Keycloak |
|---|---|
| `iss` | `KC_HOSTNAME` → `https://{auth-host}/realms/oecp` |
| `aud` | audience mapper in scope `oecp` (`oecp-api`); a single audience is serialised as a string, not an array |
| `azp` | `oecp-admin` (requesting client) |
| `sub`, `auth_time` | built-in scope `basic` (`auth_time` only for interactive logins: tokens from direct grants have none) |
| `acr` | built-in scope `acr` + realm ACR-to-LoA map |
| `roles` | realm-role mapper in scope `oecp`, limited to the role scope of client `oecp-admin`; clients have `fullScopeAllowed: false`, so default roles never appear. For an invited user without role the claim is **absent** (Keycloak emits no empty array); the API reads it as `[]` |
| `org_id` | user attribute `oecp_org_id` |
| `idp` | user-session note `identity_provider` (broker alias). **Absent for local users**: the API maps a missing `idp` to `local` (spec §2.1) |
| `email`, `name` | built-in scope `email`; full-name mapper in scope `oecp` |
| `schac_home_organization` | user attribute `schacHomeOrganization` (attribute mapper in scope `oecp`, always an array), written by the IdP attribute importer at every broker login (`syncMode: FORCE`). **Absent for local users** and when the IdP did not release the attribute. The API compares it with `organizations.schac_home_organization` at invitation acceptance and, only when the claim is missing, reads the user attribute through the Admin API (spec §2.1) |

### MFA design (spec §2.2)

Every login reaches Level of Authentication 2, reported as `acr=mfa`:

- **Local users** (`oecp-browser-mfa`): username/password (LoA 1 condition),
  then the second factor (LoA 2 condition).
- **Brokered users**: the partner IdP authenticates the first factor; the
  IdP's post-broker login flow `oecp-post-broker-mfa` runs the second factor
  with the same LoA 2 condition, on every login.
- **Second factor**: if the user has WebAuthn or TOTP, they choose (WebAuthn
  first); otherwise the TOTP form is required, which triggers enrolment.
  `CONFIGURE_TOTP` is also a default required action for new users. Keycloak
  cannot require "WebAuthn or TOTP" at enrolment, so TOTP is the enforced
  baseline and the admin SPA should offer `kc_action=webauthn-register`
  (WebAuthn preferred) after first login.

### Account linking

`oecp-first-broker-login` contains only `idp-create-user-if-unique`: no
review-profile form (users never type attributes), no detection of existing
accounts and no linking by e-mail. If a user with the same username or
e-mail already exists, login fails and an `alliance_admin` resolves it
(spec §2.1 step 3, [R01 §2]).

### Sign-in mode per organization ([DL 22])

The organization's `keycloak_idp_alias` decides how **all** its
administrators sign in; there is no mixed mode within one organization:

- **Local** (alias empty): Keycloak local accounts with a password of at
  least 12 characters and TOTP, set up from the e-mail Keycloak sends with the
  invitation; no self-registration or open password reset (recovery: *Resend
  set-up e-mail* on the organization's *Administrators* panel). This is the
  mode of the alliance organization and of universities outside eduGAIN or not
  yet connected (in the Aurora seed: `aurora` and `upec`).
- **Federated** (alias set, = the realm IdP alias): SAML sign-in at the
  university's IdP through eduGAIN, then TOTP enrolled by OECP after the first
  login (`oecp-post-broker-mfa`).

Which mode for a university, both onboarding paths with who does what, and
what a partner's identity team must provide:
[docs/onboarding/identity-paths.md](../../docs/onboarding/identity-paths.md).

The API refuses an invitation to a federated organization whose alias is
missing from the realm or disabled there (409
`oecp.invitation.idp_not_enabled`, extension member `idp_alias`): Keycloak
would ignore the `kc_idp_hint` and the invitee could not sign in. When
Keycloak does not answer, the check is skipped and logged. The admin panel
warns beforehand when the alias is not among the enabled IdPs. A sign-in in
the wrong mode is refused at acceptance (`oecp.invitation.mismatch`) and
later (`oecp.auth.idp_mismatch`). To move an organization from local to
federated: enable its IdP here, set the alias on the organization, and invite
its administrators again.

## Pitfalls found on the first real deployment

Each of these broke the first `docker compose up` silently (the import
reported success) and is now fixed in `realm-oecp.yaml` or `compose.yaml`:

1. **User profile skipped.** keycloak-config-cli imports `userProfile` only if
   the realm attribute `userProfileEnabled` is `"true"`; otherwise it logs a
   debug message and keeps Keycloak's default profile, in which every
   undeclared attribute (`oecp_org_id` included) is silently dropped when the
   API writes it, so `org_id` never reaches the token.
2. **Role scope on a client scope.** Keycloak applies a client scope that has
   role scope mappings only to users holding at least one of those roles. With
   `partner_admin`/`alliance_admin` mapped on scope `oecp`, a role-less
   invited user got a token without `aud`, `name` and `idp`, so
   `/invitations/accept` could never succeed. The mapping is now on client
   `oecp-admin`. **Existing realms:** keycloak-config-cli does not delete the
   old mapping; remove it once in the admin console (Client scopes > `oecp` >
   Scope > unassign both roles) or with
   `DELETE /admin/realms/oecp/client-scopes/{id}/scope-mappings/realm`.
3. **Service account without role scope.** The Admin API allows an operation
   only if the service-account user has the realm-management role *and* the
   client has it in scope. `oecp-backend` uses `fullScopeAllowed: false`, so
   without `clientScopeMappings` every Admin API call returned 403.
   `GET /roles/{name}/users` still returns 403 (it needs `view-realm`, which the
   spec does not grant); use the users' role-mapping endpoints instead.
4. **Import cache.** By default keycloak-config-cli skips the import when the
   file checksum has not changed, so manual changes in the admin console
   survived re-runs. `IMPORT_CACHE_ENABLED=false` makes every run enforce the
   file.
5. **STARTTLS.** With `starttls: true` Keycloak requires the relay to offer
   STARTTLS; it is now `OECP_SMTP_STARTTLS` (default `true`, `false` for the
   Mailpit sink of the `dev` profile).

keycloak-config-cli logs these skips only at debug level: set
`LOGGING_LEVEL_DE_ADORSYS=debug` on the `keycloak-config` service when
changing the realm file, and check the result through the Admin REST API
rather than trusting the exit code.

### Version pairing

`adorsys/keycloak-config-cli:6.5.1-26.5.5` is the newest release; it is
built against the Keycloak 26.5 admin client and there is no 26.8 build. It
was verified against Keycloak 26.8.1 (the server version it logs at start):
every section of `realm-oecp.yaml` imports, re-runs are idempotent, and no
warning is logged. Re-verify with the checks below whenever either image is
bumped.

## Verified token contents

Observed on Keycloak 26.8.1 for a local user with `alliance_admin` and
`oecp_org_id`, through a temporary confidential client with the same scopes
and role scope as `oecp-admin` but direct access grants (deleted after the
test; `oecp-admin` itself refuses direct grants):

```json
{
  "iss": "https://auth.oecp.localhost/realms/oecp",
  "aud": "oecp-api",
  "azp": "<requesting client: oecp-admin in real logins>",
  "sub": "<user UUID>", "sid": "…", "typ": "Bearer",
  "acr": "1",
  "roles": ["alliance_admin"],
  "org_id": "74ad7aa3-1713-44b8-87ea-cbf404fe393c",
  "email": "…", "email_verified": true, "name": "First Last",
  "scope": "openid email"
}
```

- `acr` is `"1"` for a password-only (direct grant) login; through
  `oecp-browser-mfa` a local user reaches LoA 2 and gets `acr: "mfa"`.
- `idp` is absent for local users (no broker session note); the API maps it
  to `local`.
- `schac_home_organization` is absent for local users (no such attribute).
  For a user holding the attribute it is an array, e.g.
  `"schac_home_organization": ["urv.cat"]` (checked on 2026-10-16 with the
  Admin API's example access token of client `oecp-admin` for a temporary
  user, deleted afterwards).
- `auth_time` is absent from direct-grant tokens and present after a browser
  login.
- No `realm_access`/`resource_access`: the built-in `roles` and `profile`
  scopes are not assigned.
- The `oecp-backend` client-credentials token carries only `iss`, `sub`,
  `azp`, `client_id`, `scope: ""` and no roles; the Admin API evaluates the
  service account's roles and the client's role scope server-side.
- Tokens obtained through the internal URL (`http://keycloak:8080`) carry the
  same public `iss`, and execute-actions e-mail links point at the public auth
  host (`KC_HOSTNAME` + `KC_HOSTNAME_BACKCHANNEL_DYNAMIC`).

To repeat the check, obtain a `master` admin token from
`https://{auth-host}/realms/master/protocol/openid-connect/token`
(`client_id=admin-cli`, bootstrap admin), create a test user and a test
confidential client through the Admin REST API, request a password-grant
token, decode it, and delete both afterwards.

## How the realm is applied

```sh
cd deploy/compose
docker compose up -d keycloak          # waits for postgres
docker compose run --rm keycloak-config
```

`keycloak-config` also runs on every `docker compose up`. It is idempotent
(the import cache is disabled, so every run applies the file) and keeps remote
state: objects it created and later removed from this file are deleted (scope
mappings excepted, see pitfall 2); users, role mappings and user attributes
written by the API are not touched. Variables are substituted from the `keycloak-config` service
environment (see the header of `realm-oecp.yaml`).

Never edit the realm by hand in the admin console for anything declared
here: the next run reverts it. Runtime data (users, roles of users,
`oecp_org_id`, IdP certificates refreshed by the API) is not declared here.

## SAML keys and SP metadata

Keycloak generates the realm's RSA keys when it creates the realm, so the SAML
certificates of the service provider would only exist once the production
server runs and would change with a database reinstall. The federation (SIR,
then eduGAIN) must register them first, so the realm imports a signing key pair
and an encryption key pair created in advance:

- `tools/scripts/gen-saml-keys.sh` writes four Docker secrets
  (`keycloak_saml_sig_key`, `keycloak_saml_sig_cert`, `keycloak_saml_enc_key`,
  `keycloak_saml_enc_cert`; RSA 3072, self-signed, 10 years; format and
  commands in [`secrets/README.md`](../../deploy/compose/secrets/README.md)).
- The `components` block of `realm-oecp.yaml` reads them with
  `$(file:UTF-8:/run/secrets/…)` into two `rsa` key providers with priority 200
  (the generated keys have 100) and `active: true`. keycloak-config-cli leaves
  the generated providers alone; they stay enabled. Keycloak picks the active
  key by use and algorithm only, so the imported RS256 key also signs the
  realm's tokens (see [`scripts/sp-metadata.md`](scripts/sp-metadata.md),
  "Things to know").
- `tools/scripts/sp-metadata.mjs` turns the `*_cert` files, the enabled IdP
  aliases of the realm file and a small config into the single
  `EntityDescriptor` for the federation, before the server exists
  ([`scripts/sp-metadata.md`](scripts/sp-metadata.md)).

Verified against Keycloak 26.8.1 and keycloak-config-cli 6.5.1: an empty realm
import creates both providers, a second run changes nothing, the descriptor of
an enabled IdP lists the imported certificates first with the same key ids the
generator writes. **Upgrading a running deployment:** create the four secrets
(`gen-saml-keys.sh`) before the next `docker compose up`; the next import then
adds the providers and the SP certificates change once, so the metadata must
be (re)sent to the federation and to every partner IdP that holds the old ones.
Removing the two entries from the file deletes the providers again. Keep an
offline copy of the four files; losing them means new certificates.

## Adding a partner IdP

1. **Organization first.** Create the partner organization from the seed file
   (`oecp seed-organizations`) or, since 0.2.0, on the Organizations page of the
   admin panel. The partner row needs its `slug`,
   `schac_home_organization` and `keycloak_idp_alias` = `slug`.
2. **Find the IdP** in the eduGAIN metadata (or the hub of a hub-and-spoke
   federation: SURFconext for VUA, WAYF for CBS, spec §4). Note its
   `entityID`, `SingleSignOnService` (HTTP-POST or HTTP-Redirect),
   `SingleLogoutService` if any, and the signing certificate(s).
3. **Copy the `example-partner` block** in `identityProviders` and its five
   entries in `identityProviderMappers`; set `alias` and
   `identityProviderAlias` to the partner slug, `displayName`, `enabled: true`,
   `idpEntityId`, `singleSignOnServiceUrl`, `signingCertificate`
   (base64 DER, comma-separated for rollover) and, if declared,
   `singleLogoutServiceUrl`. Literal values are fine for public metadata; use
   new `EXAMPLE`-style variables only if a value differs per deployment.
4. **Principal attribute.** Keep `subject-id` if the IdP releases it
   (REFEDS Personalized Access); otherwise set `principalAttribute` to
   `urn:oasis:names:tc:SAML:attribute:pairwise-id`. ePPN only with the
   partner's written confirmation that it is never reassigned (spec §4).
   Changing it later orphans existing users of that IdP.
5. **Keep** `firstBrokerLoginFlowAlias: oecp-first-broker-login`,
   `postBrokerLoginFlowAlias: oecp-post-broker-mfa`, signed and encrypted
   assertions, `hideOnLogin: true`, `trustEmail: true`, `syncMode: FORCE`.
6. **Apply** with `docker compose run --rm keycloak-config`. Unless the alias is
   already in `reserveAliases` of `sp-metadata.config.yaml` (then the federation
   already has its ACS), regenerate the multi-ACS SP metadata
   (`node tools/scripts/sp-metadata.mjs --auth-host …`, one more ACS, see
   [`scripts/sp-metadata.md`](scripts/sp-metadata.md)), commit the updated
   `sp-metadata.indexes.json` and resubmit it to the federation registry
   (SIR/RedIRIS for the Aurora MVP, [DL 15]).
7. **Test** with an invitation (spec §2.1); the invitation is refused until
   the IdP is applied and enabled (`oecp.invitation.idp_not_enabled`): login with `kc_idp_hint={slug}`,
   MFA enrolment, then acceptance; the API checks `email`, `idp` and the
   asserted `schacHomeOrganization`.

Missing required attributes (spec §4: `mail`, `schacHomeOrganization`, name)
are not rejected by Keycloak itself: the user is created without them and the
API rejects the invitation acceptance naming the missing attribute. A login
error naming the attribute at the Keycloak level would need a small custom
authenticator; it is not part of the MVP.

## Metadata refresh (owned by the API)

Keycloak cannot consume federation aggregates (spec §4, [R01 §1]), so the
worker job **`idp-metadata-refresh`** (`apps/api/src/identity/metadata-refresh/`)
keeps the partner IdPs current. It runs on the worker's `maintenance` queue
daily at 04:15 UTC (job scheduler `maintenance-idp-metadata-refresh-daily`)
and, unless `OECP_IDP_METADATA_REFRESH_ON_START=false`, about a minute after
every worker start (reusing an aggregate downloaded in the last 24 h; only when
`OECP_IDP_METADATA_URL` is set), so certificates reset by a keycloak-config-cli
re-import are restored within minutes. An `alliance_admin` can also start a run
with `POST /api/admin/v1/maintenance/jobs/idp-metadata-refresh/run` (spec §8.2).
Every run (trigger `schedule`, `startup` or `manual`) holds the maintenance
advisory lock and is recorded in `maintenance_runs` with counts per status and
one line per IdP (`GET /api/admin/v1/maintenance/runs?job=idp-metadata-refresh`);
applied changes are also audited (`idp.metadata_refresh`). Before 0.4 the
scheduled runs used a queue of their own, which the worker removes at start.

| Variable | Default | Meaning |
|---|---|---|
| `OECP_IDP_METADATA_URL` | empty | HTTPS aggregate, e.g. `https://mds.edugain.org/edugain-v2.xml` (or the hub federation's feed). Empty: the job logs "not set" and does nothing |
| `OECP_IDP_METADATA_SIGNING_CERT_FILE` | (required with the URL) | PEM file with exactly one certificate: the federation's metadata signing certificate, pinned |
| `OECP_IDP_METADATA_REQUIRE_VALID_UNTIL` | `true` | refuse an aggregate without `validUntil` (a past one is always refused) |
| `OECP_IDP_METADATA_CACHE_DIR` | `/data/idp-metadata` | last good aggregate (`aggregate.xml`, `aggregate.json`); must be writable by the worker and persistent |
| `OECP_IDP_METADATA_MAX_BYTES` | 157286400 (150 MiB; the same in Compose) | download limit. The eduGAIN aggregate is larger (94 MB in October 2026), hence the Compose default of 150 MiB |
| `OECP_IDP_METADATA_INCLUDE_DISABLED` | `false` | also refresh IdPs disabled in Keycloak |
| `OECP_IDP_METADATA_REFRESH_ON_START` | `true` | the start-up run described above |

What one run does:

1. **Download** the aggregate (60 s timeout, size limit, redirects only to
   HTTPS) to a temporary file in the cache directory.
2. **Verify** it: one enveloped `ds:Signature` as a direct child of the root,
   exclusive c14n, RSA-SHA256, a single SHA-256 reference to the whole document,
   checked with xml-crypto against the **pinned certificate only** (a key in
   `KeyInfo` is ignored); no DOCTYPE; `validUntil` in the future. The verified
   file becomes the last good aggregate.
3. **On download or verification failure** the last good aggregate is
   re-verified and used, with a warning, for up to **7 days** after its
   download; after that every IdP fails and the job fails (alert).
4. For every organization with a `keycloak_idp_alias`, read the IdP
   (`GET /identity-provider/instances/{alias}`); skip it (warning) if it is
   missing, not SAML, disabled, or has no `idpEntityId`. Find the
   `EntityDescriptor` with that entity ID (streaming parse; only the wanted
   entities are kept in memory) and its SAML 2.0 `IDPSSODescriptor`.
5. **Compute** the managed keys: `signingCertificate` (`KeyDescriptor`
   `use="signing"` or without `use`; expired certificates dropped, a warning
   for those expiring within 30 days; comma-separated base64 DER),
   `singleSignOnServiceUrl` and `postBindingAuthnRequest` (the binding the
   IdP is configured with, POST by default; the other one, with a warning, if
   the metadata does not offer it), `singleLogoutServiceUrl` and
   `postBindingLogout` (the key is removed when the IdP declares no SLO, since
   Keycloak rejects an empty value). The NameID policy is only checked
   (warning). No usable certificate or no SSO endpoint: the IdP fails and
   keeps its configuration.
6. **Update** only the keys that differ (certificates compared as a set),
   re-reading the IdP just before a `PUT` of the full representation: flows,
   principal type, `hideOnLogin` and every other key stay as they are. One
   `audit_log` row `idp.metadata_refresh` (actor `system:metadata-refresh`,
   entity = the organization) per updated IdP lists the keys, old and new
   URLs and certificate SHA-256 fingerprints (never certificate bodies).
7. A failure for one IdP never stops the others; any failed IdP fails the job
   (an error in the worker log and the alert `OecpIdpMetadataRefreshFailed`
   of the `observability` profile, spec §10).

**Certificate expiry.** Independently of the refresh, the worker reads the
`signingCertificate` of every IdP of the realm (at start, after every refresh
run and hourly; client `oecp-backend` needs `view-identity-providers`) and
exports `oecp_idp_certificate_expiry_timestamp_seconds{alias,enabled}` (the
latest `notAfter` among its certificates) and
`oecp_idp_certificate_check_last_success_timestamp_seconds`. The alerts
`OecpIdpCertificateExpiring` (30 days warning, 7 days critical),
`OecpIdpCertificateExpired` and `OecpIdpCertificateCheckStale` (24 h) watch
the enabled IdPs ([Compose README, Alerting](../../deploy/compose/README.md#alerting)).

Run it by hand with the CLI. In Compose, use the `worker` service, which has
the cache volume (`idp-metadata`), the mounted signing certificate and the
memory (the `api` service has neither the volume nor, unless you add it, the
certificate):

```sh
docker compose run --rm worker node dist/cli.js idp-metadata-refresh --dry-run
```

Inside a container the commands are:

```sh
node dist/cli.js idp-metadata-refresh --dry-run              # what would change
node dist/cli.js idp-metadata-refresh --alias vua             # one IdP, applied
node dist/cli.js idp-metadata-refresh --file /tmp/md.xml      # local signed aggregate
node dist/cli.js idp-metadata-refresh --file /tmp/md.xml --no-verify --dry-run
```

`--no-verify` is accepted only with `--file` (never for the URL); it exists for
unsigned development metadata such as the test IdP's (below) and a missing
`validUntil` is then tolerated. Exit code 0 if no IdP failed, 1 otherwise.
Against the test IdP's metadata (`curl -s
http://127.0.0.1:8091/simplesaml/saml2/idp/metadata.php`, mounted into the
container) a dry run for `urv` checks the managed keys against a real
SimpleSAMLphp descriptor. The test IdP now declares HTTP-POST (first) and
HTTP-Redirect endpoints for both sign-in and logout
(`deploy/compose/test-saml-idp/saml20-idp-hosted.php`), matching the realm
entry's `postBindingAuthnRequest` and `postBindingLogout` = `true`, so the
binding flags stay unchanged; until then the job would have switched both to
HTTP-Redirect. Since the realm entry declares no `singleLogoutServiceUrl`, the
dry run still reports that key as one to add.

**Resources.** Signature verification needs the whole aggregate in memory
(xml-crypto canonicalises the document): a synthetic 75 MB aggregate took 16 s
and 750 MB RSS in the api image; extraction is a streaming pass (about 140 MB
RSS). With the full eduGAIN aggregate give the worker at least 2 GB and, if
needed, `NODE_OPTIONS=--max-old-space-size=3072`. Compose sets no memory limit
on the worker; if you add one, keep it at 2 GB or more.

Because the job writes certificates and endpoints at runtime, a later run of
keycloak-config-cli (every `docker compose up`) resets them to the values in
`realm-oecp.yaml` until the next run of the job, normally the start-up run a
minute after the worker starts: keep the committed values reasonably current
when adding a partner. Only the five managed keys are ever written; anything
else changed by hand in the console is reverted by the next re-import as
usual.

## Local development tips

- Admin console: `https://auth.oecp.localhost/admin/` (allowlisted CIDRs
  only, `KEYCLOAK_ADMIN_ALLOWLIST`; with Docker Desktop for Mac requests from
  the host arrive from `192.168.65.1`), user `KEYCLOAK_ADMIN_USER`, password in
  `deploy/compose/secrets/keycloak_admin_password`.
- E-mails (execute-actions links for local users, invitations) are captured by
  Mailpit with the compose profile `dev`: `http://127.0.0.1:8025/`.
- The bootstrap admin of `master` has no e-mail address, so the admin
  console's SMTP "Test connection" fails; trigger an execute-actions e-mail
  for a test user instead.
- The brokered path is tested against the dev-only test SAML IdP below.

## Test SAML IdP (dev profile)

The compose `dev` profile runs **`test-saml-idp`**, a SimpleSAMLphp 1.19 IdP
(`kenchan0130/simplesamlphp:1.19.9`, multi-arch) that plays the partner
university URV, so the brokered (eduGAIN-style) administrator path can be
exercised end to end on a laptop. Files: `deploy/compose/test-saml-idp/`.

| Item | Value |
|---|---|
| Realm IdP | alias `urv` (= `organizations.keycloak_idp_alias` of the seeded `urv`), declared in `realm-oecp.yaml` with `enabled: "$(env:…)"` → `OECP_DEV_IDP_ENABLED` (default `false`) |
| IdP entity ID | `https://idp.urv.test/saml2/idp` (an identifier only; nobody resolves it) |
| SSO URL (browser) | `http://127.0.0.1:${OECP_DEV_IDP_PORT:-8091}/simplesaml/saml2/idp/SSOService.php` |
| IdP metadata | `http://127.0.0.1:8091/simplesaml/saml2/idp/metadata.php` |
| Signing key | `deploy/compose/test-saml-idp/cert/idp.urv.test.{key,crt}`, development only, committed on purpose, valid until 2036-10-11; the certificate is pasted into `realm-oecp.yaml` |
| Users | `deploy/compose/test-saml-idp/users.json` (also read by the Playwright scripts): `partner.admin` (happy path, `partner.admin@urv.cat`, `schacHomeOrganization=urv.cat`, subject-id `abc123@urv.cat`), `visiting.scholar` (asserts `example.edu`), `email.collision` (asserts the dev alliance admin's e-mail) |
| Attributes | released under their URI names (`urn:oid:…`, `urn:oasis:names:tc:SAML:attribute:subject-id`), as eduGAIN IdPs do |
| Assertions | signed (RSA-SHA256) and encrypted for Keycloak (RSA-OAEP-MGF1P key transport); Keycloak's signed AuthnRequests are verified |

**Reachability.** Both SAML legs use the HTTP-POST binding through the
browser: Keycloak's redirector page posts the AuthnRequest to the SSO URL on
`127.0.0.1:8091`, and the IdP's page posts the response to
`https://auth.oecp.localhost/realms/oecp/broker/urv/endpoint`. Keycloak never
calls the IdP, so the SSO URL only has to work from the browser. The IdP, in
turn, reads Keycloak's SP descriptor
(`http://keycloak:8080/realms/oecp/broker/urv/endpoint/descriptor`, network
`edge`) to get the realm's encryption and signing certificates, which
Keycloak generates at first start; it caches them for 60 s and refuses to
answer while IdP `urv` is disabled. The entity ID and ACS it trusts are the
public ones (`TEST_IDP_SP_*`), not those of the internal descriptor.

**Enable it** (local `.env`, then apply):

```sh
OECP_DEV_IDP_ENABLED=true
OECP_DEV_IDP_PORT=8091
docker compose --profile dev up -d test-saml-idp
docker compose --profile dev run --rm keycloak-config
docker compose restart api        # or wait: /api/public/v1/reference caches the enabled IdPs 300 s
curl -sk https://oecp.localhost/api/public/v1/reference | jq '.organizations[] | select(.slug=="urv") | .idp_alias'   # "urv"
```

Then run the brokered specs of the identity E2E suite, `npx playwright test
brokered` in `tools/e2e-identity` (see
[`tools/e2e-identity/README.md`](../../tools/e2e-identity/README.md)); CI runs
the whole suite with the IdP enabled (`.github/workflows/e2e.yml`).

**Why the IdP is in `realm-oecp.yaml` and not in a second, dev-only file.**
keycloak-config-cli 6.5.1 (`import.managed.identity-provider=full`) deletes
every identity provider that is missing from the file it imports, and its
identity-provider import does not consult the remote state (read from the
6.5.1 `IdentityProviderImportService`; not exercised on purpose). Two files
for one realm would therefore delete and recreate `urv` (or `example-partner`)
on every run, and deleting an IdP deletes its users' federated identity
links. The same applies to an IdP added by hand in the admin console. With the
flag, `urv` is updated in place: a re-import keeps the links (verified).

**Found while wiring it** (Keycloak 26.8.1):

1. **Expired IdP certificates are ignored.** The image's built-in key has a
   certificate that expired in 2020; Keycloak logs `Ignoring invalid
   certificate` and rejects every response with `invalid_signature`. Partner
   certificates must be inside their validity period (the metadata refresh
   job of the API must not keep an expired one).
2. **First login enrols TOTP as a required action.** On the first brokered
   login the post-broker flow's enrolment branch hands over to the
   `CONFIGURE_TOTP` required action (`/login-actions/required-action`); later
   logins show the OTP form inside the post-broker flow
   (`/login-actions/post-broker-login`). Both yield `acr=mfa`.
3. **No linking by e-mail holds.** An IdP assertion carrying the e-mail of
   an existing local account stops at `first-broker-login` with "User with
   email … already exists" (HTTP 409); no user is created and nothing is linked.
4. **No SLO with the test IdP.** The realm entry declares no
   `singleLogoutServiceUrl`, so signing out of OECP leaves the IdP session; the
   next login through the chooser is a silent single sign-on at the IdP
   (still followed by the OTP form in Keycloak). An applied (not dry) run of
   the metadata refresh adds the IdP's SLO endpoint until the next re-import.

When URV joins with its real IdP, replace the values of the `urv` block
(entity ID, SSO URL, certificate, principal attribute per step 4 above) and
its `enabled` line; keep the alias and the mappers.
