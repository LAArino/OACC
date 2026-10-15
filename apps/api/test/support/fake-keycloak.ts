// SPDX-License-Identifier: EUPL-1.2
/**
 * In-memory Keycloak Admin REST API (the subset KeycloakAdminService uses), as a
 * `fetch` double. Behaves like Keycloak 26 where it matters: `q=<attr>:<value>`
 * is an exact, case-insensitive attribute match; `GET /roles/{name}/users` is
 * refused without view-realm (403 unless `roleMembersReadable`); events need
 * view-events (403 by default); `DELETE /users/{id}` removes the user;
 * identity providers are read from `identityProviders`.
 */
import { KeycloakAdminService } from '../../src/identity/keycloak-admin.service.js';

export const FAKE_KEYCLOAK_URL = 'http://keycloak.test';

export interface FakeUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  createdTimestamp: number;
  requiredActions: string[];
  attributes: Record<string, string[]>;
  roles: Set<string>;
  idp?: string;
  /** Set on the service-account user of a client. */
  serviceAccountClientId?: string;
  /** Epoch ms of the latest LOGIN event. */
  lastLogin?: number;
}

export interface FakeKeycloakCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

const ROLES = ['partner_admin', 'alliance_admin', 'default-roles-oecp'];
const roleId = (name: string) => `role-${name}`;

export class FakeKeycloak {
  readonly users = new Map<string, FakeUser>();
  readonly calls: FakeKeycloakCall[] = [];
  readonly loggedOut: string[] = [];
  readonly deleted: string[] = [];
  readonly actionEmails: { id: string; actions: string[] }[] = [];
  /** Grant `view-events` to the service account. */
  eventsReadable = false;
  /** Grant `view-realm` (`GET /roles/{name}/users`) to the service account. */
  roleMembersReadable = false;
  /** Identity providers of the realm (`GET /identity-provider/instances[/{alias}]`). */
  readonly identityProviders = new Map<string, { alias: string; enabled: boolean }>();
  /** Answer every Admin API call with this status (Keycloak down). */
  failWith: number | undefined;
  private seq = 0;

  addUser(patch: Partial<FakeUser> & { id: string }): FakeUser {
    const user: FakeUser = {
      username: patch.email ?? patch.id,
      enabled: true,
      emailVerified: true,
      createdTimestamp: Date.UTC(2026, 9, 1),
      requiredActions: [],
      attributes: {},
      roles: new Set(['default-roles-oecp']),
      ...patch,
    };
    this.users.set(user.id, user);
    return user;
  }

  /** A `KeycloakAdminService` talking to this fake. */
  service(): KeycloakAdminService {
    return new KeycloakAdminService({
      baseUrl: FAKE_KEYCLOAK_URL,
      realm: 'oecp',
      clientId: 'oecp-backend',
      clientSecret: () => 'secret',
      fetch: this.fetch,
      timeoutMs: 2_000,
    });
  }

