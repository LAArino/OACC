// SPDX-License-Identifier: EUPL-1.2
// Admin-only (client-rendered) OIDC client: Authorization Code + PKCE against the
// `oecp-admin` public client, tokens in memory (spec §4). Public pages never call this.
// Callback handling and the invitation hand-off are not implemented yet.
import type { User, UserManager } from 'oidc-client-ts';

interface OidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
}

let manager: Promise<UserManager> | undefined;

function userManager(config: OidcConfig): Promise<UserManager> {
  if (import.meta.server) throw new Error('useAuth is client-only');
  manager ??= import('oidc-client-ts').then(
    ({ InMemoryWebStorage, UserManager, WebStorageStateStore }) =>
      new UserManager({
        authority: config.authority,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'openid',
        userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
        automaticSilentRenew: false,
      }),
  );
  return manager;
}

export function useAuth() {
  const user = useState<User | null>('oecp-admin-user', () => null);
  const { oidcAuthority, oidcClientId, oidcRedirectPath } = useRuntimeConfig().public;
  const config = (): OidcConfig => ({
    authority: oidcAuthority,
    clientId: oidcClientId,
    redirectUri: new URL(oidcRedirectPath, window.location.origin).href,
  });

  return {
    user: readonly(user),
    isAuthenticated: computed(() => user.value !== null && !user.value.expired),
    accessToken: () => user.value?.access_token,
    /** `idpHint` maps to Keycloak `kc_idp_hint` (partner IdP alias). */
    async login(idpHint?: string) {
      const um = await userManager(config());
      await um.signinRedirect(idpHint ? { extraQueryParams: { kc_idp_hint: idpHint } } : undefined);
    },
    async logout() {
      const um = await userManager(config());
      user.value = null;
      await um.signoutRedirect();
    },
  };
}
