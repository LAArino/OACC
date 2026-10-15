// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AdminRole, INVITATION_MAX_TTL_HOURS, type Invitation } from '@oecp/schemas';
import type { Selectable, Transaction } from 'kysely';
import { ProblemException } from '../../common/problem.js';
import type { AdminInvitationsTable, Database } from '../../db/database.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import { KeycloakAdminError } from '../../identity/keycloak-admin.error.js';
import {
  KeycloakAdminService,
  OECP_ORG_ID_ATTRIBUTE,
  type RequiredAction,
  SCHAC_HOME_ORGANIZATION_ATTRIBUTE,
} from '../../identity/keycloak-admin.service.js';
import {
  ACCEPTANCE_FAILURES,
  type AcceptanceFailure,
  type AcceptingIdentity,
  checkAcceptance,
  invitationStatus,
  requiresSchacCheck,
  schacMatches,
} from './invitation-rules.js';
import {
  buildInvitationLink,
  generateInvitationToken,
  hashInvitationToken,
} from './invitation-token.js';
import { MAILER, type MailerPort } from './mailer.js';

export const INVITATIONS_OPTIONS = Symbol('INVITATIONS_OPTIONS');

export interface InvitationsOptions {
  /** `OECP_PUBLIC_BASE_URL`, e.g. `https://campus.example.org`. */
  publicBaseUrl: string;
  now?: () => Date;
}

export type InvitationRow = Selectable<AdminInvitationsTable>;

/** Actions required from a new local user (spec §2.1: password ≥ 12 characters, TOTP). */
export const LOCAL_USER_ACTIONS: RequiredAction[] = ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'];

export interface CreateInvitationInput {
  email: string;
  role: AdminRole;
  organizationId: string;
  /** JWT `sub` of the inviting administrator or `system:<job>`. */
  invitedBy: string;
  /** Organization of the inviting administrator, for the audit log. */
  invitedByOrgId?: string | null;
  ttlHours: number;
  /** E-mail the link to the invitee (default true); the bootstrap CLI prints it instead. */
  sendEmail?: boolean;
  /**
   * Id of the invitation this one replaces ("resend"): it is revoked in the same
   * transaction, so a failed e-mail leaves the old invitation untouched.
   */
  replaces?: string;
}

export interface LocalUserOutcome {
  id: string;
  created: boolean;
  actionsEmailSent: boolean;
}

export interface CreatedInvitation {
  invitation: InvitationRow;
  /** Plain token; never stored, never logged. */
  token: string;
  link: string;
  /** Only for organizations without an IdP alias (local Keycloak users). */
  localUser?: LocalUserOutcome;
}

export interface AcceptedInvitation {
  role: AdminRole;
  orgId: string;
}

export interface AcceptInvitationIdentity extends AcceptingIdentity {
  /** Values of the `schac_home_organization` claim, if the token carries one. */
  schacHomeOrganization?: readonly string[] | undefined;
}

const ORGANIZATION_COLUMNS = [
  'id',
  'slug',
  'name',
  'keycloak_idp_alias',
  'schac_home_organization',
  'deleted_at',
] as const;

