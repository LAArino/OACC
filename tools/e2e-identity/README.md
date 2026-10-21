<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Identity end-to-end suite

A [Playwright Test](https://playwright.dev/docs/test-intro) suite that drives a
headless Chromium through the administrator onboarding against the Compose
stack (`deploy/compose`, profile `dev`: Mailpit and the test SAML IdP playing
URV). It runs locally against the dev stack and in GitHub Actions
([`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml)) against a
stack built in the runner.

| Spec | What it asserts |
|---|---|
| `01-local-account` | **Bootstrap** (only when the realm has no alliance admin, i.e. in CI): `bootstrap-alliance-admin` prints the link and has Keycloak e-mail the set-up link; the set-up e-mail from Mailpit sets the password and enrols TOTP; the invitation link → PKCE sign-in with `acr=mfa` → accept (200, `alliance_admin`, Aurora) → sign out → sign in with a fresh OTP code → token and `/me` with roles `[alliance_admin]`, `acr=mfa`, `idp: local`. **Invited local account**: the alliance admin invites `local.<run>@e2e.example` through the admin API; the same path; the admins listing shows it (`idp: local`) and the invitation is `accepted`; then it is revoked and its Keycloak account deleted. |
| `02-brokered-accept` | Invitation of the address the test IdP asserts (`partner.admin@urv.cat`, from `deploy/compose/test-saml-idp/users.json`) as `partner_admin` of `urv`: link with `&idp=urv`, only "Sign in through your university", authorization request with `kc_idp_hint=urv`, `acr_values=mfa`, S256; IdP login, first-broker-login, post-broker TOTP enrolment; accept (200); sign in again through the university chooser (OTP form); token and `/me` with `[partner_admin]`, `org_id` URV, `idp: urv`, `acr=mfa`; the dashboard says "Signed in through urv"; the admins listing shows `idp: urv`; the Keycloak user has the federated identity (`userId` = subject-id), `schacHomeOrganization`, `oecp_org_id` and no password. Revoked and deleted afterwards. |
| `03-brokered-negative` | 403 `oecp.invitation.mismatch` with the right `detail` for an **e-mail** mismatch (IdP asserts another address), an **idp** mismatch (the alliance admin's address invited to `urv`, link without `&idp=urv`, local sign-in, no `idp` claim) and a **schacHomeOrganization** mismatch (`visiting.scholar` asserts `example.edu`); **no account linking**: `email.collision` asserts the address of a local account (the dev alliance admin; in CI a stand-in local account created and deleted by the test), Keycloak stops at first-broker-login ("already exists"), the local account gets no federated identity and no brokered user is created. |
| `04-invitation-idp-not-enabled` | An invitation to `cbs` (IdP alias in the seed, no IdP in the realm, no alias in the public reference) is refused with 409 `oecp.invitation.idp_not_enabled` by `POST /invitations` and `POST /organizations/{id}/invitations`; no invitation, Keycloak user or e-mail is created. |

Every spec cleans up after itself: invitations it created are revoked, the
administrators it created are revoked through the admin API and their Keycloak
accounts deleted (with their secrets in the state directory), and the brokered
test users are deleted from Keycloak before and after each test (so each run
goes through first-broker-login and TOTP enrolment). The standing dev alliance
admin is never touched. Test addresses are under `@e2e.example`.

## Run it locally

Prerequisites: the stack of [`deploy/compose`](../../deploy/compose/README.md)
with profile `dev`, `OECP_DEV_IDP_ENABLED=true` in `deploy/compose/.env`,
migrations and seeds applied, and Mailpit on `127.0.0.1:8025`.

```bash
cd tools/e2e-identity
npm ci && npx playwright install chromium
npx playwright test                       # the whole suite, ~2-3 min
npx playwright test 03 -g "schac"         # one spec, one test
npx playwright show-trace test-results/<test>/trace.zip   # after a failure
```

The suite signs in as an alliance admin to create and revoke invitations:

- With an alliance admin already in the realm (the usual dev stack), it uses the
  standing dev admin: `deploy/compose/secrets/dev_alliance_admin_password` and
  `dev_alliance_admin_totp` (git-ignored; e-mail `admin@aurora-universities.eu`,
  or `OECP_E2E_ALLIANCE_EMAIL`). The bootstrap test is then skipped.
- On a stack without one (fresh volumes, CI), it bootstraps
  `ci.alliance@e2e.example` and keeps its password and TOTP seed in the state
  directory.

To create the standing dev admin by hand once (as the suite's bootstrap does):
generate `dev_alliance_admin_password` (`openssl rand -base64 18 | tr -d '\n'`),
run `docker compose run --rm -T api node dist/cli.js bootstrap-alliance-admin
--email admin@aurora-universities.eu --org aurora` in `deploy/compose`, complete
the "Update Your Account" e-mail in Mailpit with that password, put the TOTP
secret ("Unable to scan?") in `dev_alliance_admin_totp`, and open the printed
link.

Environment (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `OECP_E2E_PORTAL` | `https://oecp.localhost` | Portal origin (also the Playwright `baseURL`) |
| `OECP_E2E_AUTH` | `https://auth.<portal host>` | Keycloak origin |
| `OECP_E2E_MAILPIT` | `http://127.0.0.1:8025` | Mailpit API |
| `OECP_E2E_TEST_IDP` | `http://127.0.0.1:8091` | Test SAML IdP (`OECP_DEV_IDP_PORT`) |
| `OECP_E2E_COMPOSE_DIR` | `deploy/compose` | Where `docker compose run … api` runs |
| `OECP_COMPOSE_SECRETS` | `<compose dir>/secrets` | `keycloak_admin_password` (Keycloak Admin REST for set-up and clean-up) and `dev_alliance_admin_*` |
| `OECP_E2E_STATE_DIR` | `$RUNNER_TEMP/oecp-e2e`, else `<tmp>/oecp-e2e` | Passwords and TOTP seeds the suite creates, last OTP period per account (mode 700) |
| `OECP_E2E_ALLIANCE_EMAIL` | `admin@aurora-universities.eu` | E-mail of the standing dev admin |
| `OECP_E2E_BOOTSTRAP_EMAIL` | `ci.alliance@e2e.example` | Alliance admin bootstrapped on an empty stack |
| `OECP_E2E_REQUIRE_BOOTSTRAP` | unset | `true`: fail instead of skipping the bootstrap test when an alliance admin exists (CI) |
| `OECP_E2E_UNROUTED_ORG` | `cbs` | Organization with an IdP alias but no realm IdP (spec 04) |

Secrets are never printed; failure messages contain no tokens. Traces and
screenshots of failed tests (`test-results/`, git-ignored) do contain what the
browser typed, so do not share traces made with the dev admin's credentials.

Keycloak refuses an OTP code reused within its 30 s period, also across
processes, so the suite remembers the last period used per account in the
state directory and waits for a fresh one: a run spends most of its time
waiting for OTP periods.

## What CI does

[`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) runs on manual
dispatch, on every push to `main`, and on pull requests that touch `apps/`,
`packages/`, `identity/`, `deploy/compose/` or this directory. One
`ubuntu-24.04` job, 30-minute timeout:

1. `.env` from `.env.example` with the dev overrides appended (profile `dev`,
   Mailpit SMTP, `OECP_DEV_IDP_ENABLED=true`, `OECP_MAIL_LOG_LINKS=true`, hosts
   `oecp.localhost` / `auth.oecp.localhost`), checked against `docker compose
   config`; throwaway secrets from `openssl rand` and `tools/scripts/gen-saml-keys.sh`.
2. `oecp.localhost` and `auth.oecp.localhost` mapped to 127.0.0.1 in `/etc/hosts`.
3. `docker compose up -d --build --wait` (no image cache: every image is built
   in the job), then waits for the one-shot `keycloak-config`; the build and
   start time goes to the job summary.
4. Migrations, `seed-organizations`, `seed-attribute-definitions`; waits until
   the public reference publishes `idp_alias: urv`.
5. `npm ci`, `npx playwright install --with-deps chromium`, `npx playwright
   test` with `OECP_E2E_REQUIRE_BOOTSTRAP=true` (the database is empty, so spec
   01 bootstraps `ci.alliance@e2e.example`).
6. On failure: `test-results/` (traces, screenshots) and `docker compose logs`
   as the artifact `e2e-identity-<run>-<attempt>` (7 days).
7. Always: `docker compose down -v`.
