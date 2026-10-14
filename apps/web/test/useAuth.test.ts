// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from '../app/composables/useAuth';

const oidc = vi.hoisted(() => {
  const settings: Record<string, unknown>[] = [];
  return {
    settings,
    signinRedirect: vi.fn(),
    signinRedirectCallback: vi.fn(),
    signoutRedirect: vi.fn(),
    signinSilent: vi.fn(),
    signinSilentCallback: vi.fn(),
  };
});

vi.mock('oidc-client-ts', () => ({
  InMemoryWebStorage: class {
    readonly kind = 'memory';
  },
  WebStorageStateStore: class {
    constructor(readonly options: { store: unknown }) {}
  },
  UserManager: class {
    constructor(settings: Record<string, unknown>) {
      oidc.settings.push(settings);
    }
    signinRedirect = oidc.signinRedirect;
    signinRedirectCallback = oidc.signinRedirectCallback;
    signoutRedirect = oidc.signoutRedirect;
    signinSilent = oidc.signinSilent;
    signinSilentCallback = oidc.signinSilentCallback;
  },
}));

const config: AuthConfig = {
  authority: 'https://auth.oecp.localhost/realms/oecp',
  clientId: 'oecp-admin',
  redirectPath: '/en/admin/callback',
  silentRedirectPath: '/en/admin/silent-callback',
  postLogoutPath: '/en',
  homePath: '/en/admin',
};
const ORIGIN = 'https://oecp.localhost';

function fakeUser(state: unknown, expired = false) {
  return { access_token: 'access', id_token: 'id-token', expired, state, profile: { sub: 's' } };
}

// The composable keeps one client and one user per page load: start each test fresh.
async function load() {
  vi.resetModules();
  return import('../app/composables/useAuth');
}

beforeEach(() => {
  oidc.settings.length = 0;
  vi.clearAllMocks();
});

describe('oidcSettings', () => {
  it('sends Authorization Code + PKCE with acr mfa', async () => {
    const { oidcSettings } = await load();
    expect(oidcSettings(config, ORIGIN)).toEqual({
      authority: 'https://auth.oecp.localhost/realms/oecp',
      client_id: 'oecp-admin',
      redirect_uri: 'https://oecp.localhost/en/admin/callback',
      silent_redirect_uri: 'https://oecp.localhost/en/admin/silent-callback',
      silentRequestTimeoutInSeconds: 60,
      post_logout_redirect_uri: 'https://oecp.localhost/en',
      response_type: 'code',
      scope: 'openid email',
      acr_values: 'mfa',
      loadUserInfo: false,
      automaticSilentRenew: false,
      monitorSession: false,
      disablePKCE: false,
    });
  });

  it('refuses an empty authority', async () => {
    const { oidcSettings } = await load();
    expect(() => oidcSettings({ ...config, authority: '' }, ORIGIN)).toThrow(/authority/);
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/en/admin/accept', '/en/admin/accept'],
    ['/en/admin?x=1', '/en/admin?x=1'],
    ['//evil.example/x', '/fallback'],
    ['/\\evil.example', '/fallback'],
    ['https://evil.example/', '/fallback'],
    ['en/admin', '/fallback'],
    ['/en/\nadmin', '/fallback'],
    [undefined, '/fallback'],
    [42, '/fallback'],
  ])('%j -> %j', async (value, expected) => {
    const { safeReturnTo } = await load();
    expect(safeReturnTo(value, '/fallback')).toBe(expected);
  });
});