/** Admin invitations (spec §2.1): creation, acceptance, listing and revocation. */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly keycloak: KeycloakAdminService,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(INVITATIONS_OPTIONS) private readonly options: InvitationsOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateInvitationInput): Promise<CreatedInvitation> {
    const email = input.email.trim().toLowerCase();
    const organization = await this.db
      .selectFrom('organizations')
      .select(ORGANIZATION_COLUMNS)
      .where('id', '=', input.organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!organization) {
      throw new ProblemException(404, 'oecp.request.not_found', 'Organization not found');
    }

    // Organizations without an eduGAIN IdP get a Keycloak local user now; brokered
    // users are created by Keycloak at their first login (spec §2.1).
    const localUser =
      organization.keycloak_idp_alias === null
        ? await this.ensureLocalUser(email, input.ttlHours)
        : undefined;

    const { token, sha256 } = generateInvitationToken();
    const link = buildInvitationLink(this.options.publicBaseUrl, token, {
      idpAlias: organization.keycloak_idp_alias,
    });
    const expiresAt = new Date(this.now().getTime() + input.ttlHours * 3_600_000);

    const invitation = await this.db.transaction().execute(async (trx) => {
      if (input.replaces) {
        await this.revokeReplaced(trx, input.replaces, {
          sub: input.invitedBy,
          orgId: input.invitedByOrgId ?? undefined,
        });
      }
      const row = await trx
        .insertInto('admin_invitations')
        .values({
          email,
          role: input.role,
          organization_id: organization.id,
          token_sha256: sha256,
          invited_by: input.invitedBy,
          expires_at: expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: input.invitedBy,
          actor_org_id: input.invitedByOrgId ?? null,
          action: input.replaces ? 'invitation.resend' : 'invitation.create',
          entity_type: 'admin_invitation',
          entity_id: row.id,
          changes: {
            email,
            role: input.role,
            organization_id: organization.id,
            expires_at: expiresAt.toISOString(),
            ...(input.replaces ? { replaces: input.replaces } : {}),
            ...(localUser ? { keycloak_user_created: localUser.created } : {}),
          },
        })
        .execute();
      // Inside the transaction: if the mail cannot be sent, no invitation is left behind.
      if (input.sendEmail !== false) {
        await this.sendInvitationEmail(email, input.role, organization.name.en, link, expiresAt);
      }
      return row;
    });

    this.logger.log(
      `Invitation ${invitation.id} created (${input.role}, organization ${organization.slug})`,
    );
    return { invitation, token, link, ...(localUser ? { localUser } : {}) };
  }

  async accept(token: string, identity: AcceptInvitationIdentity): Promise<AcceptedInvitation> {
    const hash = hashInvitationToken(token);
    const now = this.now();
    return this.db.transaction().execute(async (trx) => {
      // Row lock: concurrent acceptances of the same token serialize here.
      const invitation = await trx
        .selectFrom('admin_invitations')
        .selectAll()
        .where('token_sha256', '=', hash)
        .forUpdate()
        .executeTakeFirst();
      const organization = invitation
        ? await trx
            .selectFrom('organizations')
            .select(ORGANIZATION_COLUMNS)
            .where('id', '=', invitation.organization_id)
            .executeTakeFirst()
        : undefined;

      const failure = checkAcceptance(invitation, organization, identity, now);
      if (failure) throw acceptanceError(failure);
      if (!invitation || !organization) throw acceptanceError('not_found'); // narrowed above

      if (requiresSchacCheck(organization)) {
        const asserted =
          identity.schacHomeOrganization ??
          (await this.keycloak.getUser(identity.sub))?.attributes?.[
            SCHAC_HOME_ORGANIZATION_ATTRIBUTE
          ] ??
          [];
        if (!schacMatches(organization.schac_home_organization ?? '', asserted)) {
          throw acceptanceError('schac_mismatch');
        }
      }

      // Keycloak first: if it fails, the transaction rolls back and the
      // invitation stays usable; both calls are idempotent on retry.
      await this.keycloak.setUserAttribute(identity.sub, OECP_ORG_ID_ATTRIBUTE, organization.id);
      await this.keycloak.addRealmRole(identity.sub, invitation.role);

      await trx
        .updateTable('admin_invitations')
        .set({ accepted_at: now, accepted_sub: identity.sub })
        .where('id', '=', invitation.id)
        .execute();
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: identity.sub,
          actor_org_id: organization.id,
          action: 'invitation.accept',
          entity_type: 'admin_invitation',
          entity_id: invitation.id,
          changes: {
            role: invitation.role,
            organization_id: organization.id,
            idp: identity.idp,
            keycloak_user_id: identity.sub,
          },
        })
        .execute();
      return { role: invitation.role, orgId: organization.id };
    });
  }

  /**
   * "Resend": revokes the invitation (unless it is already revoked) and creates a
   * new one with the same e-mail, role and organization, e-mailing the new link.
   * Accepted invitations cannot be resent (409 `oecp.invitation.invalid`).
   * `ttlHours` defaults to the lifetime of the original invitation.
   */
  async resend(
    id: string,
    actor: { sub: string; orgId: string | undefined },
    ttlHours?: number,
  ): Promise<CreatedInvitation> {
    const original = await this.db
      .selectFrom('admin_invitations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!original) {
      throw new ProblemException(404, 'oecp.request.not_found', 'Invitation not found');
    }
    if (original.accepted_at) {
      throw new ProblemException(409, 'oecp.invitation.invalid', 'The invitation is accepted');
    }
    const lifetimeHours = Math.round(
      (new Date(original.expires_at).getTime() - new Date(original.created_at).getTime()) /
        3_600_000,
    );
    return this.create({
      email: original.email,
      role: original.role,
      organizationId: original.organization_id,
      invitedBy: actor.sub,
      invitedByOrgId: actor.orgId ?? null,
      ttlHours: ttlHours ?? Math.min(INVITATION_MAX_TTL_HOURS, Math.max(1, lifetimeHours)),
      replaces: id,
    });
  }

  /** Most recent first; `organizationId` limits the list to one organization. */
  async list(scope: { organizationId?: string } = {}): Promise<Invitation[]> {
    let query = this.db
      .selectFrom('admin_invitations')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(500);
    if (scope.organizationId) query = query.where('organization_id', '=', scope.organizationId);
    const now = this.now();
    return (await query.execute()).map((row) => toApiInvitation(row, now));
  }

  async revoke(id: string, actor: { sub: string; orgId: string | undefined }): Promise<void> {
    const now = this.now();
    await this.db.transaction().execute(async (trx) => {
      const invitation = await trx
        .selectFrom('admin_invitations')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!invitation) {
        throw new ProblemException(404, 'oecp.request.not_found', 'Invitation not found');
      }
      const status = invitationStatus(invitation, now);
      if (status === 'accepted' || status === 'revoked') {
        throw new ProblemException(409, 'oecp.invitation.invalid', `The invitation is ${status}`);
      }
      await trx
        .updateTable('admin_invitations')
        .set({ revoked_at: now })
        .where('id', '=', id)
        .execute();
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: actor.sub,
          actor_org_id: actor.orgId ?? null,
          action: 'invitation.revoke',
          entity_type: 'admin_invitation',
          entity_id: id,
          changes: { email: invitation.email, role: invitation.role },
        })
        .execute();
    });
  }

  /** Locks the replaced invitation and revokes it (audited) unless already revoked. */
  private async revokeReplaced(
    trx: Transaction<Database>,
    id: string,
    actor: { sub: string; orgId: string | undefined },
  ): Promise<void> {
    const old = await trx
      .selectFrom('admin_invitations')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!old) throw new ProblemException(404, 'oecp.request.not_found', 'Invitation not found');
    if (old.accepted_at) {
      throw new ProblemException(409, 'oecp.invitation.invalid', 'The invitation is accepted');
    }
    if (old.revoked_at) return;
    await trx
      .updateTable('admin_invitations')
      .set({ revoked_at: this.now() })
      .where('id', '=', id)
      .execute();
    await trx
      .insertInto('audit_log')
      .values({
        actor_sub: actor.sub,
        actor_org_id: actor.orgId ?? null,
        action: 'invitation.revoke',
        entity_type: 'admin_invitation',
        entity_id: id,
        changes: { email: old.email, role: old.role, reason: 'resend' },
      })
      .execute();
  }

  /** Whether an unexpired, unaccepted, unrevoked invitation for the role exists. */
  async hasPendingInvitation(role: AdminRole): Promise<boolean> {
    const row = await this.db
      .selectFrom('admin_invitations')
      .select('id')
      .where('role', '=', role)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', this.now())
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  /**
   * Creates the Keycloak local user unless one exists, and asks Keycloak to e-mail
   * the set-password and TOTP enrolment link (again, for an existing user who has
   * not completed those actions yet). A failed e-mail (e.g. no SMTP in the realm)
   * is logged, not fatal: an operator can send it from the Keycloak admin console.
   */
  private async ensureLocalUser(email: string, ttlHours: number): Promise<LocalUserOutcome> {
    const existing = await this.keycloak.findUserByEmail(email);
    let id: string;
    let actions: RequiredAction[];
    if (existing) {
      id = existing.id;
      actions = LOCAL_USER_ACTIONS.filter((a) => existing.requiredActions?.includes(a));
      if (actions.length === 0) return { id, created: false, actionsEmailSent: false };
    } else {
      id = await this.keycloak.createLocalUser({ email, requiredActions: LOCAL_USER_ACTIONS });
      actions = LOCAL_USER_ACTIONS;
    }
    const created = existing === undefined;
    try {
      await this.keycloak.sendExecuteActionsEmail(id, actions, {
        redirectUri: `${this.options.publicBaseUrl.replace(/\/+$/, '')}/en/admin/`,
        lifespanSeconds: ttlHours * 3600,
      });
      return { id, created, actionsEmailSent: true };
    } catch (error) {
      if (!(error instanceof KeycloakAdminError)) throw error;
      this.logger.warn(
        `Keycloak user ${id}: the execute-actions e-mail failed (${error.message}); ` +
          'check the realm SMTP settings, then use "Send email" (Update Password, Configure OTP) ' +
          'on the user in the Keycloak admin console',
      );
      return { id, created, actionsEmailSent: false };
    }
  }

  private async sendInvitationEmail(
    to: string,
    role: AdminRole,
    organizationName: string,
    link: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.mailer.send({
        to,
        subject: `Invitation: ${organizationName} administrator, Open European Campus Portal`,
        text: [
          `You have been invited as ${role} of ${organizationName} on the Open European Campus Portal.`,
          '',
          'Open this link to sign in and accept the invitation:',
          link,
          '',
          `The link expires at ${expiresAt.toISOString()} and works only for ${to}.`,
          'If your organization has no institutional login, first follow the separate',
          'e-mail that asks you to set a password and a one-time-code app.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.error(`Invitation e-mail could not be sent: ${(error as Error).message}`);
      throw new ProblemException(502, 'oecp.mail.unavailable');
    }
  }
}

/** `oecp.invitation.mismatch` problems carry the extension member `reason`. */
function acceptanceError(failure: AcceptanceFailure): ProblemException {
  const { status, code, detail, reason } = ACCEPTANCE_FAILURES[failure];
  return new ProblemException(status, code, detail, reason ? { reason } : undefined);
}

export function toApiInvitation(row: InvitationRow, now: Date): Invitation {
  const iso = (d: Date | null) => (d === null ? null : new Date(d).toISOString());
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    organization_id: row.organization_id,
    invited_by: row.invited_by,
    status: invitationStatus(
      {
        expires_at: new Date(row.expires_at),
        accepted_at: row.accepted_at,
        revoked_at: row.revoked_at,
      },
      now,
    ),
    expires_at: new Date(row.expires_at).toISOString(),
    accepted_at: iso(row.accepted_at),
    accepted_sub: row.accepted_sub,
    revoked_at: iso(row.revoked_at),
    created_at: new Date(row.created_at).toISOString(),
  };
}
