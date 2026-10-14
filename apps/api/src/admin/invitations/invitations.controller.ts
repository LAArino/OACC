// SPDX-License-Identifier: EUPL-1.2
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type AcceptInvitationRequest,
  type AcceptInvitationResponse,
  acceptInvitationRequest,
  type CreateInvitationRequest,
  createInvitationRequest,
  type Invitation,
  type InvitationList,
} from '@oecp/schemas';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminJwtGuard } from '../auth/admin-jwt.guard.js';
import type { AdminPrincipal } from '../auth/claims.js';
import { AllowRoleless, CurrentAdmin, RequireRoles } from '../auth/decorators.js';
import { InvitationsService, toApiInvitation } from './invitations.service.js';

/** Admin invitations (spec §2.1, §8 "Administrators"). */
@Controller('api/admin/v1/invitations')
@UseGuards(AdminJwtGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /**
   * Spec §2.1 step 4; accepts a role-less token. The caller's current token
   * still has no role: the client must log in again to get one.
   */
  @Post('accept')
  @AllowRoleless()
  @HttpCode(200)
  async accept(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(acceptInvitationRequest)) body: AcceptInvitationRequest,
  ): Promise<AcceptInvitationResponse> {
    const accepted = await this.invitations.accept(body.token, {
      sub: admin.sub,
      email: admin.email,
      idp: admin.idp,
      roles: admin.roles,
      orgId: admin.orgId,
      schacHomeOrganization: admin.schacHomeOrganization,
    });
    return { role: accepted.role, org_id: accepted.orgId, relogin_required: true };
  }

  /** Creates an invitation and e-mails its link; the token is never returned. */
  @Post()
  @RequireRoles(['alliance_admin'])
  @HttpCode(201)
  async create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(createInvitationRequest)) body: CreateInvitationRequest,
  ): Promise<Invitation> {
    const { invitation } = await this.invitations.create({
      email: body.email,
      role: body.role,
      organizationId: body.organization_id,
      invitedBy: admin.sub,
      invitedByOrgId: admin.orgId ?? null,
      ttlHours: body.ttl_hours,
    });
    return toApiInvitation(invitation, new Date());
  }

  /** alliance_admin: every invitation; partner_admin: those of its organization. */
  @Get()
  @RequireRoles(['alliance_admin', 'partner_admin'])
  async list(@CurrentAdmin() admin: AdminPrincipal): Promise<InvitationList> {
    const all = admin.roles.includes('alliance_admin');
    return { items: await this.invitations.list(all ? {} : { organizationId: admin.orgId }) };
  }

  @Delete(':id')
  @RequireRoles(['alliance_admin'])
  @HttpCode(204)
  async revoke(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.invitations.revoke(id, { sub: admin.sub, orgId: admin.orgId });
  }
}
