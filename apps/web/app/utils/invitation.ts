// SPDX-License-Identifier: EUPL-1.2
// Invitation token hand-off for /{locale}/admin/accept (spec §2.1).

/** Same shape as `invitationToken` in @oecp/schemas: 256 bits, base64url, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * sessionStorage key holding the token while the OIDC login round-trip is in
 * progress. The token arrives in the URL fragment (`#token=…`) so that it never
 * reaches server logs, but the fragment does not survive the redirect to
 * Keycloak and back; the page therefore parks it here right before calling
 * `login()` and removes it as soon as the page reads it again. sessionStorage is
 * per tab and never sent to any server (unlike a cookie).
 */
export const PENDING_INVITATION_KEY = 'oecp.admin.pendingInvitation';

/**
 * Reads `token` from a URL fragment such as `#token=abc`. Returns null when the
 * fragment carries no token or the value is not a well-formed invitation token.
 */
export function extractInvitationToken(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment) return null;
  const token = new URLSearchParams(fragment).get('token');
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

/** Stores the token for the login round-trip (see PENDING_INVITATION_KEY). */
export function parkInvitationToken(storage: Storage, token: string): void {
  storage.setItem(PENDING_INVITATION_KEY, token);
}

/** Reads and immediately removes the parked token, if any. */
export function takeParkedInvitationToken(storage: Storage): string | null {
  const token = storage.getItem(PENDING_INVITATION_KEY);
  storage.removeItem(PENDING_INVITATION_KEY);
  return token && TOKEN_PATTERN.test(token) ? token : null;
}
