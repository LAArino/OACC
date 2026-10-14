// SPDX-License-Identifier: EUPL-1.2
import { type JWTVerifyGetKey, errors as joseErrors, jwtVerify } from 'jose';
import { AdminAuthError } from './admin-auth.error.js';
import {
  ADMIN_AUDIENCE,
  ADMIN_AUTHORIZED_PARTY,
  type AdminClaims,
  adminClaims,
  CLOCK_TOLERANCE_SECONDS,
  REQUIRED_ACR,
} from './claims.js';

export interface AdminTokenVerifierOptions {
  /** Exact `iss`, e.g. `https://auth.example.org/realms/oecp`. */
  issuer: string;
  /** Realm JWKS; `createRemoteJWKSet` in production (cached), a local set in tests. */
  getKey: JWTVerifyGetKey;
}

/** Verifies signature and the static part of the claims contract; no I/O besides JWKS. */
export class AdminTokenVerifier {
  constructor(private readonly options: AdminTokenVerifierOptions) {}

  async verify(token: string): Promise<AdminClaims> {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.options.getKey, {
        issuer: this.options.issuer,
        audience: ADMIN_AUDIENCE,
        algorithms: ['RS256', 'ES256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['exp', 'iat', 'sub', 'azp', 'acr'],
      }));
    } catch (error) {
      if (error instanceof joseErrors.JOSEError)
        throw new AdminAuthError('oecp.auth.invalid_token', 401);
      throw error;
    }

    const parsed = adminClaims.safeParse(payload);
    if (!parsed.success) throw new AdminAuthError('oecp.auth.invalid_token', 401);
    const claims = parsed.data;
    if (claims.azp !== ADMIN_AUTHORIZED_PARTY)
      throw new AdminAuthError('oecp.auth.invalid_token', 401);
    if (claims.acr !== REQUIRED_ACR) throw new AdminAuthError('oecp.auth.insufficient_acr', 401);
    return claims;
  }
}
