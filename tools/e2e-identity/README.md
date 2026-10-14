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
