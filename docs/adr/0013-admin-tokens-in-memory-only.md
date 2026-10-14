<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0013: Admin session tokens kept in memory only

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R01] `docs/review/01-identidad.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`, [ADR-0002](0002-vue3-nuxt-ssr-catalogue.md), [ADR-0004](0004-keycloak-only-identity-one-saml-idp-per-partner.md)

## Context and problem statement

The admin dashboard is a client-rendered part of the Nuxt app
([ADR-0002](0002-vue3-nuxt-ssr-catalogue.md)). It signs in through the public
Keycloak client `oecp-admin` with Authorization Code + PKCE and calls the
admin API with a bearer token; the backend never sets cookies and the public
portal must not carry any (spec §4, §7). Administrators can change partner
integrations, credentials, host approvals and published courses, so a stolen
token is valuable. Spec §2.2 sets short lifetimes: access token 5 minutes,
rotating single-use refresh tokens, SSO idle 30 minutes and maximum 8 hours,
no remember-me.

A single-page application has three places to keep tokens: memory, Web
Storage (`localStorage`/`sessionStorage`), or a server-side session behind an
HttpOnly cookie (backend-for-frontend). Web Storage is readable by any script
that runs on the origin, so one cross-site scripting flaw would leak tokens
that outlive the page. The web pages do not send the nonce-based Content
Security Policy of spec §10 yet (only `/api` and `/oeapi` carry a restrictive
policy; `docs/backlog.md`), which makes that risk more relevant. A backend-for-frontend would introduce a cookie, a session
store and CSRF protection into a front end that is otherwise stateless.

Where does the admin dashboard keep its tokens, and what does that cost in
usability?

## Decision drivers

- Minimise token exposure to script injection.
- No cookies set by OECP, no server-side session state in the web container.
- Simple, auditable client code with standard libraries (oidc-client-ts).
- Short sessions are acceptable for a small group of staff users.

## Considered options

1. Tokens in memory only; transient sign-in state in `sessionStorage`; no
   silent renew in the MVP.
2. Tokens in `localStorage` or `sessionStorage`.
3. Backend-for-frontend: the Nuxt server holds tokens, the browser gets an
   HttpOnly session cookie.
4. Tokens in memory with silent renew from the start.

## Decision outcome

Chosen option: **tokens in memory only, no silent renew in the MVP**
(spec §4).

As built (`apps/web/app/composables/useAuth.ts`, `useAdminApi.ts`,
`components/AdminSignInPrompt.vue`; realm `identity/keycloak/realm-oecp.yaml`):

- oidc-client-ts keeps the `User` (tokens) in `InMemoryWebStorage`: one
  in-memory user per tab, nothing in cookies or `localStorage`.
- Only the transient sign-in state (random `state`, PKCE verifier, nonce and
  the same-origin `returnTo` path) is in `sessionStorage`, because it must
  survive the redirect to Keycloak; it holds no token and is deleted when the
  callback is processed.
- `acr_values=mfa`; the client also enforces minimum ACR `mfa`. No silent
  renew, no session-monitor iframe, no userinfo call.
- The admin API client sends `Authorization: Bearer` with
  `credentials: 'omit'`; without a valid token it refuses locally with
  `oecp.auth.missing_token`, and admin pages show a sign-in prompt that
  returns to the current page.

### Consequences

- Good, because injected script cannot read tokens from storage, and closing
  the tab ends the client session.
- Good, because the web container stays stateless and cookie-free.
- Bad (accepted): a full page reload or a new tab requires signing in again,
  observed on 2026-10-14 (`docs/backlog.md`).
- Bad (accepted): the access token is not renewed, so after its 5-minute
  lifetime the dashboard asks for a new sign-in. While the Keycloak SSO
  session is alive, Keycloak normally completes that redirect without asking
  for credentials again.
- Neutral, because script injection could still use a token while the page is
  open; memory storage shortens exposure, the CSP must do the rest.

### Confirmation

Unit tests of `oidcSettings()` (in-memory store, no silent renew) and
`safeReturnTo()` in `apps/web/test/useAuth.test.ts`; the reload behaviour was
observed on the dev stack (`docs/backlog.md`).

## Pros and cons of the options

### Memory only

- Good, because of the smallest exposure to script injection.
- Bad, because of re-sign-in on reload and token expiry.

### Web Storage

- Good, because sessions survive reloads.
- Bad, because any script on the origin can read the tokens.

### Backend-for-frontend

- Good, because tokens never reach the browser.
- Bad, because of cookies, a session store and CSRF handling in the web tier.

### Memory with silent renew now

- Good, because the session survives token expiry and, through
  `prompt=none`, reloads.
- Bad, because it adds iframe or refresh-token handling that was not needed
  to deliver the MVP; planned next.

## More information

- Spec §2.2, §4, §10; [ADR-0004](0004-keycloak-only-identity-one-saml-idp-per-partner.md).
- Planned for v1 (`docs/backlog.md`): silent renew through a hidden iframe
  with `prompt=none` or the in-memory refresh token, keeping tokens out of
  storage. That change does not supersede this ADR.

## 2026-10-14 update: silent renew implemented

Release 0.2.0 implements the planned session restore without changing this
decision: tokens are still kept in memory only and nothing is persisted. After
a reload the admin layout calls oidc-client-ts `signinSilent()` once per page
load; a hidden iframe requests a new code with `prompt=none` against
`/en/admin/silent-callback`, and the page falls back to the sign-in prompt when
Keycloak has no live SSO session, when the attempt fails or after 60 seconds.
There is still no renew timer and no session-monitor iframe, so an access token
that expires while the page stays open still leads to the sign-in prompt. The
restore works only with the auth host on the same site as the portal and with
portal pages frameable by themselves (`X-Frame-Options: SAMEORIGIN`, now the
reference Traefik setting, instead of `DENY`). The "Bad (accepted)" consequence
about reloads therefore applies only when those requirements are not met or
the SSO session has ended. Details: spec §2.2 and §4
(`docs/spec-v4.1.md`); tests in `apps/web/test/useAuth.test.ts`.
