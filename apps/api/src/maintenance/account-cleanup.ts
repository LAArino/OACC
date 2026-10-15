// SPDX-License-Identifier: EUPL-1.2
/**
 * Pure rules of the `account-cleanup` job (spec §2.2, §10 "Keycloak accounts 12
 * months after role removal"), unit-tested apart from Keycloak and the database.
 */

/** Everything known about one account whose OECP roles were removed. */
export interface AccountEvidence {
  /** Latest `admin.revoke` / `admin.dormant_revoke` audit row of the sub. */
  lastRemovalAt: Date;
  /** Latest acceptance of an invitation by the sub (`admin_invitations.accepted_at`). */
  lastGrantAt: Date | null;
  /** OECP realm roles the account holds now. */
  roles: readonly string[];
  /** Service-account user of a client (never deleted). */
  serviceAccount: boolean;
  /** The account still carries `oecp_org_id` (acceptance in progress, manual setup). */
  organizationAttribute: boolean;
  /** Keycloak `createdTimestamp`. */
  createdAt: Date | null;
  /** Latest admin API request (`admin_activity.last_seen_at`). */
  lastActivityAt: Date | null;
  /** Latest Keycloak `LOGIN` event, when readable. */
  lastLoginAt: Date | null;
  /** A pending invitation exists for the account's e-mail address. */
  pendingInvitation: boolean;
}

export type KeepReason =
  | 'has_role'
  | 'service_account'
  | 'organization_attribute'
  | 'granted_after_removal'
  | 'no_creation_date'
  | 'recent_creation'
  | 'recent_activity'
  | 'recent_login'
  | 'pending_invitation';

export type AccountDecision = { delete: true } | { delete: false; reason: KeepReason };

const after = (date: Date | null, cutoff: Date): boolean =>
  date !== null && !Number.isNaN(date.getTime()) && date.getTime() >= cutoff.getTime();

/**
 * Whether a Keycloak account may be deleted. `cutoff` is now minus
 * `OECP_ACCOUNT_DELETE_MONTHS`; the caller only asks for accounts whose last
 * role removal is before it. Kept, in this order: accounts holding an OECP role,
 * service accounts, accounts still carrying `oecp_org_id`, accounts granted a
 * role (invitation accepted) after the removal, accounts without a creation date
 * or created on or after the cutoff, and accounts with any sign of life on or
 * after the cutoff (admin API request, Keycloak login) or a pending invitation.
 */
export function decideAccountDeletion(evidence: AccountEvidence, cutoff: Date): AccountDecision {
  const keep = (reason: KeepReason): AccountDecision => ({ delete: false, reason });
  if (evidence.roles.length > 0) return keep('has_role');
  if (evidence.serviceAccount) return keep('service_account');
  if (evidence.organizationAttribute) return keep('organization_attribute');
  if (
    evidence.lastGrantAt !== null &&
    evidence.lastGrantAt.getTime() > evidence.lastRemovalAt.getTime()
  ) {
    return keep('granted_after_removal');
  }
  if (evidence.createdAt === null || Number.isNaN(evidence.createdAt.getTime())) {
    return keep('no_creation_date');
  }
  if (after(evidence.createdAt, cutoff)) return keep('recent_creation');
  if (after(evidence.lastActivityAt, cutoff)) return keep('recent_activity');
  if (after(evidence.lastLoginAt, cutoff)) return keep('recent_login');
  if (evidence.pendingInvitation) return keep('pending_invitation');
  return { delete: true };
}

/** Whether a Keycloak user is the service account of a client. */
export function isServiceAccount(user: {
  username?: string | undefined;
  serviceAccountClientId?: string | undefined;
}): boolean {
  return (
    (typeof user.serviceAccountClientId === 'string' && user.serviceAccountClientId !== '') ||
    (user.username ?? '').startsWith('service-account-')
  );
}
