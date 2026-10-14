// SPDX-License-Identifier: EUPL-1.2
/** Pure dormancy rules (spec §2.2), unit-tested apart from Keycloak and the database. */
import type { AdminRole } from '@oecp/schemas';

const DAY_MS = 86_400_000;

/** Evidence of an administrator's activity; any member may be unknown (null). */
export interface ActivityEvidence {
  /** Latest authenticated admin API request (`admin_activity.last_seen_at`). */
  lastSeenAt: Date | null;
  /** Latest Keycloak `LOGIN` event (null when absent, expired or unreadable). */
  lastLoginAt: Date | null;
  /** Keycloak `createdTimestamp`. */
  createdAt: Date | null;
  /**
   * Start of activity tracking (migration 0006). Activity before it is invisible:
   * Keycloak keeps login events 90 days only, so inactivity is never counted
   * from an earlier instant.
   */
  trackingSince: Date | null;
}

export type ActivityBasis =
  'api_activity' | 'keycloak_login' | 'account_created' | 'tracking_start';

export type DormancyDecision =
  | {
      dormant: false;
      reason: 'active' | 'no_evidence';
      lastActivityAt: Date | null;
      basis: ActivityBasis | null;
    }
  | { dormant: true; lastActivityAt: Date; basis: ActivityBasis; inactiveDays: number };

/**
 * Last activity = the latest of the API activity, the last Keycloak login, the
 * account creation and the start of tracking. Dormant when that is more than
 * `thresholdDays` days ago, so an account created less than `thresholdDays` ago
 * is never dormant. Without a creation date nor any other evidence nothing is
 * decided (kept).
 */
export function decideDormancy(
  evidence: ActivityEvidence,
  now: Date,
  thresholdDays: number,
): DormancyDecision {
  const candidates: [ActivityBasis, Date | null][] = [
    ['api_activity', evidence.lastSeenAt],
    ['keycloak_login', evidence.lastLoginAt],
    ['account_created', evidence.createdAt],
    ['tracking_start', evidence.trackingSince],
  ];
  let latest: { basis: ActivityBasis; at: Date } | undefined;
  for (const [basis, at] of candidates) {
    if (at && !Number.isNaN(at.getTime()) && (!latest || at.getTime() > latest.at.getTime())) {
      latest = { basis, at };
    }
  }
  if (!latest || !evidence.createdAt) {
    return {
      dormant: false,
      reason: 'no_evidence',
      lastActivityAt: latest?.at ?? null,
      basis: latest?.basis ?? null,
    };
  }
  const idleMs = now.getTime() - latest.at.getTime();
  if (idleMs <= thresholdDays * DAY_MS) {
    return { dormant: false, reason: 'active', lastActivityAt: latest.at, basis: latest.basis };
  }
  return {
    dormant: true,
    lastActivityAt: latest.at,
    basis: latest.basis,
    inactiveDays: Math.floor(idleMs / DAY_MS),
  };
}

export interface AdminAccount {
  sub: string;
  roles: AdminRole[];
  decision: DormancyDecision;
}

export interface RevocationPlan {
  /** Dormant accounts to revoke, longest inactive first. */
  revoke: AdminAccount[];
  /** Dormant alliance administrators kept so that at least one alliance_admin remains. */
  keptLastAllianceAdmin: AdminAccount[];
}

/**
 * Which dormant accounts to revoke. The longest inactive go first; an account
 * holding `alliance_admin` is revoked only while another alliance_admin would
 * remain (spec §2.2: never the last alliance_admin), so the most recently active
 * dormant alliance administrator is kept when every holder is dormant.
 */
export function planRevocations(accounts: readonly AdminAccount[]): RevocationPlan {
  let allianceHolders = accounts.filter((a) => a.roles.includes('alliance_admin')).length;
  const dormant = accounts
    .filter((a) => a.decision.dormant)
    .sort(
      (a, b) =>
        (a.decision.lastActivityAt?.getTime() ?? 0) - (b.decision.lastActivityAt?.getTime() ?? 0) ||
        a.sub.localeCompare(b.sub),
    );
  const plan: RevocationPlan = { revoke: [], keptLastAllianceAdmin: [] };
  for (const account of dormant) {
    if (account.roles.includes('alliance_admin')) {
      if (allianceHolders <= 1) {
        plan.keptLastAllianceAdmin.push(account);
        continue;
      }
      allianceHolders -= 1;
    }
    plan.revoke.push(account);
  }
  return plan;
}