  callsTo(method: string, pathPattern: RegExp): FakeKeycloakCall[] {
    return this.calls.filter((c) => c.method === method && pathPattern.test(c.path));
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === '/realms/oecp/protocol/openid-connect/token') {
      return json({ access_token: 'fake-token', expires_in: 300 });
    }
    const prefix = '/admin/realms/oecp';
    if (!url.pathname.startsWith(prefix)) return empty(404);
    const path = url.pathname.slice(prefix.length);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    this.calls.push({ method, path, query: url.searchParams, body });
    if (this.failWith) return json({ error: 'unavailable' }, this.failWith);
    return this.route(method, path, url.searchParams, body);
  }) as typeof fetch;

  private route(method: string, path: string, query: URLSearchParams, body: unknown): Response {
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'users' && parts.length === 1) {
      if (method === 'GET') return json(this.search(query));
      if (method === 'POST') {
        const rep = body as { email: string; requiredActions?: string[] };
        const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
        this.addUser({ id, email: rep.email, requiredActions: rep.requiredActions ?? [] });
        return empty(201, { location: `${FAKE_KEYCLOAK_URL}/admin/realms/oecp/users/${id}` });
      }
    }
    if (parts[0] === 'events' && method === 'GET') {
      if (!this.eventsReadable) return json({ error: 'HTTP 403 Forbidden' }, 403);
      const user = this.users.get(query.get('user') ?? '');
      return json(
        user?.lastLogin ? [{ time: user.lastLogin, type: 'LOGIN', userId: user.id }] : [],
      );
    }
    if (parts[0] === 'roles' && parts[2] === 'users') {
      if (!this.roleMembersReadable) return json({ error: 'HTTP 403 Forbidden' }, 403);
      const first = Number(query.get('first') ?? 0);
      const max = Number(query.get('max') ?? 100);
      return json(
        [...this.users.values()]
          .filter((u) => u.roles.has(parts[1] ?? ''))
          .slice(first, first + max)
          .map(representation),
      );
    }
    if (parts[0] === 'identity-provider' && parts[1] === 'instances' && method === 'GET') {
      if (!parts[2]) return json([...this.identityProviders.values()]);
      const idp = this.identityProviders.get(parts[2]);
      return idp ? json(idp) : json({ error: 'Could not find identity provider' }, 404);
    }
    if (parts[0] !== 'users' || !parts[1]) return empty(404);
    const user = this.users.get(parts[1]);
    if (!user) return json({ error: 'User not found' }, 404);
    const rest = parts.slice(2).join('/');
    if (rest === '' && method === 'GET') return json(representation(user));
    if (rest === '' && method === 'DELETE') {
      this.users.delete(user.id);
      this.deleted.push(user.id);
      return empty();
    }
    if (rest === '' && method === 'PUT') {
      const rep = body as { attributes?: Record<string, string[]> };
      user.attributes = { ...(rep.attributes ?? {}) };
      return empty();
    }
    if (rest === 'role-mappings/realm' && method === 'GET') {
      return json([...user.roles].map((name) => ({ id: roleId(name), name })));
    }
    if (rest === 'role-mappings/realm/available' && method === 'GET') {
      return json(
        ROLES.filter((r) => !user.roles.has(r)).map((name) => ({ id: roleId(name), name })),
      );
    }
    if (rest === 'role-mappings/realm' && (method === 'POST' || method === 'DELETE')) {
      for (const role of body as { name: string }[]) {
        if (method === 'POST') user.roles.add(role.name);
        else user.roles.delete(role.name);
      }
      return empty();
    }
    if (rest === 'federated-identity' && method === 'GET') {
      return json(
        user.idp
          ? [{ identityProvider: user.idp, userId: `${user.idp}-id`, userName: user.username }]
          : [],
      );
    }
    if (rest === 'logout' && method === 'POST') {
      this.loggedOut.push(user.id);
      return empty();
    }
    if (rest === 'execute-actions-email' && method === 'PUT') {
      this.actionEmails.push({ id: user.id, actions: body as string[] });
      return empty();
    }
    return empty(404);
  }

  private search(query: URLSearchParams): unknown[] {
    let users = [...this.users.values()];
    const q = query.get('q');
    if (q) {
      const separator = q.indexOf(':');
      const name = q.slice(0, separator);
      const value = q.slice(separator + 1).toLowerCase();
      users = users.filter((u) =>
        (u.attributes[name] ?? []).some((v) => v.toLowerCase() === value),
      );
    }
    const email = query.get('email');
    if (email) users = users.filter((u) => u.email?.toLowerCase() === email.toLowerCase());
    const first = Number(query.get('first') ?? 0);
    const max = Number(query.get('max') ?? 100);
    return users.slice(first, first + max).map(representation);
  }
}

function representation(user: FakeUser) {
  const { roles: _roles, idp: _idp, lastLogin: _lastLogin, ...rep } = user;
  return rep;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const empty = (status = 204, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });
