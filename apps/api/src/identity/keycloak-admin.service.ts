// SPDX-License-Identifier: EUPL-1.2
import { KeycloakAdminError } from './keycloak-admin.error.js';

/** User attribute holding `organizations.id`, mapped to the `org_id` claim (spec §4). */
export const OECP_ORG_ID_ATTRIBUTE = 'oecp_org_id';
/** User attribute written by the partner IdP mappers (identity/keycloak/realm-oecp.yaml). */
export const SCHAC_HOME_ORGANIZATION_ATTRIBUTE = 'schacHomeOrganization';
/** Public client of the admin SPA; target of execute-actions e-mail links. */
export const ADMIN_SPA_CLIENT_ID = 'oecp-admin';

export type RequiredAction = 'UPDATE_PASSWORD' | 'CONFIGURE_TOTP';

export interface KeycloakUser {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  requiredActions?: string[];
  attributes?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface KeycloakRole {
  id: string;
  name: string;
}

export interface CreateLocalUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  requiredActions: RequiredAction[];
}

export interface ExecuteActionsEmailOptions {
  /** Where Keycloak sends the user after the actions; must match a client redirect URI. */
  redirectUri: string;
  clientId?: string;
  /** Link lifetime; Keycloak's realm default (`actionTokenGeneratedByAdminLifespan`) if absent. */
  lifespanSeconds?: number;
}

export interface KeycloakAdminOptions {
  /** Internal base URL, e.g. `http://keycloak:8080` (no trailing slash). */
  baseUrl: string;
  realm: string;
  clientId: string;
  /** Returns the client secret; called lazily so a missing secret only fails on use. */
  clientSecret: () => string;
  /** Per-request timeout; default 10 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Statuses returned to the caller instead of being raised. */
  accept?: number[];
}

const PAGE_SIZE = 100;
/** Renew the cached service-account token this long before it expires. */
const TOKEN_RENEWAL_MARGIN_MS = 30_000;

/**
 * Minimal client of the Keycloak Admin REST API for the confidential client
 * `oecp-backend` (client-credentials grant). It needs only the realm-management
 * roles `view-users` and `manage-users`.
 */
