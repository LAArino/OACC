// SPDX-License-Identifier: EUPL-1.2
import { createHash, randomBytes } from 'node:crypto';

/** 256-bit tokens (spec §2.1). */
export const INVITATION_TOKEN_BYTES = 32;

export interface GeneratedInvitationToken {
  /** base64url without padding (43 characters); only ever sent to the invitee. */
  token: string;
  /** SHA-256 of the token, the only form stored (`admin_invitations.token_sha256`). */
  sha256: Buffer;
}

export function generateInvitationToken(): GeneratedInvitationToken {
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
  return { token, sha256: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Acceptance page link. The token travels in the URL fragment, which browsers
 * never send to servers, so it does not reach proxy or server logs (spec §2.1).
 */
export function buildInvitationLink(publicBaseUrl: string, token: string, locale = 'en'): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/${locale}/admin/accept#token=${token}`;
}
