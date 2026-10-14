// SPDX-License-Identifier: EUPL-1.2
/** Invitation state machine and acceptance checks (spec §2.1 step 4); pure functions. */
import type { AdminRole, ErrorCode, InvitationStatus } from '@oecp/schemas';
import { LOCAL_IDP } from '../auth/claims.js';

export interface InvitationState {
  email: string;
  role: AdminRole;
  organization_id: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

export interface InvitationOrganization {
  id: string;
  keycloak_idp_alias: string | null;
  schac_home_organization: string | null;
  deleted_at: Date | null;
}

/** The signed-in user as asserted by the (possibly role-less) access token. */
export interface AcceptingIdentity {
  sub: string;
  email: string | undefined;
  /** `local` when the token has no `idp` claim. */
  idp: string;
  roles: readonly AdminRole[];
  orgId: string | undefined;
}

export type AcceptanceFailure =
  | 'not_found'
  | 'revoked'
  | 'accepted'
  | 'expired'
  | 'organization_unavailable'
  | 'email_mismatch'
  | 'idp_mismatch'
  | 'schac_mismatch'
  | 'organization_conflict';

export const ACCEPTANCE_FAILURES: Record<
  AcceptanceFailure,
  { status: number; code: ErrorCode; detail: string }
> = {
  not_found: { status: 404, code: 'oecp.invitation.invalid', detail: 'Unknown invitation token' },
  revoked: { status: 409, code: 'oecp.invitation.invalid', detail: 'The invitation was revoked' },
  accepted: {
    status: 409,
    code: 'oecp.invitation.invalid',
    detail: 'The invitation was already accepted',
  },
  expired: { status: 410, code: 'oecp.invitation.expired', detail: 'The invitation has expired' },
  organization_unavailable: {
    status: 409,
    code: 'oecp.invitation.invalid',
    detail: 'The invited organization no longer exists',
  },
  email_mismatch: {
    status: 403,
    code: 'oecp.invitation.mismatch',
    detail: 'The e-mail address of the signed-in account is not the invited address',
  },
  idp_mismatch: {
    status: 403,
    code: 'oecp.invitation.mismatch',
    detail: "The account did not sign in through the organization's identity provider",
  },
  schac_mismatch: {
    status: 403,
    code: 'oecp.invitation.mismatch',
    detail: 'The identity provider did not assert the home organization of the invitation',
  },
  organization_conflict: {
    status: 409,
    code: 'oecp.invitation.mismatch',
    detail: 'The account already administers another organization',
  },
};

export function invitationStatus(
  invitation: Pick<InvitationState, 'expires_at' | 'accepted_at' | 'revoked_at'>,
  now: Date,
): InvitationStatus {
  if (invitation.accepted_at) return 'accepted';
  if (invitation.revoked_at) return 'revoked';
  if (invitation.expires_at.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/**
 * Checks everything that does not need the identity service: token state,
 * organization, `email` claim (case-insensitive) and `idp` claim (organization
 * alias, or `local` when the organization has none). Returns the first failure.
 */
export function checkAcceptance(
  invitation: InvitationState | undefined,
  organization: InvitationOrganization | undefined,
  identity: AcceptingIdentity,
  now: Date,
): AcceptanceFailure | undefined {
  if (!invitation) return 'not_found';
  const status = invitationStatus(invitation, now);
  if (status !== 'pending') return status;
  if (!organization || organization.deleted_at || organization.id !== invitation.organization_id) {
    return 'organization_unavailable';
  }
  if (!identity.email || identity.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return 'email_mismatch';
  }
  if (identity.idp !== (organization.keycloak_idp_alias ?? LOCAL_IDP)) return 'idp_mismatch';
  // An administrator has exactly one organization (claim org_id); accepting an
  // invitation for another one would silently move them.
  if (identity.roles.length > 0 && identity.orgId && identity.orgId !== organization.id) {
    return 'organization_conflict';
  }
  return undefined;
}

/** Whether the schacHomeOrganization check applies: brokered organizations with a value. */
export function requiresSchacCheck(organization: InvitationOrganization): boolean {
  return organization.keycloak_idp_alias !== null && organization.schac_home_organization !== null;
}

/** Case-insensitive match of any asserted value (domains are case-insensitive). */
export function schacMatches(expected: string, asserted: readonly string[]): boolean {
  const target = expected.trim().toLowerCase();
  return asserted.some((value) => value.trim().toLowerCase() === target);
}
