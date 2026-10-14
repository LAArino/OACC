// SPDX-License-Identifier: EUPL-1.2
import {
  Controller,
  Get,
  NotImplementedException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { type CourseSearchQuery, courseSearchQuery, suggestQuery } from '@oecp/schemas';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

/** Anonymous catalogue API used by the Nuxt portal (spec §7). Never sets cookies. */
@Controller('api/public/v1')
export class CatalogueController {
  /** Search results with facet counts; 20 per page. */
  @Get('courses')
  search(@Query(new ZodValidationPipe(courseSearchQuery)) _query: CourseSearchQuery): never {
    throw new NotImplementedException();
  }

  /** Course page: course, texts, offerings, partner. */
  @Get('courses/:courseId')
  course(@Param('courseId', ParseUUIDPipe) _courseId: string): never {
    throw new NotImplementedException();
  }

  /** Up to 8 title suggestions for `q` (≥ 2 characters). */
  @Get('suggest')
  suggest(@Query(new ZodValidationPipe(suggestQuery)) _query: { q: string }): never {
    throw new NotImplementedException();
  }

  /** Partners, delivery modes, ISCED broad fields and languages for filters. */
  @Get('reference')
  reference(): never {
    throw new NotImplementedException();
  }
}
