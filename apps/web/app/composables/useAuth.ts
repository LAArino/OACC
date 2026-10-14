// SPDX-License-Identifier: EUPL-1.2
// Admin-only (client-rendered) OIDC client: Authorization Code + PKCE (S256)
// against the public client `oecp-admin` (spec §4). Public pages never call this.
//
// Storage:
// - Tokens (the `User`) live in memory only (InMemoryWebStorage): no cookies, no
//   localStorage; after a full page reload the session is restored silently
//   (hidden iframe, prompt=none) when Keycloak still has an SSO session.
// - The transient sign-in state (random `state` id, PKCE code_verifier, nonce and
//   our `returnTo`) must survive the full-page redirect to Keycloak and back, so
//   oidc-client-ts keeps it in sessionStorage (this tab only, never sent to a
//   server) and deletes it when the callback is processed. It holds no token.
// - No automatic renew timer, no session monitor iframe, no userinfo call.
//
// Session restore on reload (`restoreSession`): because tokens are never stored,
// a reload starts without a user. The admin layout then asks Keycloak once, in a
// hidden iframe, for a new code with `prompt=none` (oidc-client-ts
// `signinSilent()`), against `silent_redirect_uri` = `/{locale}/admin/silent-callback`,
// which is covered by the `oecp-admin` redirect URI pattern `https://{portal}/en/admin/*`.
// It succeeds only while the Keycloak SSO session is alive (idle 30 min, max 8 h)
// and otherwise fails fast with `login_required`, leaving the normal sign-in prompt.
// Requirements outside this file, without which it fails (after at most
// SILENT_RENEW_TIMEOUT_SECONDS) and the page falls back to the sign-in prompt:
// - Keycloak's session cookies (`KEYCLOAK_IDENTITY`, `KEYCLOAK_SESSION`,
//   `SameSite=None; Secure`) must reach the auth host from an iframe embedded in
//   the portal: keep the auth host on the same site (registrable domain) as the
//   portal, e.g. `auth.example.eu` and `portal.example.eu`. A cross-site auth host
//   is a third-party context, whose cookies Safari, Firefox and Chrome block.
// - The portal must allow framing of its own pages (`X-Frame-Options: SAMEORIGIN`
//   or `frame-ancestors 'self'`, not `DENY`) at least for the silent-callback page,
//   which runs in the iframe and posts the result to this window (same origin only).
// - Keycloak answers `prompt=none` with a redirect, so its own framing headers
//   (`X-Frame-Options`, CSP `frame-ancestors`) do not apply to that response.
// The renewed tokens stay in memory like the others; nothing is persisted.
import type { User, UserManager, UserManagerSettings } from 'oidc-client-ts';
import { computed, shallowRef } from 'vue';

export interface AuthConfig {
  /** https://{auth-host}/realms/oecp (NUXT_PUBLIC_OIDC_AUTHORITY). */
  authority: string;
  clientId: string;
  /** Path of the callback page, e.g. `/en/admin/callback`. */
  redirectPath: string;
  /** Path of the silent-renew page loaded in the hidden iframe, e.g. `/en/admin/silent-callback`. */
  silentRedirectPath: string;
  /** Default landing path after RP-initiated logout, e.g. `/en`. */
  postLogoutPath: string;
  /** Where to go after sign-in when no `returnTo` was given. */
  homePath: string;
}

/** Spec §2.2/§4: the realm maps LoA 2 (second factor passed) to acr `mfa`. */
export const REQUIRED_ACR = 'mfa';

/** Upper bound of a silent session restore (iframe with `prompt=none`). */
export const SILENT_RENEW_TIMEOUT_SECONDS = 60;

/** OIDC parameters sent to Keycloak (without the client-side stores). */
export function oidcSettings(
  config: AuthConfig,
  origin: string,
): Omit<UserManagerSettings, 'userStore' | 'stateStore'> {
  if (!config.authority) throw new Error('OIDC authority is not configured');
  return {
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: new URL(config.redirectPath, origin).href,
    silent_redirect_uri: new URL(config.silentRedirectPath, origin).href,
    silentRequestTimeoutInSeconds: SILENT_RENEW_TIMEOUT_SECONDS,
    post_logout_redirect_uri: new URL(config.postLogoutPath, origin).href,
    response_type: 'code',
    // Scope `oecp` (aud, roles, org_id, idp, name) and `acr` are default client
    // scopes of `oecp-admin` in the realm, so they need not be requested.
    scope: 'openid email',
    // Asks Keycloak for LoA 2 (second factor). The client also has
    // default.acr.values=mfa and minimum.acr.value=mfa, so this is belt and braces.
    acr_values: REQUIRED_ACR,
    loadUserInfo: false,
    automaticSilentRenew: false,
    monitorSession: false,
    // PKCE S256 is oidc-client-ts' default and cannot be weakened here.
    disablePKCE: false,
  };
}

/**
 * Keeps only same-origin absolute paths (`/en/admin/...`) so that `returnTo`
 * can never redirect elsewhere; anything else becomes `fallback`.
 */
