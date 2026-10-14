<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Identity path: manual end-to-end check

Drives a headless Chromium (Playwright, `ignoreHTTPSErrors` for the self-signed dev
certificate) through the whole administrator onboarding against the local Compose
stack (`deploy/compose`, profile `dev`, Mailpit on 127.0.0.1:8025). It is a developer
tool, not a CI test; it writes the test admin's password and TOTP secret to
`deploy/compose/secrets/dev_alliance_admin_{password,totp}` (git-ignored).

```bash
cd tools/e2e-identity && npm install && npx playwright install chromium --only-shell
openssl rand -base64 18 | tr -d '\n' > ../../deploy/compose/secrets/dev_alliance_admin_password
# 1. bootstrap (prints the invitation link)
(cd ../../deploy/compose && docker compose --profile dev run --rm -T api node dist/cli.js bootstrap-alliance-admin --email admin@aurora-universities.eu --org aurora)
# 2. complete Keycloak's execute-actions mail (password + TOTP) found in Mailpit
node setup-account.js
# 3. invitation link -> OIDC login (PKCE, acr=mfa) -> accept -> sign out
node accept-flow.js "<invitation link>"
# 4. sign in again with a fresh OTP code and show /me
node relogin.js
```

Screenshots land in `./shots` (or `$OECP_E2E_SHOTS`). Verified on 2026-10-14 against
Keycloak 26.8.1: the whole path works; the realm rejects an OTP code reused within its
30 s period, so step 4 waits for a fresh period.

## Brokered path (test SAML IdP)

The partner-administrator path through a university IdP, against the dev-only
SAML IdP `test-saml-idp` (SimpleSAMLphp playing URV, realm IdP `urv`; see
[`identity/keycloak/README.md`](../../identity/keycloak/README.md#test-saml-idp-dev-profile)).
Prerequisites: the local-account steps above have been run once (the scripts
sign in as the alliance admin with `dev_alliance_admin_{password,totp}` to
create and revoke invitations), and IdP `urv` is enabled:

```bash
# deploy/compose/.env: OECP_DEV_IDP_ENABLED=true (and OECP_DEV_IDP_PORT=8091)
(cd ../../deploy/compose && docker compose --profile dev up -d test-saml-idp \
  && docker compose --profile dev run --rm keycloak-config && docker compose restart api)
node brokered-accept.js        # happy path, ~1-2 min
node brokered-negative.js      # email | idp | schac | linking | all (default)
```

`brokered-accept.js`: alliance admin invites `partner.admin@urv.cat` as
`partner_admin` of `urv` → link from Mailpit (`#token=…&idp=urv`) → accept
page → "Sign in through your university" (`kc_idp_hint=urv`) → IdP login
(user and password from `deploy/compose/test-saml-idp/users.json`) → Keycloak
first-broker-login (no linking) and post-broker MFA (TOTP enrolment on the
first run; the secret goes to `deploy/compose/secrets/dev_partner_admin_totp`)
→ accept → 200 `partner_admin`, URV → sign out → sign in again through the
university chooser → `/en/admin` shows the role, URV and "Signed in through
urv" → `GET /organizations/{urv}/admins` lists the user with `idp: "urv"` →
the Keycloak user has the federated identity (`userId` = subject-id) and the
imported `schacHomeOrganization`. It prints the claims of both tokens (never
the tokens) and one PASS/FAIL line per check; exit code 1 on any FAIL.
Re-runnable: an existing brokered user signs in with the stored OTP secret.

`brokered-negative.js` (each invitation is revoked afterwards):
`email` (invitation for another address → 403 `oecp.invitation.mismatch`),
`idp` (the alliance admin's address invited to `urv`, link opened without
`&idp=urv`, local sign-in → 403 mismatch), `schac` (`visiting.scholar`
asserts `example.edu` → 403 mismatch), `linking` (`email.collision` asserts
the alliance admin's e-mail → Keycloak refuses at first-broker-login, nothing
is linked or created). The OTP period used last per account is kept in the
temp directory, so consecutive runs wait for a fresh 30 s period instead of
reusing a code. Screenshots: `shots/2x-*` (accept) and `shots/3x-*` (negative).

Verified on 2026-10-14 (Keycloak 26.8.1, SimpleSAMLphp 1.19.9): all checks pass.

