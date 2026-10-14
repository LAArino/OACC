// SPDX-License-Identifier: EUPL-1.2
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readSecretFile } from '../../src/identity/identity.module.js';
import { KeycloakAdminError } from '../../src/identity/keycloak-admin.error.js';
import { KeycloakAdminService } from '../../src/identity/keycloak-admin.service.js';

const BASE = 'http://keycloak:8080';
const ADMIN = `${BASE}/admin/realms/oecp`;
const TOKEN_URL = `${BASE}/realms/oecp/protocol/openid-connect/token`;
const USER = '5f0c2a47-1b7e-4d1e-9b0a-6f6e2b1d9c3a';

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | undefined;
}

type Route = (call: Call) => Response | Promise<Response> | undefined;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const empty = (status = 204, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

/** fetch double: token endpoint built in, then `routes` in order; records every call. */
function fakeFetch(...routes: Route[]) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    };
    calls.push(call);
    if (call.url.href === TOKEN_URL) {
      tokens += 1;
      return json({ access_token: `token-${tokens}`, expires_in: 300 });
    }
    for (const route of routes) {
      const response = await route(call);
      if (response) return response;
    }
    return empty(404);
  });
  const adminCalls = () => calls.filter((c) => c.url.href !== TOKEN_URL);
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, adminCalls };
}

const on =
  (method: string, path: string, respond: (call: Call) => Response): Route =>
  (call) =>
    call.method === method && call.url.pathname === new URL(`${ADMIN}${path}`).pathname
      ? respond(call)
      : undefined;

function service(fetch: typeof globalThis.fetch, extra: { now?: () => number } = {}) {
  return new KeycloakAdminService({
    baseUrl: BASE,
    realm: 'oecp',
    clientId: 'oecp-backend',
    clientSecret: () => 's3cret',
    fetch,
    timeoutMs: 1_000,
    ...extra,
  });
}