export function safeReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  // Backslashes and control characters can turn into `//` in some URL parsers.
  if ([...value].some((c) => c === '\\' || c.charCodeAt(0) < 0x20)) return fallback;
  return value;
}

interface SigninState {
  returnTo: string;
}

function returnToOf(state: unknown, fallback: string): string {
  const returnTo =
    typeof state === 'object' && state !== null ? (state as Partial<SigninState>).returnTo : null;
  return safeReturnTo(returnTo, fallback);
}

// Module-level singletons: one OIDC client and one in-memory user per tab.
const currentUser = shallowRef<User | null>(null);
const restoring = shallowRef(false);
let manager: Promise<UserManager> | undefined;
let callback: Promise<string> | undefined;
let restore: Promise<boolean> | undefined;

/** Rejects when `promise` has not settled after `ms` (the iframe may never answer). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Silent sign-in timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** True inside a frame: the silent-callback page must never start a renew of its own. */
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function userManager(config: AuthConfig): Promise<UserManager> {
  if (import.meta.server) throw new Error('useAuth is client-only');
  manager ??= import('oidc-client-ts').then(
    ({ InMemoryWebStorage, UserManager, WebStorageStateStore }) =>
      new UserManager({
        ...oidcSettings(config, window.location.origin),
        userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
        stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
      }),
  );
  return manager;
}

export interface LoginOptions {
  /** Keycloak `kc_idp_hint`: partner IdP alias (spec §2.1 step 3). */
  idpHint?: string;
}

export interface LogoutOptions {
  /** Same-origin path to land on after Keycloak logout (default `postLogoutPath`). */
  returnTo?: string;
}

/** The auth API behind `useAuth()`, without Nuxt runtime dependencies (unit-testable). */
export function createAuth(config: AuthConfig) {
  return {
    user: computed(() => currentUser.value),
    isAuthenticated: computed(() => currentUser.value !== null && !currentUser.value.expired),
    /** Bearer token for the admin API; never log or render it. */
    accessToken: computed(() =>
      currentUser.value && !currentUser.value.expired ? currentUser.value.access_token : undefined,
    ),

    /** True while `restoreSession()` waits for Keycloak. */
    restoring: computed(() => restoring.value),

    /**
     * Restores the session after a reload without user interaction (see the
     * header comment): resolves to true when a user is now signed in. Attempted
     * at most once per page load; never inside a frame; failures (no Keycloak
     * session, blocked cookies or framing, timeout) resolve to false.
     */
    restoreSession(): Promise<boolean> {
      if (currentUser.value && !currentUser.value.expired) return Promise.resolve(true);
      if (import.meta.server || isFramed()) return Promise.resolve(false);
      restore ??= (async () => {
        restoring.value = true;
        try {
          const um = await userManager(config);
          const user = await withTimeout(um.signinSilent(), SILENT_RENEW_TIMEOUT_SECONDS * 1000);
          if (!user || user.expired) return false;
          currentUser.value = user;
          return true;
        } catch {
          // `login_required`, `interaction_required`, timeout: sign in interactively.
          return false;
        } finally {
          restoring.value = false;
        }
      })();
      return restore;
    },

    /**
     * Runs on the silent-callback page inside the hidden iframe: hands the
     * authorization response to the parent window (same origin only), which
     * exchanges the code. No token is handled here.
     */
    async handleSilentCallback(): Promise<void> {
      const um = await userManager(config);
      await um.signinSilentCallback();
    },

    /** Starts the Authorization Code + PKCE redirect; `returnTo` travels in the OIDC state. */
    async login(returnTo?: string, options: LoginOptions = {}): Promise<void> {
      const um = await userManager(config);
      const state: SigninState = { returnTo: safeReturnTo(returnTo, config.homePath) };
      await um.signinRedirect({
        state,
        ...(options.idpHint ? { extraQueryParams: { kc_idp_hint: options.idpHint } } : {}),
      });
    },

    /**
     * Completes sign-in on the callback page (code exchange with the PKCE
     * verifier) and resolves to the path to continue to. Idempotent per page load.
     */
    handleCallback(): Promise<string> {
      callback ??= (async () => {
        const um = await userManager(config);
        const user = await um.signinRedirectCallback();
        currentUser.value = user;
        return returnToOf(user.state, config.homePath);
      })();
      return callback;
    },

    /** RP-initiated logout at Keycloak (spec §2.2). */
    async logout(options: LogoutOptions = {}): Promise<void> {
      const um = await userManager(config);
      const idToken = currentUser.value?.id_token;
      currentUser.value = null;
      const path = safeReturnTo(options.returnTo, config.postLogoutPath);
      await um.signoutRedirect({
        post_logout_redirect_uri: new URL(path, window.location.origin).href,
        ...(idToken ? { id_token_hint: idToken } : {}),
      });
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;

export function useAuth(): Auth {
  const pub = useRuntimeConfig().public;
  return createAuth({
    authority: pub.oidcAuthority,
    clientId: pub.oidcClientId,
    redirectPath: pub.oidcRedirectPath,
    silentRedirectPath: pub.oidcSilentRedirectPath,
    postLogoutPath: pub.oidcPostLogoutPath,
    homePath: pub.oidcHomePath,
  });
}
