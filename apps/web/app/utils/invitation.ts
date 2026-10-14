// SPDX-License-Identifier: EUPL-1.2
// Invitation token hand-off for /{locale}/admin/accept (spec §2.1), and the
// identity-provider hint (`kc_idp_hint`) of brokered partner administrators.
import { IDP_ALIAS_PATTERN as SHARED_IDP_ALIAS_PATTERN } from '@oecp/schemas';

/** Same shape as `invitationToken` in @oecp/schemas: 256 bits, base64url, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Keycloak IdP alias of a brokered organization, as the API accepts it
 * (`IDP_ALIAS_PATTERN` of @oecp/schemas, admin-organizations.ts); the literal is
 * the same rule, used only if the shared export is missing.
 */
export const IDP_ALIAS_PATTERN: RegExp = SHARED_IDP_ALIAS_PATTERN ?? /^[a-z0-9][a-z0-9._-]{1,99}$/;
/** `local` is the `idp` claim of accounts without an identity provider (spec §4). */
export const LOCAL_IDP = 'local';

export function isIdpAlias(value: unknown): value is string {
  return (
    typeof value === 'string' && IDP_ALIAS_PATTERN.test(value) && value.toLowerCase() !== LOCAL_IDP
  );
}

/**
 * sessionStorage key holding the token while the OIDC login round-trip is in
 * progress. The token arrives in the URL fragment (`#token=…`) so that it never
 * reaches server logs, but the fragment does not survive the redirect to
 * Keycloak and back; the page therefore parks it here right before calling
 * `login()` and removes it as soon as the page reads it again. sessionStorage is
 * per tab and never sent to any server (unlike a cookie).
 */
export const PENDING_INVITATION_KEY = 'oecp.admin.pendingInvitation';
/** The IdP alias that came with the parked token (`#token=…&idp=…`), if any. */
export const PENDING_INVITATION_IDP_KEY = 'oecp.admin.pendingInvitationIdp';

/** An invitation link fragment: the token and, for brokered organizations, the IdP alias. */
export interface InvitationFragment {
  token: string;
  idp: string | null;
}

/**
 * Reads `token` and the optional `idp` from a URL fragment such as
 * `#token=abc&idp=uibk`. Returns null when the fragment carries no well-formed
 * token; a malformed `idp` is dropped (the token still works with the chooser).
 */
export function extractInvitation(hash: string): InvitationFragment | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment) return null;
  const params = new URLSearchParams(fragment);
  const token = params.get('token');
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const idp = params.get('idp');
  return { token, idp: isIdpAlias(idp) ? idp : null };
}

/** The token of an invitation fragment (see extractInvitation). */
export function extractInvitationToken(hash: string): string | null {
  return extractInvitation(hash)?.token ?? null;
}

/** Stores the invitation for the login round-trip (see PENDING_INVITATION_KEY). */
export function parkInvitation(storage: Storage, invitation: InvitationFragment): void {
  storage.setItem(PENDING_INVITATION_KEY, invitation.token);
  if (invitation.idp) storage.setItem(PENDING_INVITATION_IDP_KEY, invitation.idp);
  else storage.removeItem(PENDING_INVITATION_IDP_KEY);
}

/** Reads and immediately removes the parked invitation, if any. */
export function takeParkedInvitation(storage: Storage): InvitationFragment | null {
  const token = storage.getItem(PENDING_INVITATION_KEY);
  const idp = storage.getItem(PENDING_INVITATION_IDP_KEY);
  storage.removeItem(PENDING_INVITATION_KEY);
  storage.removeItem(PENDING_INVITATION_IDP_KEY);
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  return { token, idp: isIdpAlias(idp) ? idp : null };
}

/** Stores the token alone for the login round-trip. */
export function parkInvitationToken(storage: Storage, token: string): void {
  parkInvitation(storage, { token, idp: null });
}

/** Reads and immediately removes the parked token, if any. */
export function takeParkedInvitationToken(storage: Storage): string | null {
  return takeParkedInvitation(storage)?.token ?? null;
}

/**
 * localStorage key of the IdP alias last chosen in "Sign in through your
 * university": only a convenience that preselects the chooser on this browser.
 * It holds a public organization slug, never a token or personal data.
 */
export const LAST_IDP_KEY = 'oecp.admin.lastIdp';

/** The remembered alias, or null (storage blocked, empty or malformed). */
export function recallIdpAlias(): string | null {
  try {
    const value = window.localStorage.getItem(LAST_IDP_KEY);
    return isIdpAlias(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the alias; failures (private mode, blocked storage) are ignored. */
export function rememberIdpAlias(alias: string): void {
  if (!isIdpAlias(alias)) return;
  try {
    window.localStorage.setItem(LAST_IDP_KEY, alias);
  } catch {
    // Only a convenience.
  }
}
