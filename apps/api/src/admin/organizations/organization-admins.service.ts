// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AdminRole,
  adminRole,
  type OrganizationAdmin,
  type ResendSetupResponse,
} from '@oecp/schemas';
import { ProblemException } from '../../common/problem.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import {
  KeycloakAdminService,
  type KeycloakUser,
  OECP_ORG_ID_ATTRIBUTE,
  type RequiredAction,
} from '../../identity/keycloak-admin.service.js';
import { LOCAL_IDP, type AdminPrincipal } from '../auth/claims.js';
import {
  INVITATIONS_OPTIONS,
  type InvitationsOptions,
  LOCAL_USER_ACTIONS,
} from '../invitations/invitations.service.js';

const isAdminRole = (name: string): name is AdminRole => adminRole.safeParse(name).success;

/**
 * Administrators of an organization (spec §2, §2.2): Keycloak users whose
 * attribute `oecp_org_id` names it. Roles are read from and removed in Keycloak;
 * OECP stores no administrator table.
 */
@Injectable()
export class OrganizationAdminsService {
  private readonly logger = new Logger(OrganizationAdminsService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly keycloak: KeycloakAdminService,
    @Inject(INVITATIONS_OPTIONS) private readonly options: InvitationsOptions,
  ) {}

  /** Ordered by e-mail (then username). */
  async list(organizationId: string): Promise<OrganizationAdmin[]> {
    const users = await this.keycloak.findUsersByAttribute(OECP_ORG_ID_ATTRIBUTE, organizationId);
    const items: OrganizationAdmin[] = [];
    // Events need `view-events`; after the first 403 the others are not asked.
    let eventsReadable = true;
    for (const user of users) {
      const [roles, identities] = await Promise.all([
        this.keycloak.realmRoleNames(user.id),
        this.keycloak.federatedIdentities(user.id),
      ]);
      let lastLogin: Date | null = null;
      if (eventsReadable) {
        const result = await this.keycloak.lastLogin(user.id);
        if (result.available) lastLogin = result.at;
        else eventsReadable = false;
      }
      items.push({
        sub: user.id,
        username: user.username ?? null,
        email: user.email ?? null,
        name: displayName(user),
        roles: roles.filter(isAdminRole).sort(),
        idp: identities[0]?.identityProvider ?? LOCAL_IDP,
        enabled: user.enabled ?? false,
        email_verified: user.emailVerified ?? false,
        created_at:
          typeof user.createdTimestamp === 'number'
            ? new Date(user.createdTimestamp).toISOString()
            : null,
        last_login_at: lastLogin ? lastLogin.toISOString() : null,
        required_actions: [...(user.requiredActions ?? [])],
      });
    }
    return items.sort((a, b) =>
      (a.email ?? a.username ?? a.sub).localeCompare(b.email ?? b.username ?? b.sub),
    );
  }

  /**
   * Revocation (spec §2.2): removes the OECP realm roles and `oecp_org_id`, then
   * ends the user's sessions. Refused for the caller (409
   * `oecp.admin.cannot_remove_self`) and for the last `alliance_admin` (409
   * `oecp.admin.last_alliance_admin`). The Keycloak account itself is kept.
   */
  async revoke(organizationId: string, sub: string, admin: AdminPrincipal): Promise<void> {
    if (sub === admin.sub) throw new ProblemException(409, 'oecp.admin.cannot_remove_self');
    const user = await this.member(organizationId, sub);
    const roles = (await this.keycloak.realmRoleNames(sub)).filter(isAdminRole);
    if (roles.includes('alliance_admin')) {
      const holders = await this.keycloak.countUsersWithRole('alliance_admin');
      if (holders <= 1) throw new ProblemException(409, 'oecp.admin.last_alliance_admin');
    }
    // Idempotent: after a partial failure the same request can be retried.
    await this.keycloak.revokeOecpAccess(sub, roles);

    await this.db
      .insertInto('audit_log')
      .values({
        actor_sub: admin.sub,
        actor_org_id: admin.orgId ?? null,
        action: 'admin.revoke',
        entity_type: 'organization',
        entity_id: organizationId,
        changes: {
          keycloak_user_id: sub,
          email: user.email ?? null,
          roles_removed: roles,
          oecp_org_id: { from: organizationId, to: null },
          sessions: 'logged_out',
        },
      })
      .execute();
    this.logger.log(`Administrator ${sub} of ${organizationId} revoked by ${admin.sub}`);
  }

  /**
   * Re-sends Keycloak's execute-actions e-mail (set password, enrol TOTP) to a
   * local account that has not completed those actions.
   */
  async resendSetup(
    organizationId: string,
    sub: string,
    admin: AdminPrincipal,
  ): Promise<ResendSetupResponse> {
    const user = await this.member(organizationId, sub);
    if ((await this.keycloak.federatedIdentities(sub)).length > 0) {
      throw new ProblemException(409, 'oecp.admin.not_local_account');
    }
    const actions: RequiredAction[] = LOCAL_USER_ACTIONS.filter((a) =>
      user.requiredActions?.includes(a),
    );
    if (actions.length === 0) throw new ProblemException(409, 'oecp.admin.setup_complete');
    await this.keycloak.sendExecuteActionsEmail(sub, actions, {
      redirectUri: `${this.options.publicBaseUrl.replace(/\/+$/, '')}/en/admin/`,
    });
    await this.db
      .insertInto('audit_log')
      .values({
        actor_sub: admin.sub,
        actor_org_id: admin.orgId ?? null,
        action: 'admin.resend_setup',
        entity_type: 'organization',
        entity_id: organizationId,
        changes: { keycloak_user_id: sub, email: user.email ?? null, actions },
      })
      .execute();
    return { sub, actions };
  }

  /** The Keycloak user, if it administers the organization; else 404. */
  private async member(organizationId: string, sub: string): Promise<KeycloakUser> {
    const user = await this.keycloak.getUser(sub);
    const orgIds = user?.attributes?.[OECP_ORG_ID_ATTRIBUTE] ?? [];
    if (!user || !orgIds.some((v) => v.toLowerCase() === organizationId.toLowerCase())) {
      throw new ProblemException(
        404,
        'oecp.request.not_found',
        'No administrator of this organization has this id',
      );
    }
    return user;
  }
}

function displayName(user: KeycloakUser): string | null {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || null;
}
