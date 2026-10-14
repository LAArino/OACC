// SPDX-License-Identifier: EUPL-1.2
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type CourseSearchQuery,
  type CourseSearchResponse,
  normalizeCourseSearch,
  type PublicCourseDetail,
  type ReferenceResponse,
  type SuggestQuery,
  type SuggestResponse,
} from '@oecp/schemas';
import { ProblemException } from '../common/problem.js';
import type { Env } from '../config/env.js';
import { toCourseDetail, toReference, toSearchResponse, toSitemap } from './catalogue.mapper.js';
import { CatalogueRepository } from './catalogue.repository.js';
import { type Clock, READ_API_CLOCK, utcToday } from './clock.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CatalogueService {
  constructor(
    private readonly repository: CatalogueRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(READ_API_CLOCK) private readonly clock: Clock,
  ) {}

  async search(query: CourseSearchQuery): Promise<CourseSearchResponse> {
    const search = normalizeCourseSearch(query);
    const rows = await this.repository.search(search, utcToday(this.clock()));
    return toSearchResponse(rows, search);
  }

  /** 404 for malformed, unknown, unpublished or deleted courses alike. */
  async course(id: string): Promise<PublicCourseDetail> {
    const rows = UUID.test(id)
      ? await this.repository.courseDetail(id.toLowerCase(), utcToday(this.clock()))
      : null;
    if (!rows) {
      throw new ProblemException(
        HttpStatus.NOT_FOUND,
        'oecp.request.not_found',
        'Course not found',
      );
    }
    return toCourseDetail(rows);
  }

  async suggest(query: SuggestQuery): Promise<SuggestResponse> {
    const locale = query.locale ?? query.lang ?? 'en';
    return { items: await this.repository.suggest(query.q, query.limit, locale) };
  }

  async reference(): Promise<ReferenceResponse> {
    return toReference(await this.repository.reference());
  }

  async sitemap(): Promise<string> {
    const base = this.config.get('OECP_PUBLIC_BASE_URL', { infer: true });
    return toSitemap(base, await this.repository.sitemap());
  }
}
