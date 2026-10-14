// SPDX-License-Identifier: EUPL-1.2
import {
  Body,
  Controller,
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
  type IntegrationUpdateRequest,
  integrationUpdateRequest,
  type PartnerIntegration,
  type SyncNowResponse,
  type SyncRunDetail,
  type SyncRunDetailQuery,
  syncRunDetailQuery,
  type SyncRunList,
  syncRunListQuery,
  type TestConnectionResult,
} from '@oecp/schemas';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminJwtGuard } from '../auth/admin-jwt.guard.js';
import type { AdminPrincipal } from '../auth/claims.js';
import { CurrentAdmin, RequireRoles } from '../auth/decorators.js';
import { IntegrationsService, SyncNowRateLimited } from './integrations.service.js';
import { OrganizationAccess } from './organization-access.js';

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

const uuid = new ParseUUIDPipe();

/**
 * Channel A settings and sync monitor (spec §6.2, §8): partner_admin for its
 * organization (and sub-units), alliance_admin for all; host approval is
 * alliance_admin only.
 */
@Controller('api/admin/v1')
@UseGuards(AdminJwtGuard)
@RequireRoles(['partner_admin', 'alliance_admin'])
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly access: OrganizationAccess,
  ) {}

  @Get('organizations/:orgId/integration')
  async get(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
  ): Promise<PartnerIntegration> {
    await this.access.assert(admin, orgId);
    return this.integrations.get(orgId);
  }

  @Put('organizations/:orgId/integration')
  async put(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @Body(new ZodValidationPipe(integrationUpdateRequest)) body: IntegrationUpdateRequest,
  ): Promise<PartnerIntegration> {
    await this.access.assert(admin, orgId);
    return this.integrations.update(orgId, body, admin);
  }

  @Post('organizations/:orgId/integration/approve-host')
  @RequireRoles(['alliance_admin'])
  @HttpCode(200)
  async approveHost(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
  ): Promise<PartnerIntegration> {
    await this.access.assert(admin, orgId);
    return this.integrations.approveHost(orgId, admin);
  }

  @Post('organizations/:orgId/integration/test-connection')
  @HttpCode(200)
  async testConnection(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
  ): Promise<TestConnectionResult> {
    await this.access.assert(admin, orgId);
    return this.integrations.testConnection(orgId);
  }

  @Post('organizations/:orgId/integration/sync-now')
  @HttpCode(202)
  async syncNow(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<SyncNowResponse> {
    await this.access.assert(admin, orgId);
    try {
      return await this.integrations.syncNow(orgId, admin);
    } catch (error) {
      if (error instanceof SyncNowRateLimited) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @Get('organizations/:orgId/sync-runs')
  async listRuns(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @Query(new ZodValidationPipe(syncRunListQuery)) query: { limit: number },
  ): Promise<SyncRunList> {
    await this.access.assert(admin, orgId);
    return this.integrations.listRuns(orgId, query.limit);
  }

  @Get('sync-runs/:id')
  async getRun(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(syncRunDetailQuery)) query: SyncRunDetailQuery,
  ): Promise<SyncRunDetail> {
    await this.access.assert(admin, await this.integrations.runOrganization(id));
    return (await this.integrations.getRun(id, query)).detail;
  }
}
