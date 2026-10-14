// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import { InvitationsService } from '../admin/invitations/invitations.service.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { KeycloakAdminService } from '../identity/keycloak-admin.service.js';
import {
  type BootstrapAllianceAdminOptions,
  type CliOutput,
  EXIT,
  type ExitCode,
} from './program.js';

export const BOOTSTRAP_ACTOR = 'system:bootstrap';

/**
 * `oecp bootstrap-alliance-admin` (spec §2.1 Bootstrap): only while no Keycloak
 * user holds `alliance_admin` and no alliance_admin invitation is pending.
 * stdout receives the invitation link and nothing else.
 */
@Injectable()
export class BootstrapAllianceAdminCommand {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly keycloak: KeycloakAdminService,
    private readonly invitations: InvitationsService,
  ) {}

  async run(options: BootstrapAllianceAdminOptions, output: CliOutput): Promise<ExitCode> {
    const organization = await this.db
      .selectFrom('organizations')
      .select(['id', 'slug', 'org_type', 'keycloak_idp_alias'])
      .where('slug', '=', options.org)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!organization) {
      output.writeErr(
        `Organization "${options.org}" not found; run "oecp seed-organizations" first.\n`,
      );
      return EXIT.FAILURE;
    }

    const holders = await this.keycloak.countUsersWithRole('alliance_admin');
    if (holders > 0) {
      output.writeErr(
        `Refused: ${holders} Keycloak user(s) already hold alliance_admin. ` +
          'Further administrators are invited from the admin dashboard.\n',
      );
      return EXIT.REFUSED;
    }
    if (await this.invitations.hasPendingInvitation('alliance_admin')) {
      output.writeErr(
        'Refused: a pending alliance_admin invitation already exists. ' +
          'Use it, or wait until it expires.\n',
      );
      return EXIT.REFUSED;
    }

    const created = await this.invitations.create({
      email: options.email,
      role: 'alliance_admin',
      organizationId: organization.id,
      invitedBy: BOOTSTRAP_ACTOR,
      invitedByOrgId: null,
      ttlHours: options.ttlHours,
      sendEmail: false,
    });

    output.writeOut(`${created.link}\n`);
    const notes = [
      `Invitation for ${created.invitation.email} (alliance_admin, ${organization.slug}) ` +
        `expires at ${new Date(created.invitation.expires_at).toISOString()}.`,
    ];
    if (created.localUser) {
      notes.push(
        created.localUser.created
          ? 'Keycloak local user created.'
          : 'Keycloak user already existed.',
        created.localUser.actionsEmailSent
          ? 'Keycloak e-mailed the set-password and TOTP link.'
          : 'No set-password e-mail was sent; check the realm SMTP settings or send it from the Keycloak admin console.',
      );
    }
    output.writeErr(`${notes.join('\n')}\n`);
    return EXIT.OK;
  }
}
