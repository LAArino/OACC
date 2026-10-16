// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type CourseImage,
  courseImageAltSatisfied,
  type CourseImagePatchValue,
} from '@oecp/schemas';
import type { Transaction } from 'kysely';
import { ProblemException } from '../common/problem.js';
import type { Database } from '../db/database.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { CourseMediaStorage } from './course-media.storage.js';
import type { ProcessedImage } from './image-processor.js';

export const MEDIA_CLOCK = Symbol('MEDIA_CLOCK');

type Trx = Transaction<Database>;

/** Who changes an image: an administrator (`sub`, organization) or `system:csv`. */
export interface ImageActor {
  sub: string;
  orgId: string | null;
}

/** Metadata stored together with a new image. */
export interface ImageMetadata {
  alt: Record<string, string>;
  decorative: boolean;
  credit: string | null;
  /** The CSV `image_url` it was fetched from; null for an upload. */
  sourceUrl: string | null;
}

/** The image columns of `courses` (migration 0008). */
export interface CourseImageColumns {
  image_key: string | null;
  image_alt: Record<string, string>;
  image_decorative: boolean;
  image_credit: string | null;
  image_width: number | null;
  image_height: number | null;
  image_source_url: string | null;
  image_updated_at: Date | string | null;
}

export const IMAGE_COLUMNS = [
  'image_key',
  'image_alt',
  'image_decorative',
  'image_credit',
  'image_width',
  'image_height',
  'image_source_url',
  'image_updated_at',
] as const;

/** The admin `courseImage` of a course row; null when the course has no image. */
export function courseImageFromRow(row: CourseImageColumns): CourseImage | null {
  if (!row.image_key || !row.image_width || !row.image_height || !row.image_updated_at) {
    return null;
  }
  return {
    key: row.image_key,
    alt: row.image_alt ?? {},
    decorative: row.image_decorative,
    credit: row.image_credit,
    width: row.image_width,
    height: row.image_height,
    source_url: row.image_source_url,
    updated_at: new Date(row.image_updated_at).toISOString(),
  };
}

/** Image columns reset (no image). */
const NO_IMAGE = {
  image_key: null,
  image_alt: {},
  image_decorative: false,
  image_credit: null,
  image_width: null,
  image_height: null,
  image_source_url: null,
  image_updated_at: null,
} as const;

/**
 * The image of a course (decision 27): files through {@link CourseMediaStorage},
 * columns of migration 0008, one audit row per change (`course.image_set`,
 * `course.image_removed`; never file content, never the credit text). Shared by
 * the admin API (form) and the worker's CSV `image_url` fetch. The new files are
 * written before the row is updated and the previous ones deleted after the
 * commit, so the row never points at a missing file.
 */