describe('createAuth', () => {
  it('keeps tokens in memory and the sign-in state in sessionStorage', async () => {
    const { createAuth } = await load();
    await createAuth(config).login('/en/admin/accept');
    expect(oidc.settings).toHaveLength(1);
    const settings = oidc.settings[0] as {
      userStore: { options: { store: { kind?: string } } };
      stateStore: { options: { store: unknown } };
    };
    expect(settings.userStore.options.store.kind).toBe('memory');
    expect(settings.stateStore.options.store).toBe(window.sessionStorage);
  });

  it('login puts returnTo in the OIDC state and passes kc_idp_hint', async () => {
    const { createAuth } = await load();
    const auth = createAuth(config);
    await auth.login('/en/admin/accept', { idpHint: 'urv' });
    expect(oidc.signinRedirect).toHaveBeenCalledWith({
      state: { returnTo: '/en/admin/accept' },
      extraQueryParams: { kc_idp_hint: 'urv' },
    });
    await auth.login('https://evil.example/');
    expect(oidc.signinRedirect).toHaveBeenLastCalledWith({ state: { returnTo: '/en/admin' } });
  });

  it('handleCallback stores the user and returns returnTo', async () => {
    const { createAuth } = await load();
    oidc.signinRedirectCallback.mockResolvedValue(fakeUser({ returnTo: '/en/admin/accept' }));
    const auth = createAuth(config);
    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.accessToken.value).toBeUndefined();
    await expect(auth.handleCallback()).resolves.toBe('/en/admin/accept');
    // Processed once per page load even if called again.
    await expect(auth.handleCallback()).resolves.toBe('/en/admin/accept');
    expect(oidc.signinRedirectCallback).toHaveBeenCalledTimes(1);
    // Shared state: a second useAuth() sees the same user.
    const other = createAuth(config);
    expect(other.isAuthenticated.value).toBe(true);
    expect(other.accessToken.value).toBe('access');
  });

  it('handleCallback falls back to the admin home for a missing or unsafe returnTo', async () => {
    const { createAuth } = await load();
    oidc.signinRedirectCallback.mockResolvedValue(fakeUser({ returnTo: '//evil.example' }));
    await expect(createAuth(config).handleCallback()).resolves.toBe('/en/admin');
  });

  it('treats an expired user as signed out', async () => {
    const { createAuth } = await load();
    oidc.signinRedirectCallback.mockResolvedValue(fakeUser(undefined, true));
    const auth = createAuth(config);
    await auth.handleCallback();
    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.accessToken.value).toBeUndefined();
  });

  it('logout clears the user and sends id_token_hint and post_logout_redirect_uri', async () => {
    const { createAuth } = await load();
    oidc.signinRedirectCallback.mockResolvedValue(fakeUser(undefined));
    const auth = createAuth(config);
    await auth.handleCallback();
    await auth.logout({ returnTo: '/en/admin' });
    expect(auth.isAuthenticated.value).toBe(false);
    expect(oidc.signoutRedirect).toHaveBeenCalledWith({
      post_logout_redirect_uri: `${window.location.origin}/en/admin`,
      id_token_hint: 'id-token',
    });
    await auth.logout();
    expect(oidc.signoutRedirect).toHaveBeenLastCalledWith({
      post_logout_redirect_uri: `${window.location.origin}/en`,
    });
  });
});

describe('restoreSession (silent renew after a reload)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restores the user in memory through signinSilent, once per page load', async () => {
    const { createAuth } = await load();
    oidc.signinSilent.mockResolvedValue(fakeUser(undefined));
    const auth = createAuth(config);
    expect(auth.isAuthenticated.value).toBe(false);
    const pending = auth.restoreSession();
    expect(auth.restoring.value).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(auth.restoring.value).toBe(false);
    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.accessToken.value).toBe('access');
    // The user store is the in-memory one: nothing reaches sessionStorage or localStorage.
    const settings = oidc.settings[0] as { userStore: { options: { store: { kind?: string } } } };
    expect(settings.userStore.options.store.kind).toBe('memory');
    expect(window.localStorage.length).toBe(0);
    await expect(createAuth(config).restoreSession()).resolves.toBe(true);
    expect(oidc.signinSilent).toHaveBeenCalledTimes(1);
  });

  it('resolves to false when Keycloak has no session (login_required), without retrying', async () => {
    const { createAuth } = await load();
    oidc.signinSilent.mockRejectedValue(
      Object.assign(new Error('login_required'), { error: 'login_required' }),
    );
    const auth = createAuth(config);
    await expect(auth.restoreSession()).resolves.toBe(false);
    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.restoring.value).toBe(false);
    await expect(auth.restoreSession()).resolves.toBe(false);
    expect(oidc.signinSilent).toHaveBeenCalledTimes(1);
  });

  it('ignores an expired or missing user', async () => {
    const { createAuth } = await load();
    oidc.signinSilent.mockResolvedValue(fakeUser(undefined, true));
    const auth = createAuth(config);
    await expect(auth.restoreSession()).resolves.toBe(false);
    expect(auth.isAuthenticated.value).toBe(false);
  });

  it('gives up after 60 seconds when the iframe never answers', async () => {
    const { createAuth, SILENT_RENEW_TIMEOUT_SECONDS } = await load();
    expect(SILENT_RENEW_TIMEOUT_SECONDS).toBe(60);
    oidc.signinSilent.mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers();
    const auth = createAuth(config);
    let result: boolean | undefined;
    void auth.restoreSession().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(result).toBeUndefined();
    expect(auth.restoring.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result).toBe(false);
    expect(auth.restoring.value).toBe(false);
  });

  it('never starts a renew inside a frame (the silent-callback page itself)', async () => {
    const { createAuth } = await load();
    vi.stubGlobal('top', {});
    await expect(createAuth(config).restoreSession()).resolves.toBe(false);
    expect(oidc.signinSilent).not.toHaveBeenCalled();
  });

  it('does nothing when a user is already signed in', async () => {
    const { createAuth } = await load();
    oidc.signinRedirectCallback.mockResolvedValue(fakeUser(undefined));
    const auth = createAuth(config);
    await auth.handleCallback();
    await expect(auth.restoreSession()).resolves.toBe(true);
    expect(oidc.signinSilent).not.toHaveBeenCalled();
  });

  it('handleSilentCallback hands the response to the parent window', async () => {
    const { createAuth } = await load();
    await createAuth(config).handleSilentCallback();
    expect(oidc.signinSilentCallback).toHaveBeenCalledTimes(1);
  });
});
