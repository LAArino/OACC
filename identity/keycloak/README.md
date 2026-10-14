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
├── realm-oecp.yaml        realm, roles, clients, client scope, flows, IdPs
├── scripts/
│   └── sp-metadata.md     design of the multi-ACS SP metadata generator (spec §4)
└── README.md
```

EUPL-1.2 login themes will be added under `themes/` and copied into the
Keycloak image by `deploy/compose/dockerfiles/keycloak.Dockerfile`.

## What `realm-oecp.yaml` declares

| Area | Content | Spec |
|---|---|---|
| Realm | `oecp`, no self-registration, no remember-me, brute-force protection, password policy ≥ 12 characters for local users, events kept 90 days | §2.1, §2.2, §10 |
| Lifetimes | access token 5 min, SSO idle 30 min, SSO max 8 h, rotating single-use refresh tokens, no offline tokens | §2.2 |
| Roles | realm roles `partner_admin`, `alliance_admin` (assigned by the API only) | §2, §4 |
| User profile | `oecp_org_id`, `schacHomeOrganization`, `displayName`; every attribute admin-editable only | §2.1, §4 |
| Client `oecp-admin` | public, Authorization Code + PKCE (S256), redirect `https://{portal}/en/admin/*`, minimum ACR `mfa` | §4 |
| Client `oecp-api` | bearer-only, used only as audience | §4 |
| Client `oecp-backend` | confidential, service account with `manage-users`, `view-users`, `manage-identity-providers`, `view-identity-providers` | §3, §4 |
| Client scope `oecp` | `aud` ∋ `oecp-api`, `org_id`, flat `roles`, `idp`, `name` | §4 JWT contract |
| ACR | realm map `{"mfa": 2}` | §4 |
| Flows | `oecp-browser-mfa`, `oecp-post-broker-mfa`, `oecp-first-broker-login` | §2.1, §2.2 |
| IdPs | `example-partner` (disabled SAML template) with attribute importers | §4 |

### Claims and where they come from

| Claim | Source in Keycloak |
|---|---|
| `iss` | `KC_HOSTNAME` → `https://{auth-host}/realms/oecp` |
| `aud` | audience mapper in scope `oecp` (`oecp-api`) |
| `azp` | `oecp-admin` (requesting client) |
| `sub`, `auth_time` | built-in scope `basic` |
| `acr` | built-in scope `acr` + realm ACR-to-LoA map |
| `roles` | realm-role mapper, limited to the role scope mappings of scope `oecp`; clients have `fullScopeAllowed: false`, so default roles never appear and an invited user without role gets `[]` |
| `org_id` | user attribute `oecp_org_id` |
| `idp` | user-session note `identity_provider` (broker alias). **Absent for local users**: the API maps a missing `idp` to `local` (spec §2.1) |
| `email`, `name` | built-in scope `email`; full-name mapper in scope `oecp` |

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

## How the realm is applied

```sh
cd deploy/compose
docker compose up -d keycloak          # waits for postgres
docker compose run --rm keycloak-config
```

`keycloak-config` also runs on every `docker compose up`. It is idempotent and
keeps remote state: objects it created and later removed from this file are
deleted; users, role mappings and user attributes written by the API are not
touched. Variables are substituted from the `keycloak-config` service
environment (see the header of `realm-oecp.yaml`).

Never edit the realm by hand in the admin console for anything declared
here: the next run reverts it. Runtime data (users, roles of users,
`oecp_org_id`, IdP certificates refreshed by the API) is not declared here.

## Adding a partner IdP

1. **Organization first.** An `alliance_admin` creates the partner
   organization in OECP (spec §8.2) with its `slug`,
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
6. **Apply** with `docker compose run --rm keycloak-config` and regenerate and
   resubmit the multi-ACS SP metadata (one more ACS, see
   [`scripts/sp-metadata.md`](scripts/sp-metadata.md)) to the federation
   registry (SIR/RedIRIS for the Aurora MVP, [DL 15]).
7. **Test** with an invitation (spec §2.1): login with `kc_idp_hint={slug}`,
   MFA enrolment, then acceptance; the API checks `email`, `idp` and the
   asserted `schacHomeOrganization`.

Missing required attributes (spec §4: `mail`, `schacHomeOrganization`, name)
are not rejected by Keycloak itself: the user is created without them and the
API rejects the invitation acceptance naming the missing attribute. A login
error naming the attribute at the Keycloak level would need a small custom
authenticator; it is not part of the MVP.

## Metadata refresh (owned by the API)

Keycloak cannot consume federation aggregates (spec §4, [R01 §1]), so the
daily worker job **`idp-metadata-refresh`** (module `identity` of `apps/api`)
keeps the IdPs current:

1. Download the eduGAIN aggregate (or the federation's, for hub IdPs) over
   HTTPS from an allowlisted host.
2. Verify its signature against the **pinned federation signing
   certificate** and reject it if `validUntil` has passed.
3. For each Keycloak IdP whose alias matches an organization, extract the
   `EntityDescriptor` by `idpEntityId` and compare signing certificates,
   `SingleSignOnService` and `SingleLogoutService`.
4. Update changed values through the Admin API with the `oecp-backend`
   service account (`manage-identity-providers`), and audit the change.
5. On any failure (download, signature, expiry, missing entity), keep the
   last good configuration, record the failure and raise the
   "metadata-refresh failure" alert (spec §10).

Because the job writes certificates and endpoints at runtime, a later run of
keycloak-config-cli would reset them to the values in this file. Either keep
the values here in sync when committing a new partner, or (recommended) have
the worker also run the job at start-up, so that a re-import is corrected
within minutes.

## Local development tips

- Admin console: `https://auth.localhost/admin/` (allowlisted CIDRs only,
  `KEYCLOAK_ADMIN_ALLOWLIST`), user `KEYCLOAK_ADMIN_USER`, password in
  `deploy/compose/secrets/keycloak_admin_password`.
- A test SAML IdP for the Playwright invitation test (spec §10) can be added
  as another IdP entry pointing at a local SimpleSAMLphp or Keycloak instance.
