// SPDX-License-Identifier: EUPL-1.2
import { createHash, randomBytes } from 'node:crypto';
import { isIdpAlias } from '@oecp/schemas';

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
 * For a brokered organization the fragment also names its Keycloak IdP alias
 * (`#token=<t>&idp=<alias>`), which the accept page passes as `kc_idp_hint`
 * because partner IdPs are hidden on the Keycloak login page.
 */
export function buildInvitationLink(
  publicBaseUrl: string,
  token: string,
  options: { idpAlias?: string | null; locale?: string } = {},
): string {
  const fragment = new URLSearchParams({ token });
  // Only well-formed aliases (IDP_ALIAS_PATTERN, not `local`) become a hint.
  if (isIdpAlias(options.idpAlias)) fragment.set('idp', options.idpAlias);
  return `${publicBaseUrl.replace(/\/+$/, '')}/${options.locale ?? 'en'}/admin/accept#${fragment}`;
}
