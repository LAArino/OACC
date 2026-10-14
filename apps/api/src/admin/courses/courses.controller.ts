// SPDX-License-Identifier: EUPL-1.2
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminCourse,
  type AdminCourseHistory,
  type AdminCourseList,
  adminCourseHistoryQuery,
  type AdminCourseListQuery,
  adminCourseListQuery,
  type AdminOffering,
  type AdminReference,
  type CourseInputValue,
  courseInput,
  courseOverridesPatch,
  type OfferingInputValue,
  offeringInput,
  offeringOverridesPatch,
  type ParsedOverridesPatch,
  type StatusChangeRequest,
  statusChangeRequest,
} from '@oecp/schemas';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminJwtGuard } from '../auth/admin-jwt.guard.js';
import type { AdminPrincipal } from '../auth/claims.js';
import { CurrentAdmin, RequireRoles } from '../auth/decorators.js';
import { OrganizationAccess } from '../integrations/organization-access.js';
import { CoursesService } from './courses.service.js';

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

const uuid = new ParseUUIDPipe();
const BASE = '/api/admin/v1';

/**
 * Channel C, the web form (spec §6.4, §6.5, §8.1 "Course wizard"): partner_admin
 * for its organization and sub-units, alliance_admin for all. Organizations whose
 * authoritative channel is `oeapi` get overrides only (`…/overrides`, `…/status`);
 * the others create, replace and delete records. Errors are problem+json:
 * 400 request shape, 404, 403 scope, 409 `oecp.sync.channel_disabled` /
 * `oecp.content.override_not_allowed` / `duplicate_ext_id` / `ext_id_immutable` /
 * `has_published_offerings` / `published_not_deletable` / `harvested_not_deletable`,
 * 422 content and reference checks (JSON pointers into the body).
 */
@Controller('api/admin/v1')
@UseGuards(AdminJwtGuard)
@RequireRoles(['partner_admin', 'alliance_admin'])
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly access: OrganizationAccess,
  ) {}

  /** Reference data of the course wizard and the CSV console for one organization. */
  @Get('organizations/:orgId/reference')
  async reference(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
  ): Promise<AdminReference> {
    await this.access.assert(admin, orgId);
    return this.courses.reference(orgId);
  }

  @Get('organizations/:orgId/courses')
  async list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @Query(new ZodValidationPipe(adminCourseListQuery)) query: AdminCourseListQuery,
  ): Promise<AdminCourseList> {
    await this.access.assert(admin, orgId);
    return this.courses.list(orgId, query);
  }

  @Post('organizations/:orgId/courses')
  async create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @Body(new ZodValidationPipe(courseInput)) body: CourseInputValue,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<AdminCourse> {
    await this.access.assert(admin, orgId);
    const course = await this.courses.createCourse(admin, orgId, body);
    response.setHeader('Location', `${BASE}/courses/${course.id}`);
    return course;
  }

  @Get('courses/:id')
  async get(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<AdminCourse> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    return this.courses.getCourse(id);
  }

  @Put('courses/:id')
  async replace(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(courseInput)) body: CourseInputValue,
  ): Promise<AdminCourse> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    return this.courses.replaceCourse(admin, id, body);
  }

  @Patch('courses/:id/overrides')
  async patchOverrides(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(courseOverridesPatch)) body: ParsedOverridesPatch,
  ): Promise<AdminCourse> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    return this.courses.patchCourseOverrides(admin, id, body);
  }

  @Post('courses/:id/status')
  @HttpCode(200)
  async status(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(statusChangeRequest)) body: StatusChangeRequest,
  ): Promise<AdminCourse> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    return this.courses.setCourseStatus(admin, id, body.status);
  }

  @Delete('courses/:id')
  @HttpCode(204)
  async remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<void> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    await this.courses.deleteCourse(admin, id);
  }

  @Get('courses/:id/history')
  async history(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(adminCourseHistoryQuery)) query: { limit: number },
  ): Promise<AdminCourseHistory> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    return this.courses.history(id, query.limit);
  }

  @Post('courses/:id/offerings')
  async createOffering(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(offeringInput)) body: OfferingInputValue,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<AdminOffering> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    const offering = await this.courses.createOffering(admin, id, body);
    response.setHeader('Location', `${BASE}/offerings/${offering.id}`);
    return offering;
  }

  @Get('offerings/:id')
  async getOffering(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<AdminOffering> {
    await this.access.assert(admin, await this.courses.offeringOrganization(id));
    return this.courses.getOffering(id);
  }

  @Put('offerings/:id')
  async replaceOffering(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(offeringInput)) body: OfferingInputValue,
  ): Promise<AdminOffering> {
    await this.access.assert(admin, await this.courses.offeringOrganization(id));
    return this.courses.replaceOffering(admin, id, body);
  }

  @Patch('offerings/:id/overrides')
  async patchOfferingOverrides(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(offeringOverridesPatch)) body: ParsedOverridesPatch,
  ): Promise<AdminOffering> {
    await this.access.assert(admin, await this.courses.offeringOrganization(id));
    return this.courses.patchOfferingOverrides(admin, id, body);
  }

  @Post('offerings/:id/status')
  @HttpCode(200)
  async offeringStatus(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(statusChangeRequest)) body: StatusChangeRequest,
  ): Promise<AdminOffering> {
    await this.access.assert(admin, await this.courses.offeringOrganization(id));
    return this.courses.setOfferingStatus(admin, id, body.status);
  }

  @Delete('offerings/:id')
  @HttpCode(204)
  async removeOffering(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<void> {
    await this.access.assert(admin, await this.courses.offeringOrganization(id));
    await this.courses.deleteOffering(admin, id);
  }
}
