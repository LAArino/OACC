// SPDX-License-Identifier: EUPL-1.2
import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type CourseImageFetchJob, ERROR_CODES } from '@oecp/schemas';
import type { Env } from '../config/env.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { CourseImageService } from './course-image.service.js';
import { fetchImage, ImageFetchError, type ImageFetcherOptions } from './image-fetcher.js';
import { MediaError, processCourseImage } from './image-processor.js';
import { MEDIA_CSV_ACTOR } from './media.constants.js';

/** Test seam: transport and resolver of the fetch. */
export const MEDIA_FETCH_OPTIONS = Symbol('MEDIA_FETCH_OPTIONS');

export type FetchOutcome = 'set' | 'unchanged' | 'failed' | 'skipped';

/**
 * Worker side of CSV `image_url` (template 1.3, decision 27): fetch with the SSRF
 * guard of {@link fetchImage}, re-encode with {@link processCourseImage}, then
 * write every image column at once (alt, decorative and credit of the CSV row
 * only together with the fetched image) and audit `course.image_set` by
 * `system:csv`. On any failure nothing changes on the course and a warning
 * `oecp.media.fetch_failed` (entity course, ext_id = course code, row and column
 * of `courses.csv`) is added to the upload's sync run.
 */
@Injectable()
export class CourseImageFetchService {
  private readonly logger = new Logger(CourseImageFetchService.name);
  private readonly options: ImageFetcherOptions;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly images: CourseImageService,
    config: ConfigService<Env, true>,
    @Optional() @Inject(MEDIA_FETCH_OPTIONS) options?: ImageFetcherOptions,
  ) {
    this.options = {
      allowInsecure: config.get('OECP_ALLOW_INSECURE_PARTNER_HTTP', { infer: true }),
      ...options,
    };
  }

  async run(job: CourseImageFetchJob): Promise<FetchOutcome> {
    const course = await this.db
      .selectFrom('courses')
      .select(['image_source_url', 'deleted_at'])
      .where('id', '=', job.courseId)
      .executeTakeFirst();
    if (!course || course.deleted_at) return 'skipped';
    // Another upload with the same URL got there first.
    if (course.image_source_url === job.url) return 'unchanged';
    try {
      const bytes = await fetchImage(job.url, this.options);
      const image = await processCourseImage(bytes);
      await this.images.set(
        job.courseId,
        image,
        { alt: job.alt, decorative: job.decorative, credit: job.credit, sourceUrl: job.url },
        { sub: MEDIA_CSV_ACTOR, orgId: null },
        { channel: 'csv', sync_run_id: job.syncRunId },
      );
      return 'set';
    } catch (error) {
      const detail = failureDetail(error);
      if (detail === null) this.logger.error(error);
      await this.recordFailure(job, detail ?? 'internal error');
      return 'failed';
    }
  }

  private async recordFailure(job: CourseImageFetchJob, detail: string): Promise<void> {
    this.logger.warn(`Image of ${job.extId} (run ${job.syncRunId}) not set: ${detail}`);
    await this.db
      .insertInto('sync_errors')
      .values({
        sync_run_id: job.syncRunId,
        severity: 'warning',
        code: 'oecp.media.fetch_failed',
        message: `${ERROR_CODES['oecp.media.fetch_failed'].message}: ${detail}`.slice(0, 2000),
        entity_type: 'course',
        ext_id: job.extId,
        file: 'courses',
        row_number: job.row ?? null,
        column_name: 'image_url',
      })
      .execute();
  }
}

/** The message of an expected failure; null for errors that are not about the image. */
function failureDetail(error: unknown): string | null {
  if (error instanceof ImageFetchError) return error.message;
  if (error instanceof MediaError) return `${error.code}: ${error.message}`;
  if (error instanceof HttpException) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
  }
  return null;
}