describe('KeycloakAdminService', () => {
  it('obtains a client-credentials token once and reuses it until it nears expiry', async () => {
    let now = 0;
    const f = fakeFetch(on('POST', `/users/${USER}/logout`, () => empty()));
    const kc = service(f.fetch, { now: () => now });
    await kc.logoutUser(USER);
    await kc.logoutUser(USER);
    const tokenCalls = f.calls.filter((c) => c.url.href === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(tokenCalls[0]!.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'oecp-backend',
      client_secret: 's3cret',
    });
    expect(f.adminCalls()[0]!.headers['authorization']).toBe('Bearer token-1');

    now = 271_000; // 300 s lifetime minus the 30 s renewal margin has passed
    await kc.logoutUser(USER);
    expect(f.adminCalls()[2]!.headers['authorization']).toBe('Bearer token-2');
  });

  it('renews the token once when the Admin API answers 401', async () => {
    let first = true;
    const f = fakeFetch(
      on('POST', `/users/${USER}/logout`, () => {
        const status = first ? 401 : 204;
        first = false;
        return empty(status);
      }),
    );
    await service(f.fetch).logoutUser(USER);
    expect(f.adminCalls().map((c) => c.headers['authorization'])).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('finds a user by exact e-mail', async () => {
    const f = fakeFetch(
      on('GET', '/users', () => json([{ id: USER, email: 'admin@aurora.example' }])),
    );
    const user = await service(f.fetch).findUserByEmail('Admin@Aurora.example');
    expect(user?.id).toBe(USER);
    const query = f.adminCalls()[0]!.url.searchParams;
    expect(query.get('email')).toBe('Admin@Aurora.example');
    expect(query.get('exact')).toBe('true');
  });

  it('returns undefined when no user has the e-mail', async () => {
    const f = fakeFetch(on('GET', '/users', () => json([])));
    await expect(service(f.fetch).findUserByEmail('x@example.org')).resolves.toBeUndefined();
  });

  it('creates a local user with required actions and returns the id from Location', async () => {
    const f = fakeFetch(
      on('POST', '/users', () => empty(201, { location: `${ADMIN}/users/${USER}` })),
    );
    const id = await service(f.fetch).createLocalUser({
      email: 'Admin@Aurora.example',
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    });
    expect(id).toBe(USER);
    expect(JSON.parse(f.adminCalls()[0]!.body!)).toEqual({
      username: 'admin@aurora.example',
      email: 'admin@aurora.example',
      emailVerified: true,
      enabled: true,
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    });
  });

  it('maps a 409 on user creation to a 409 problem', async () => {
    const f = fakeFetch(on('POST', '/users', () => json({ errorMessage: 'exists' }, 409)));
    const error = await service(f.fetch)
      .createLocalUser({ email: 'a@example.org', requiredActions: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeycloakAdminError);
    expect((error as KeycloakAdminError).getStatus()).toBe(409);
    expect((error as KeycloakAdminError).code).toBe('oecp.identity.conflict');
  });

  it('sends the execute-actions e-mail for the admin SPA client', async () => {
    const f = fakeFetch(on('PUT', `/users/${USER}/execute-actions-email`, () => empty()));
    await service(f.fetch).sendExecuteActionsEmail(USER, ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'], {
      redirectUri: 'https://campus.example.org/en/admin/',
      lifespanSeconds: 86_400,
    });
    const call = f.adminCalls()[0]!;
    expect(Object.fromEntries(call.url.searchParams)).toEqual({
      client_id: 'oecp-admin',
      redirect_uri: 'https://campus.example.org/en/admin/',
      lifespan: '86400',
    });
    expect(JSON.parse(call.body!)).toEqual(['UPDATE_PASSWORD', 'CONFIGURE_TOTP']);
  });

  it('merges a single-valued attribute into the full user representation', async () => {
    const f = fakeFetch(
      on('GET', `/users/${USER}`, () =>
        json({
          id: USER,
          username: 'u',
          email: 'u@urv.cat',
          attributes: { schacHomeOrganization: ['urv.cat'] },
        }),
      ),
      on('PUT', `/users/${USER}`, () => empty()),
    );
    await service(f.fetch).setUserAttribute(USER, 'oecp_org_id', 'org-1');
    const put = f.adminCalls()[1]!;
    expect(JSON.parse(put.body!)).toEqual({
      id: USER,
      username: 'u',
      email: 'u@urv.cat',
      attributes: { schacHomeOrganization: ['urv.cat'], oecp_org_id: ['org-1'] },
    });
  });

  it('adds a realm role through the available role mappings, idempotently', async () => {
    let mapped: { id: string; name: string }[] = [];
    const f = fakeFetch(
      on('GET', `/users/${USER}/role-mappings/realm`, () => json(mapped)),
      on('GET', `/users/${USER}/role-mappings/realm/available`, () =>
        json([
          { id: 'r-1', name: 'partner_admin' },
          { id: 'r-2', name: 'alliance_admin' },
        ]),
      ),
      on('POST', `/users/${USER}/role-mappings/realm`, (call) => {
        mapped = JSON.parse(call.body!);
        return empty();
      }),
    );
    const kc = service(f.fetch);
    await kc.addRealmRole(USER, 'alliance_admin');
    expect(mapped).toEqual([{ id: 'r-2', name: 'alliance_admin' }]);
    await kc.addRealmRole(USER, 'alliance_admin');
    expect(f.adminCalls().filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('removes a realm role only when mapped', async () => {
    const f = fakeFetch(
      on('GET', `/users/${USER}/role-mappings/realm`, () =>
        json([{ id: 'r-1', name: 'partner_admin' }]),
      ),
      on('DELETE', `/users/${USER}/role-mappings/realm`, () => empty()),
    );
    const kc = service(f.fetch);
    await kc.removeRealmRole(USER, 'alliance_admin');
    expect(f.adminCalls().some((c) => c.method === 'DELETE')).toBe(false);
    await kc.removeRealmRole(USER, 'partner_admin');
    const del = f.adminCalls().find((c) => c.method === 'DELETE')!;
    expect(JSON.parse(del.body!)).toEqual([{ id: 'r-1', name: 'partner_admin' }]);
  });

  it('counts role members page by page', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` }));
    const f = fakeFetch(
      on('GET', '/roles/alliance_admin/users', (call) =>
        json(call.url.searchParams.get('first') === '0' ? page(100) : page(3)),
      ),
    );
    await expect(service(f.fetch).countUsersWithRole('alliance_admin')).resolves.toBe(103);
  });

  it('falls back to scanning role mappings without view-realm (403)', async () => {
    const f = fakeFetch(
      on('GET', '/roles/alliance_admin/users', () => empty(403)),
      on('GET', '/users', () => json([{ id: 'a' }, { id: 'b' }])),
      on('GET', '/users/a/role-mappings/realm', () =>
        json([{ id: 'r-2', name: 'alliance_admin' }]),
      ),
      on('GET', '/users/b/role-mappings/realm', () => json([])),
    );
    await expect(service(f.fetch).countUsersWithRole('alliance_admin')).resolves.toBe(1);
  });

  it('turns upstream errors into 502 problems without leaking the secret', async () => {
    const f = fakeFetch(on('POST', `/users/${USER}/logout`, () => empty(500)));
    const error = (await service(f.fetch)
      .logoutUser(USER)
      .catch((e: unknown) => e)) as KeycloakAdminError;
    expect(error).toBeInstanceOf(KeycloakAdminError);
    expect(error.getStatus()).toBe(502);
    expect(error.upstreamStatus).toBe(500);
    expect(JSON.stringify(error.getResponse())).not.toContain('s3cret');
  });

  it('fails with a 502 problem when the token request is rejected', async () => {
    const fetch = vi.fn(async () => json({ error: 'unauthorized_client' }, 401));
    const error = (await service(fetch as unknown as typeof globalThis.fetch)
      .logoutUser(USER)
      .catch((e: unknown) => e)) as KeycloakAdminError;
    expect(error.getStatus()).toBe(502);
    expect(error.operation).toBe('client-credentials token');
  });

  it('turns timeouts into 504 problems', async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const error = (await service(fetch as unknown as typeof globalThis.fetch)
      .logoutUser(USER)
      .catch((e: unknown) => e)) as KeycloakAdminError;
    expect(error.getStatus()).toBe(504);
    expect(error.timedOut).toBe(true);
  });

  it('passes an abort signal with every request', async () => {
    const f = fakeFetch(on('POST', `/users/${USER}/logout`, () => empty()));
    await service(f.fetch).logoutUser(USER);
    const init = (f.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('readSecretFile', () => {
  it('reads and trims a Docker secret', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oecp-secret-'));
    const file = join(dir, 'secret');
    writeFileSync(file, '  s3cret\n');
    expect(readSecretFile(file)).toBe('s3cret');
    writeFileSync(file, '\n');
    expect(() => readSecretFile(file)).toThrow(/empty/);
  });
});
