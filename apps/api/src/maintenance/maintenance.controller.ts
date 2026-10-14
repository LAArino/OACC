// SPDX-License-Identifier: EUPL-1.2
import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  type MaintenanceJobRunResponse,
  type MaintenanceRunList,
  type MaintenanceRunListQuery,
  maintenanceRunListQuery,
} from '@oecp/schemas';
import { AdminJwtGuard } from '../admin/auth/admin-jwt.guard.js';
import type { AdminPrincipal } from '../admin/auth/claims.js';
import { CurrentAdmin, RequireRoles } from '../admin/auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MaintenanceJobsService } from './maintenance-jobs.service.js';

/** Maintenance runs and on-demand jobs (spec §8.2), alliance_admin only. */
@Controller('api/admin/v1/maintenance')
@UseGuards(AdminJwtGuard)
@RequireRoles(['alliance_admin'])
export class MaintenanceController {
  constructor(private readonly jobs: MaintenanceJobsService) {}

  /** Most recent runs first; `limit` 1–200 (default 50), optional `job` filter. */
  @Get('runs')
  runs(
    @Query(new ZodValidationPipe(maintenanceRunListQuery)) query: MaintenanceRunListQuery,
  ): Promise<MaintenanceRunList> {
    return this.jobs.listRuns(query.limit, query.job);
  }

  /** 202 `{job, status: "queued" | "already_queued"}`; unknown job → 404. */
  @Post('jobs/:name/run')
  @HttpCode(202)
  run(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('name') name: string,
  ): Promise<MaintenanceJobRunResponse> {
    return this.jobs.requestRun(name, admin);
  }
}
