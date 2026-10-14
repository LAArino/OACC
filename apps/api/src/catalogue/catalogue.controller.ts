// SPDX-License-Identifier: EUPL-1.2
import { Controller, Get, Header, Param, Query, UseInterceptors } from '@nestjs/common';
import {
  type CourseSearchQuery,
  type CourseSearchResponse,
  courseSearchQuery,
  type PublicCourseDetail,
  type ReferenceResponse,
  type SuggestQuery,
  type SuggestResponse,
  suggestQuery,
} from '@oecp/schemas';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CacheControlInterceptor } from './cache-control.interceptor.js';
import { CatalogueService } from './catalogue.service.js';

/** `Cache-Control` of result lists and suggestions. */
export const LIST_CACHE = 'public, max-age=60';
/** `Cache-Control` of course pages, reference data and the sitemap. */
export const PAGE_CACHE = 'public, max-age=300';

/**
 * Anonymous catalogue API used by the Nuxt portal (spec §7). Never sets cookies;
 * Express adds a weak `ETag` to every 200 response and answers a matching
 * `If-None-Match` with 304. Errors are `application/problem+json` and uncached.
 */
@Controller('api/public/v1')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  /** Search results with facet counts; 20 per page by default. */
  @Get('courses')
  @UseInterceptors(new CacheControlInterceptor(LIST_CACHE))
  search(
    @Query(new ZodValidationPipe(courseSearchQuery)) query: CourseSearchQuery,
  ): Promise<CourseSearchResponse> {
    return this.catalogue.search(query);
  }

  /** Course page: course, texts in every language, offerings, partner. */
  @Get('courses/:courseId')
  @UseInterceptors(new CacheControlInterceptor(PAGE_CACHE))
  course(@Param('courseId') courseId: string): Promise<PublicCourseDetail> {
    return this.catalogue.course(courseId);
  }

  /** Up to 10 title suggestions for `q` (≥ 2 characters). */
  @Get('suggest')
  @UseInterceptors(new CacheControlInterceptor(LIST_CACHE))
  suggest(
    @Query(new ZodValidationPipe(suggestQuery)) query: SuggestQuery,
  ): Promise<SuggestResponse> {
    return this.catalogue.suggest(query);
  }

  /** Organizations, delivery modes, ISCED broad fields, languages and levels for filters. */
  @Get('reference')
  @UseInterceptors(new CacheControlInterceptor(PAGE_CACHE))
  reference(): Promise<ReferenceResponse> {
    return this.catalogue.reference();
  }

  /** sitemaps.org listing of `${OECP_PUBLIC_BASE_URL}/en/courses/{id}`. */
  @Get('sitemap.xml')
  @UseInterceptors(new CacheControlInterceptor(PAGE_CACHE))
  @Header('Content-Type', 'application/xml; charset=utf-8')
  sitemap(): Promise<string> {
    return this.catalogue.sitemap();
  }
}