export class KeycloakAdminService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private cachedToken: { value: string; expiresAt: number } | undefined;
  private tokenRequest: Promise<string> | undefined;

  constructor(private readonly options: KeycloakAdminOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Exact (case-insensitive) e-mail match with its required actions, or undefined. */
  async findUserByEmail(email: string): Promise<KeycloakUser | undefined> {
    const response = await this.request('find user by e-mail', 'GET', '/users', {
      query: { email, exact: true, briefRepresentation: false, max: 2 },
    });
    const users = (await response.json()) as KeycloakUser[];
    return users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  }

  async getUser(userId: string): Promise<KeycloakUser | undefined> {
    const response = await this.request('get user', 'GET', `/users/${enc(userId)}`, {
      accept: [404],
    });
    if (response.status === 404) return undefined;
    return (await response.json()) as KeycloakUser;
  }

  /** Creates an enabled local user (username = e-mail) and returns its id. */
  async createLocalUser(input: CreateLocalUserInput): Promise<string> {
    const email = input.email.toLowerCase();
    const response = await this.request('create user', 'POST', '/users', {
      body: {
        username: email,
        email,
        // The address was entered by an alliance_admin and the password can only
        // be set through the execute-actions link sent to it.
        emailVerified: true,
        enabled: true,
        firstName: input.firstName,
        lastName: input.lastName,
        requiredActions: input.requiredActions,
      },
    });
    const id = response.headers.get('location')?.split('/').pop();
    if (id) return decodeURIComponent(id);
    const created = await this.findUserByEmail(email);
    if (!created) throw new KeycloakAdminError('create user', response.status);
    return created.id;
  }

  /** Sends Keycloak's "execute actions" e-mail (e.g. set password, enrol TOTP). */
  async sendExecuteActionsEmail(
    userId: string,
    actions: RequiredAction[],
    options: ExecuteActionsEmailOptions,
  ): Promise<void> {
    await this.request(
      'send execute-actions e-mail',
      'PUT',
      `/users/${enc(userId)}/execute-actions-email`,
      {
        query: {
          client_id: options.clientId ?? ADMIN_SPA_CLIENT_ID,
          redirect_uri: options.redirectUri,
          lifespan: options.lifespanSeconds,
        },
        body: actions,
      },
    );
  }

  /**
   * Sets (or, with null, removes) a single-valued user attribute. Keycloak replaces
   * the whole attribute map on update, so the current representation is merged.
   */
  async setUserAttribute(userId: string, name: string, value: string | null): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) throw new KeycloakAdminError('set user attribute', 404);
    const attributes = { ...user.attributes };
    if (value === null) delete attributes[name];
    else attributes[name] = [value];
    await this.request('set user attribute', 'PUT', `/users/${enc(userId)}`, {
      body: { ...user, attributes },
    });
  }

  /** Idempotent. Uses the user's role-mapping endpoints, which need only manage-users. */
  async addRealmRole(userId: string, roleName: string): Promise<void> {
    const current = await this.realmRoleMappings(userId);
    if (current.some((r) => r.name === roleName)) return;
    const response = await this.request(
      'list available realm roles',
      'GET',
      `/users/${enc(userId)}/role-mappings/realm/available`,
    );
    const role = ((await response.json()) as KeycloakRole[]).find((r) => r.name === roleName);
    if (!role) throw new KeycloakAdminError(`add realm role ${roleName}`, 404);
    await this.request('add realm role', 'POST', `/users/${enc(userId)}/role-mappings/realm`, {
      body: [{ id: role.id, name: role.name }],
    });
  }

  /** Idempotent. */
  async removeRealmRole(userId: string, roleName: string): Promise<void> {
    const role = (await this.realmRoleMappings(userId)).find((r) => r.name === roleName);
    if (!role) return;
    await this.request('remove realm role', 'DELETE', `/users/${enc(userId)}/role-mappings/realm`, {
      body: [{ id: role.id, name: role.name }],
    });
  }

  /** Ends every session of the user (spec §2.2 revocation). */
  async logoutUser(userId: string): Promise<void> {
    await this.request('log out user', 'POST', `/users/${enc(userId)}/logout`);
  }

  /**
   * Number of users with a direct mapping of the realm role. Uses
   * `GET /roles/{name}/users`, which Keycloak guards with view-realm; without that
   * role (403) it falls back to scanning users' role mappings (view-users).
   */
  async countUsersWithRole(roleName: string): Promise<number> {
    let count = 0;
    for (let first = 0; ; first += PAGE_SIZE) {
      const response = await this.request(
        'list role members',
        'GET',
        `/roles/${enc(roleName)}/users`,
        { query: { first, max: PAGE_SIZE, briefRepresentation: true }, accept: [403] },
      );
      if (response.status === 403) {
        await response.body?.cancel();
        return this.countUsersWithRoleByScan(roleName);
      }
      const page = (await response.json()) as KeycloakUser[];
      count += page.length;
      if (page.length < PAGE_SIZE) return count;
    }
  }

  private async countUsersWithRoleByScan(roleName: string): Promise<number> {
    let count = 0;
    for (let first = 0; ; first += PAGE_SIZE) {
      const response = await this.request('list users', 'GET', '/users', {
        query: { first, max: PAGE_SIZE, briefRepresentation: true },
      });
      const page = (await response.json()) as KeycloakUser[];
      for (const user of page) {
        const roles = await this.realmRoleMappings(user.id);
        if (roles.some((r) => r.name === roleName)) count += 1;
      }
      if (page.length < PAGE_SIZE) return count;
    }
  }

  private async realmRoleMappings(userId: string): Promise<KeycloakRole[]> {
    const response = await this.request(
      'list realm role mappings',
      'GET',
      `/users/${enc(userId)}/role-mappings/realm`,
    );
    return (await response.json()) as KeycloakRole[];
  }

  private async request(
    operation: string,
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const url = new URL(`${this.options.baseUrl}/admin/realms/${enc(this.options.realm)}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.accessToken();
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      };
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const response = await this.send(operation, url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      if (response.ok || options.accept?.includes(response.status)) return response;
      await response.body?.cancel();
      if (response.status === 401 && attempt === 0) {
        // Token revoked or the realm keys rotated: renew once.
        this.cachedToken = undefined;
        continue;
      }
      throw new KeycloakAdminError(operation, response.status);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) return this.cachedToken.value;
    this.tokenRequest ??= this.fetchToken().finally(() => {
      this.tokenRequest = undefined;
    });
    return this.tokenRequest;
  }

  private async fetchToken(): Promise<string> {
    const operation = 'client-credentials token';
    const url = `${this.options.baseUrl}/realms/${enc(this.options.realm)}/protocol/openid-connect/token`;
    const response = await this.send(operation, url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret(),
      }).toString(),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new KeycloakAdminError(operation, response.status);
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string')
      throw new KeycloakAdminError(operation, response.status);
    const lifetimeMs = (typeof body.expires_in === 'number' ? body.expires_in : 60) * 1000;
    this.cachedToken = {
      value: body.access_token,
      expiresAt: this.now() + Math.max(0, lifetimeMs - TOKEN_RENEWAL_MARGIN_MS),
    };
    return body.access_token;
  }

  private async send(operation: string, url: URL | string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new KeycloakAdminError(operation, undefined, timedOut);
    }
  }
}

const enc = encodeURIComponent;
