// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import {
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type JWTPayload, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';
import type { AdminPrincipal } from '../../src/admin/auth/claims.js';
import { AllowRoleless } from '../../src/admin/auth/decorators.js';
import type { OrganizationDirectory } from '../../src/admin/auth/organization-directory.js';

const ISSUER = 'https://auth.example.test/realms/oecp';
const ORG_ID = '0b8f6c1e-6a3d-4c55-9a43-0f3d3c2b9a10';
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

const LOCAL_ORG_ID = '1c9f6c1e-6a3d-4c55-9a43-0f3d3c2b9a11';

const organizations: OrganizationDirectory = {
  findActive: async (id) =>
    ({
      [ORG_ID]: { id: ORG_ID, keycloak_idp_alias: 'urv' },
      [LOCAL_ORG_ID]: { id: LOCAL_ORG_ID, keycloak_idp_alias: null },
    })[id],
};

class Handlers {
  guarded(): void {}
  @AllowRoleless()
  acceptInvitation(): void {}
}

interface FakeHttp {
  request: { headers: Record<string, string>; admin?: AdminPrincipal };
  responseHeaders: Record<string, string>;
  context: ExecutionContext;
}

function httpContext(token: string | undefined, handler: keyof Handlers = 'guarded'): FakeHttp {
  const request: FakeHttp['request'] = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const responseHeaders: Record<string, string> = {};
  const response = { setHeader: (name: string, value: string) => (responseHeaders[name] = value) };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
  } as unknown as ExecutionContext;
  return { request, responseHeaders, context };
}

describe('AdminJwtGuard', () => {
  let privateKey: PrivateKey;
  let otherKey: PrivateKey;
  let guard: AdminJwtGuard;

  const sign = (claims: JWTPayload, key: PrivateKey = privateKey, issuer = ISSUER) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuer(issuer)
      .setSubject('5f0c2a47-1b7e-4d1e-9b0a-6f6e2b1d9c3a')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);

  const valid: JWTPayload = {
    aud: ['oecp-api', 'account'],
    azp: 'oecp-admin',
    acr: 'mfa',
    roles: ['partner_admin', 'offline_access'],
    org_id: ORG_ID,
    idp: 'urv',
    email: 'admin@urv.example',
  };

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair('ES256')).privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };
    const verifier = new AdminTokenVerifier({
      issuer: ISSUER,
      getKey: createLocalJWKSet({ keys: [jwk] }),
    });
    guard = new AdminJwtGuard(verifier, organizations, new Reflector());
  });

  async function rejection(promise: Promise<unknown>): Promise<HttpException> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }

  const codeOf = (error: HttpException) =>
    (error.getResponse() as { errors: { code: string }[] }).errors[0]?.code;

  it('accepts a token that meets the claims contract and attaches the principal', async () => {
    const http = httpContext(await sign(valid));
    await expect(guard.canActivate(http.context)).resolves.toBe(true);
    expect(http.request.admin).toMatchObject({
      roles: ['partner_admin'],
      orgId: ORG_ID,
      idp: 'urv',
    });
  });

  it('accepts idp "local" for an organization without an IdP alias', async () => {
    const http = httpContext(await sign({ ...valid, org_id: LOCAL_ORG_ID, idp: 'local' }));
    await expect(guard.canActivate(http.context)).resolves.toBe(true);
  });

  it('rejects a missing bearer token with 401', async () => {
    const http = httpContext(undefined);
    const error = await rejection(guard.canActivate(http.context));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(http.responseHeaders['WWW-Authenticate']).toBe('Bearer');
  });

  it.each([
    ['a foreign signing key', async () => sign(valid, otherKey)],
    [
      'a wrong issuer',
      async () => sign(valid, privateKey, 'https://evil.example.test/realms/oecp'),
    ],
    ['an audience without oecp-api', async () => sign({ ...valid, aud: 'account' })],
    ['a different azp', async () => sign({ ...valid, azp: 'oecp-portal' })],
  ])('rejects %s with 401 invalid_token', async (_label, makeToken) => {
    const error = await rejection(guard.canActivate(httpContext(await makeToken()).context));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(codeOf(error)).toBe('oecp.auth.invalid_token');
  });

  it('rejects acr other than mfa with a step-up challenge', async () => {
    const http = httpContext(await sign({ ...valid, acr: '1' }));
    const error = await rejection(guard.canActivate(http.context));
    expect(codeOf(error)).toBe('oecp.auth.insufficient_acr');
    expect(http.responseHeaders['WWW-Authenticate']).toContain('insufficient_user_authentication');
  });

  it('rejects tokens without OECP roles with 403', async () => {
    const error = await rejection(
      guard.canActivate(httpContext(await sign({ ...valid, roles: ['offline_access'] })).context),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(codeOf(error)).toBe('oecp.auth.no_role');
  });

  it('allows role-less tokens on @AllowRoleless() handlers', async () => {
    const token = await sign({ ...valid, roles: [], org_id: undefined });
    await expect(guard.canActivate(httpContext(token, 'acceptInvitation').context)).resolves.toBe(
      true,
    );
  });

  it('rejects unknown organizations and IdP mismatches with 403', async () => {
    const unknown = await sign({ ...valid, org_id: '2d9f6c1e-6a3d-4c55-9a43-0f3d3c2b9a12' });
    expect(codeOf(await rejection(guard.canActivate(httpContext(unknown).context)))).toBe(
      'oecp.auth.unknown_organization',
    );
    const mismatch = await sign({ ...valid, idp: 'uibk' });
    expect(codeOf(await rejection(guard.canActivate(httpContext(mismatch).context)))).toBe(
      'oecp.auth.idp_mismatch',
    );
  });
});
