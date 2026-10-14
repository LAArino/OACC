// SPDX-License-Identifier: EUPL-1.2
/** ES256 test key pair and token factory for the admin claims contract (spec §4). */
import { type JWTPayload, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';

export const TEST_ISSUER = 'https://auth.example.test/realms/oecp';

export interface TestTokens {
  verifier: AdminTokenVerifier;
  /** Signs a token with `sub`, `iat`, `exp` (5 min) and the given claims. */
  sign(claims: JWTPayload, sub?: string): Promise<string>;
}

export async function createTestTokens(): Promise<TestTokens> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };
  return {
    verifier: new AdminTokenVerifier({
      issuer: TEST_ISSUER,
      getKey: createLocalJWKSet({ keys: [jwk] }),
    }),
    sign: (claims, sub = '5f0c2a47-1b7e-4d1e-9b0a-6f6e2b1d9c3a') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'test' })
        .setIssuer(TEST_ISSUER)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey),
  };
}

/** Claims every admin token carries (aud, azp, acr). */
export const BASE_CLAIMS: JWTPayload = {
  aud: ['oecp-api', 'account'],
  azp: 'oecp-admin',
  acr: 'mfa',
};
