// SPDX-License-Identifier: EUPL-1.2
// Admin-only (client-rendered) OIDC client: Authorization Code + PKCE (S256)
// against the public client `oecp-admin` (spec §4). Public pages never call this.
//
// Storage:
// - Tokens (the `User`) live in memory only (InMemoryWebStorage): no cookies, no
//   localStorage; a full page reload signs the user out of the SPA.
// - The transient sign-in state (random `state` id, PKCE code_verifier, nonce and
//   our `returnTo`) must survive the full-page redirect to Keycloak and back, so
//   oidc-client-ts keeps it in sessionStorage (this tab only, never sent to a
//   server) and deletes it when the callback is processed. It holds no token.
// - No silent renew, no session monitor iframe, no userinfo call.
import type { User, UserManager, UserManagerSettings } from 'oidc-client-ts';
import { computed, shallowRef } from 'vue';

export interface AuthConfig {
  /** https://{auth-host}/realms/oecp (NUXT_PUBLIC_OIDC_AUTHORITY). */
  authority: string;
  clientId: string;
  /** Path of the callback page, e.g. `/en/admin/callback`. */
  redirectPath: string;
  /** Default landing path after RP-initiated logout, e.g. `/en`. */
  postLogoutPath: string;
  /** Where to go after sign-in when no `returnTo` was given. */
  homePath: string;
}

/** Spec §2.2/§4: the realm maps LoA 2 (second factor passed) to acr `mfa`. */
export const REQUIRED_ACR = 'mfa';

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
let manager: Promise<UserManager> | undefined;
let callback: Promise<string> | undefined;

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
    postLogoutPath: pub.oidcPostLogoutPath,
    homePath: pub.oidcHomePath,
  });
}
