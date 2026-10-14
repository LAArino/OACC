// SPDX-License-Identifier: EUPL-1.2
/**
 * Keycloak Admin REST API double for identity providers
 * (`GET`/`PUT /identity-provider/instances/{alias}`), as a `fetch`. Like
 * Keycloak 26, a PUT replaces the whole representation (config map included).
 */
import {
  KeycloakAdminService,
  type KeycloakIdentityProviderRepresentation,
} from '../../src/identity/keycloak-admin.service.js';
import { FAKE_KEYCLOAK_URL, type FakeKeycloakCall } from './fake-keycloak.js';

export class FakeKeycloakIdps {
  readonly idps = new Map<string, KeycloakIdentityProviderRepresentation>();
  readonly calls: FakeKeycloakCall[] = [];
  /** Answer every call for these aliases with this status. */
  readonly failFor = new Map<string, number>();

  add(rep: KeycloakIdentityProviderRepresentation): void {
    this.idps.set(rep.alias, structuredClone(rep));
  }

  puts(): FakeKeycloakCall[] {
    return this.calls.filter((c) => c.method === 'PUT');
  }

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

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === '/realms/oecp/protocol/openid-connect/token') {
      return Response.json({ access_token: 'fake-token', expires_in: 300 });
    }
    const prefix = '/admin/realms/oecp/identity-provider/instances/';
    if (!url.pathname.startsWith(prefix)) return new Response(null, { status: 404 });
    const alias = decodeURIComponent(url.pathname.slice(prefix.length));
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    this.calls.push({ method, path: url.pathname, query: url.searchParams, body });
    const fail = this.failFor.get(alias);
    if (fail) return Response.json({ error: 'failure' }, { status: fail });
    const idp = this.idps.get(alias);
    if (!idp) return Response.json({ error: 'Could not find identity provider' }, { status: 404 });
    if (method === 'GET') return Response.json(idp);
    if (method === 'PUT') {
      this.idps.set(alias, structuredClone(body as KeycloakIdentityProviderRepresentation));
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;
}
