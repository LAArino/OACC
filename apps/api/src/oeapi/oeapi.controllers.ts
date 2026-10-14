// SPDX-License-Identifier: EUPL-1.2
/**
 * Anonymous, read-only OEAPI v5-compatible API (spec §9). IDs are OECP UUIDs;
 * only published courses and published or cancelled offerings are exposed.
 */
import {
  Controller,
  Get,
  Header,
  NotImplementedException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { type OeapiPagingQuery, oeapiPagingQuery } from '@oecp/schemas';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

const CACHE = 'public, max-age=300';
const paging = new ZodValidationPipe(oeapiPagingQuery);
const offeringsQuery = new ZodValidationPipe(
  oeapiPagingQuery.extend({ since: z.iso.date().optional() }),
);

@Controller('oeapi/v5')
export class OeapiServiceController {
  /** Service metadata (`GET /`). */
  @Get()
  @Header('Cache-Control', CACHE)
  service(): never {
    throw new NotImplementedException();
  }
}

@Controller('oeapi/v5/organizations')
export class OeapiOrganizationsController {
  @Get()
  @Header('Cache-Control', CACHE)
  list(@Query(paging) _paging: OeapiPagingQuery): never {
    throw new NotImplementedException();
  }

  @Get(':organizationId')
  @Header('Cache-Control', CACHE)
  get(@Param('organizationId', ParseUUIDPipe) _organizationId: string): never {
    throw new NotImplementedException();
  }

  @Get(':organizationId/courses')
  @Header('Cache-Control', CACHE)
  courses(
    @Param('organizationId', ParseUUIDPipe) _organizationId: string,
    @Query(paging) _paging: OeapiPagingQuery,
  ): never {
    throw new NotImplementedException();
  }
}

@Controller('oeapi/v5/academic-sessions')
export class OeapiAcademicSessionsController {
  @Get()
  @Header('Cache-Control', CACHE)
  list(@Query(paging) _paging: OeapiPagingQuery): never {
    throw new NotImplementedException();
  }

  @Get(':academicSessionId')
  @Header('Cache-Control', CACHE)
  get(@Param('academicSessionId', ParseUUIDPipe) _academicSessionId: string): never {
    throw new NotImplementedException();
  }
}

@Controller('oeapi/v5/courses')
export class OeapiCoursesController {
  @Get()
  @Header('Cache-Control', CACHE)
  list(@Query(paging) _paging: OeapiPagingQuery): never {
    throw new NotImplementedException();
  }

  @Get(':courseId')
  @Header('Cache-Control', CACHE)
  get(@Param('courseId', ParseUUIDPipe) _courseId: string): never {
    throw new NotImplementedException();
  }

  /** v5 `since` semantics: without it, only offerings that have not ended. */
  @Get(':courseId/offerings')
  @Header('Cache-Control', CACHE)
  offerings(
    @Param('courseId', ParseUUIDPipe) _courseId: string,
    @Query(offeringsQuery) _query: OeapiPagingQuery & { since?: string },
  ): never {
    throw new NotImplementedException();
  }
}

@Controller('oeapi/v5/offerings')
export class OeapiOfferingsController {
  @Get(':offeringId')
  @Header('Cache-Control', CACHE)
  get(@Param('offeringId', ParseUUIDPipe) _offeringId: string): never {
    throw new NotImplementedException();
  }
}
