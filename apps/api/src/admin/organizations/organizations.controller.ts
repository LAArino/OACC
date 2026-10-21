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
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminOrganization,
  type AdminOrganizationList,
  type AdminOrganizationListQuery,
  adminOrganizationListQuery,
  type CreateOrganizationInvitationRequest,
  createOrganizationInvitationRequest,
  type Invitation,
  type InvitationList,
  type OrganizationAdminList,
  type OrganizationInputValue,
  organizationInput,
  type ResendSetupResponse,
} from '@oecp/schemas';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminJwtGuard } from '../auth/admin-jwt.guard.js';
import type { AdminPrincipal } from '../auth/claims.js';
import { CurrentAdmin, RequireRoles } from '../auth/decorators.js';
import { OrganizationAccess } from '../integrations/organization-access.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import { OrganizationAdminsService } from './organization-admins.service.js';
import { OrganizationsService } from './organizations.service.js';

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

const uuid = new ParseUUIDPipe();
/** Keycloak user ids: UUIDs for local and brokered users; kept permissive for federation. */
const keycloakId = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9-]{1,64}$/));

/**
 * Organizations, their administrators and invitations (spec §2, §8
 * "Organizations, administrators"). Writes are alliance_admin only; reads:
 * alliance_admin every organization, partner_admin its organization and
 * sub-units. Errors: 404 `oecp.request.not_found`, 403 scope, 409
 * `oecp.content.duplicate_slug` / `duplicate_identifier` / `slug_immutable` /
 * `organization_in_use` / `invalid_parent` (restore), `oecp.admin.*`, 422
 * `oecp.content.invalid_parent`, 502/504 `oecp.identity.unavailable`.
 */
@Controller('api/admin/v1')
@UseGuards(AdminJwtGuard)
@RequireRoles(['partner_admin', 'alliance_admin'])
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly admins: OrganizationAdminsService,
    private readonly invitations: InvitationsService,
    private readonly access: OrganizationAccess,
  ) {}

  @Get('organizations')
  async list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query(new ZodValidationPipe(adminOrganizationListQuery)) query: AdminOrganizationListQuery,
  ): Promise<AdminOrganizationList> {
    const scope = await this.access.scope(admin);
    return { items: await this.organizations.list(scope, query.include_deleted) };
  }

  /** alliance_admin also sees deleted organizations (to restore them). */
  @Get('organizations/:id')
  async get(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<AdminOrganization> {
    if (admin.roles.includes('alliance_admin')) return this.organizations.get(id, true);
    await this.access.assert(admin, id);
    return this.organizations.get(id);
  }

  @Post('organizations')
  @RequireRoles(['alliance_admin'])
  @HttpCode(201)
  async create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body(new ZodValidationPipe(organizationInput)) body: OrganizationInputValue,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<AdminOrganization> {
    const created = await this.organizations.create(body, admin);
    response.setHeader('Location', `/api/admin/v1/organizations/${created.id}`);
    return created;
  }

  @Put('organizations/:id')
  @RequireRoles(['alliance_admin'])
  async update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(organizationInput)) body: OrganizationInputValue,
  ): Promise<AdminOrganization> {
    return this.organizations.update(id, body, admin);
  }

  @Delete('organizations/:id')
  @RequireRoles(['alliance_admin'])
  @HttpCode(204)
  async remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<void> {
    await this.organizations.remove(id, admin);
  }

  @Post('organizations/:id/restore')
  @RequireRoles(['alliance_admin'])
  @HttpCode(200)
  async restore(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<AdminOrganization> {
    return this.organizations.restore(id, admin);
  }

  @Get('organizations/:orgId/admins')
  async listAdmins(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
  ): Promise<OrganizationAdminList> {
    await this.access.assert(admin, orgId);
    return { items: await this.admins.list(orgId) };
  }

  /** Revocation (spec §2.2): roles and `oecp_org_id` removed, sessions ended. */
  @Delete('organizations/:orgId/admins/:sub')
  @RequireRoles(['alliance_admin'])
  @HttpCode(204)
  async revokeAdmin(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @Param('sub', keycloakId) sub: string,
  ): Promise<void> {
    await this.access.assert(admin, orgId);
    await this.admins.revoke(orgId, sub, admin);
  }

  @Post('organizations/:orgId/admins/:sub/resend-setup')
  @RequireRoles(['alliance_admin'])
  @HttpCode(200)
  async resendSetup(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @Param('sub', keycloakId) sub: string,
  ): Promise<ResendSetupResponse> {
    await this.access.assert(admin, orgId);
    return this.admins.resendSetup(orgId, sub, admin);
  }

  /**
   * Org-scoped alias of `POST /invitations`: same role rule, response and audit
   * (`invitation.create`); the organization comes from the path.
   */
  @Post('organizations/:orgId/invitations')
  @RequireRoles(['alliance_admin'])
  @HttpCode(201)
  async createInvitation(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @Body(new ZodValidationPipe(createOrganizationInvitationRequest))
    body: CreateOrganizationInvitationRequest,
  ): Promise<Invitation> {
    await this.access.assert(admin, orgId);
    const { invitation } = await this.invitations.create({
      email: body.email,
      role: body.role,
      organizationId: orgId,
      invitedBy: admin.sub,
      invitedByOrgId: admin.orgId ?? null,
      ttlHours: body.ttl_hours,
    });
    return this.invitations.toApi(invitation);
  }

  /** The organization's invitations, most recent first, with derived `status`. */
  @Get('organizations/:orgId/invitations')
  async listInvitations(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
  ): Promise<InvitationList> {
    await this.access.assert(admin, orgId);
    return { items: await this.invitations.list({ organizationId: orgId }) };
  }
}
