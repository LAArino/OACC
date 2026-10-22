// SPDX-License-Identifier: EUPL-1.2
/**
 * Anonymous, read-only OEAPI v5-compatible API (spec §9). IDs are OACC UUIDs;
 * only published courses and published or cancelled offerings are exposed.
 * Responses carry `Cache-Control: public, max-age=300` and a weak `ETag`
 * (Express); errors are v5 `Problem` objects.
 */
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import {
  type OeapiAcademicSessionsQuery,
  oeapiAcademicSessionsQuery,
  type OeapiCoursesQuery,
  oeapiCoursesQuery,
  type OeapiExpandQuery,
  oeapiExpandQuery,
  type OeapiOfferingsQuery,
  oeapiOfferingsQuery,
  type OeapiOrganizationsQuery,
  oeapiOrganizationsQuery,
} from '@oecp/schemas';
import { CacheControlInterceptor } from '../catalogue/cache-control.interceptor.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type {
  V5AcademicSession,
  V5Course,
  V5Offering,
  V5Organization,
  V5Page,
} from './oeapi-v5.mapper.js';
import { OeapiProblemFilter } from './oeapi-problem.filter.js';
import { type OeapiServiceDocument, OeapiService } from './oeapi.service.js';

export const OEAPI_CACHE = 'public, max-age=300';
const expandPipe = new ZodValidationPipe(oeapiExpandQuery);

@Controller('oeapi/v5')
@UseFilters(OeapiProblemFilter)
@UseInterceptors(new CacheControlInterceptor(OEAPI_CACHE))
export class OeapiServiceController {
  constructor(private readonly oeapi: OeapiService) {}

  /** Service metadata (`GET /`). */
  @Get()
  service(): Promise<OeapiServiceDocument> {
    return this.oeapi.service();
  }
}

@Controller('oeapi/v5/organizations')
@UseFilters(OeapiProblemFilter)
@UseInterceptors(new CacheControlInterceptor(OEAPI_CACHE))
export class OeapiOrganizationsController {
  constructor(private readonly oeapi: OeapiService) {}

  /** The alliance (`root`), its partners (`institute`) and their sub-units. */
  @Get()
  list(
    @Query(new ZodValidationPipe(oeapiOrganizationsQuery)) query: OeapiOrganizationsQuery,
  ): Promise<V5Page<V5Organization>> {
    return this.oeapi.organizations(query);
  }

  @Get(':organizationId')
  get(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query(expandPipe) query: OeapiExpandQuery,
  ): Promise<V5Organization> {
    return this.oeapi.organization(organizationId, query.expand);
  }

  /** Courses of the organization or teaching unit; every course for the alliance root. */
  @Get(':organizationId/courses')
  courses(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query(new ZodValidationPipe(oeapiCoursesQuery)) query: OeapiCoursesQuery,
  ): Promise<V5Page<V5Course>> {
    return this.oeapi.organizationCourses(organizationId, query);
  }
}

@Controller('oeapi/v5/academic-sessions')
@UseFilters(OeapiProblemFilter)
@UseInterceptors(new CacheControlInterceptor(OEAPI_CACHE))
export class OeapiAcademicSessionsController {
  constructor(private readonly oeapi: OeapiService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(oeapiAcademicSessionsQuery)) query: OeapiAcademicSessionsQuery,
  ): Promise<V5Page<V5AcademicSession>> {
    return this.oeapi.academicSessions(query);
  }

  @Get(':academicSessionId')
  get(
    @Param('academicSessionId', ParseUUIDPipe) academicSessionId: string,
    @Query(expandPipe) query: OeapiExpandQuery,
  ): Promise<V5AcademicSession> {
    return this.oeapi.academicSession(academicSessionId, query.expand);
  }
}

@Controller('oeapi/v5/courses')
@UseFilters(OeapiProblemFilter)
@UseInterceptors(new CacheControlInterceptor(OEAPI_CACHE))
export class OeapiCoursesController {
  constructor(private readonly oeapi: OeapiService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(oeapiCoursesQuery)) query: OeapiCoursesQuery,
  ): Promise<V5Page<V5Course>> {
    return this.oeapi.courses(query);
  }

  @Get(':courseId')
  get(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query(expandPipe) query: OeapiExpandQuery,
  ): Promise<V5Course> {
    return this.oeapi.course(courseId, query.expand);
  }

  /** v5 `since` semantics: offerings starting on or after `since` (default today). */
  @Get(':courseId/offerings')
  offerings(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query(new ZodValidationPipe(oeapiOfferingsQuery)) query: OeapiOfferingsQuery,
  ): Promise<V5Page<V5Offering>> {
    return this.oeapi.courseOfferings(courseId, query);
  }
}

@Controller('oeapi/v5/offerings')
@UseFilters(OeapiProblemFilter)
@UseInterceptors(new CacheControlInterceptor(OEAPI_CACHE))
export class OeapiOfferingsController {
  constructor(private readonly oeapi: OeapiService) {}

  /** `expand=academicSession,course` replaces the references with the objects. */
  @Get(':offeringId')
  get(
    @Param('offeringId', ParseUUIDPipe) offeringId: string,
    @Query(expandPipe) query: OeapiExpandQuery,
  ): Promise<V5Offering> {
    return this.oeapi.offering(offeringId, query.expand);
  }
}