@Injectable()
export class CourseImageService {
  private readonly logger = new Logger(CourseImageService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly storage: CourseMediaStorage,
    @Optional() @Inject(MEDIA_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  /** The image of a course that is not deleted; undefined when there is no such course. */
  async get(courseId: string): Promise<CourseImage | null | undefined> {
    const row = await this.db
      .selectFrom('courses')
      .select([...IMAGE_COLUMNS])
      .where('id', '=', courseId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row && courseImageFromRow(row);
  }

  /**
   * Stores a new image with its metadata, replacing the previous one. 422
   * `oecp.media.alt_required` when neither decorative nor English alt; 404 when the
   * course does not exist (or is deleted).
   */
  async set(
    courseId: string,
    image: ProcessedImage,
    meta: ImageMetadata,
    actor: ImageActor,
    audit: Record<string, unknown> = {},
  ): Promise<CourseImage> {
    if (!courseImageAltSatisfied(meta)) {
      throw new ProblemException(422, 'oecp.media.alt_required');
    }
    await this.storage.write(courseId, image);
    // `undefined` until the row is read: the current files are never deleted on failure.
    const state: { previous: string | null | undefined } = { previous: undefined };
    try {
      const saved = await this.db.transaction().execute(async (trx) => {
        const before = await this.lock(trx, courseId);
        state.previous = before.image_key;
        const at = this.now();
        const row = await trx
          .updateTable('courses')
          .set({
            image_key: image.key,
            image_alt: meta.alt,
            image_decorative: meta.decorative,
            image_credit: meta.credit,
            image_width: image.width,
            image_height: image.height,
            image_source_url: meta.sourceUrl,
            image_updated_at: at,
          })
          .where('id', '=', courseId)
          .returning([...IMAGE_COLUMNS])
          .executeTakeFirstOrThrow();
        await this.audit(trx, actor, 'course.image_set', courseId, {
          organization_id: before.organization_id,
          ext_id: before.ext_id,
          key: image.key,
          previous_key: before.image_key,
          width: image.width,
          height: image.height,
          decorative: meta.decorative,
          alt_languages: Object.keys(meta.alt).sort(),
          credit: meta.credit !== null,
          source_url: meta.sourceUrl,
          ...audit,
        });
        return courseImageFromRow(row) as CourseImage;
      });
      if (state.previous && state.previous !== image.key) {
        await this.removeFiles(courseId, state.previous);
      }
      return saved;
    } catch (error) {
      // The row was not changed: drop the new files unless they are the current ones
      // (when the row could not be read, keep them unless the course has another image).
      const current =
        state.previous !== undefined
          ? state.previous
          : await this.currentKey(courseId).catch(() => image.key);
      if (current !== image.key) await this.removeFiles(courseId, image.key);
      throw error;
    }
  }

  /** Metadata only. 404 `oecp.media.not_found` without an image; 422 `oecp.media.alt_required`. */
  async patch(
    courseId: string,
    patch: CourseImagePatchValue,
    actor: ImageActor,
  ): Promise<CourseImage> {
    return this.db.transaction().execute(async (trx) => {
      const before = await this.lock(trx, courseId);
      const current = courseImageFromRow(before);
      if (!current) throw new ProblemException(404, 'oecp.media.not_found');
      const next = {
        alt: patch.alt ?? current.alt,
        decorative: patch.decorative ?? current.decorative,
        credit: patch.credit === undefined ? current.credit : patch.credit,
      };
      if (!courseImageAltSatisfied(next)) {
        throw new ProblemException(422, 'oecp.media.alt_required');
      }
      const row = await trx
        .updateTable('courses')
        .set({
          image_alt: next.alt,
          image_decorative: next.decorative,
          image_credit: next.credit,
          image_updated_at: this.now(),
        })
        .where('id', '=', courseId)
        .returning([...IMAGE_COLUMNS])
        .executeTakeFirstOrThrow();
      await this.audit(trx, actor, 'course.image_set', courseId, {
        organization_id: before.organization_id,
        ext_id: before.ext_id,
        channel: 'form',
        key: current.key,
        metadata_only: true,
        fields: Object.keys(patch).sort(),
        decorative: next.decorative,
        alt_languages: Object.keys(next.alt).sort(),
        credit: next.credit !== null,
      });
      return courseImageFromRow(row) as CourseImage;
    });
  }

  /** Removes the image and its files. 404 `oecp.media.not_found` without an image. */
  async remove(courseId: string, actor: ImageActor): Promise<void> {
    const key = await this.db.transaction().execute(async (trx) => {
      const before = await this.lock(trx, courseId);
      if (!before.image_key) throw new ProblemException(404, 'oecp.media.not_found');
      await trx.updateTable('courses').set(NO_IMAGE).where('id', '=', courseId).execute();
      await this.audit(trx, actor, 'course.image_removed', courseId, {
        organization_id: before.organization_id,
        ext_id: before.ext_id,
        channel: 'form',
        key: before.image_key,
      });
      return before.image_key;
    });
    await this.removeFiles(courseId, key);
  }

  private async currentKey(courseId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('courses')
      .select('image_key')
      .where('id', '=', courseId)
      .executeTakeFirst();
    return row?.image_key ?? null;
  }

  private async lock(trx: Trx, courseId: string) {
    const row = await trx
      .selectFrom('courses')
      .select(['id', 'organization_id', 'ext_id', ...IMAGE_COLUMNS])
      .where('id', '=', courseId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new ProblemException(404, 'oecp.request.not_found', 'Course not found');
    return row;
  }

  private async audit(
    trx: Trx,
    actor: ImageActor,
    action: 'course.image_set' | 'course.image_removed',
    courseId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await trx
      .insertInto('audit_log')
      .values({
        actor_sub: actor.sub,
        actor_org_id: actor.orgId,
        action,
        entity_type: 'course',
        entity_id: courseId,
        changes,
      })
      .execute();
  }

  /** File deletion never fails a change that is already committed. */
  private async removeFiles(courseId: string, key: string): Promise<void> {
    try {
      await this.storage.removeImage(courseId, key);
    } catch (error) {
      this.logger.warn(`Image files ${courseId}/${key} not deleted: ${(error as Error).message}`);
    }
  }
}
