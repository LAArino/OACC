// SPDX-License-Identifier: EUPL-1.2
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COURSE_IMAGE_FILE_PATTERN,
  COURSE_IMAGE_KEY_PATTERN,
  COURSE_IMAGE_VARIANTS,
  type CourseImageVariant,
} from '@oecp/schemas';
import type { Env } from '../config/env.js';
import type { ProcessedImage } from './image-processor.js';

const COURSE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VARIANTS = Object.keys(COURSE_IMAGE_VARIANTS) as CourseImageVariant[];

/** A stored file, for streaming. */
export interface StoredMediaFile {
  path: string;
  size: number;
  mtime: Date;
}

/**
 * Course image files (decision 27) under `${OECP_UPLOADS_DIR}/media/courses/<courseId>/`:
 * `<key>.lg.webp` and `<key>.sm.webp`. Course ids (lower-case UUIDs), keys and
 * file names are validated, so no path can leave the root. Writes are atomic: a
 * temporary file in the same directory, then rename.
 */
@Injectable()
export class CourseMediaStorage {
  readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('OECP_UPLOADS_DIR', { infer: true }), 'media', 'courses');
  }

  /** Writes both files of an image (replacing identical ones of the same key). */
  async write(courseId: string, image: ProcessedImage): Promise<void> {
    const dir = this.dir(courseId);
    key(image.key);
    await mkdir(dir, { recursive: true, mode: 0o750 });
    for (const variant of VARIANTS) {
      const target = join(dir, `${image.key}.${variant}.webp`);
      const temp = join(dir, `.${image.key}.${variant}.${randomUUID()}.tmp`);
      try {
        await writeFile(temp, image.files[variant], { flag: 'wx', mode: 0o640 });
        await rename(temp, target);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
    }
  }

  /** Deletes both files of `imageKey` (missing files are ignored). */
  async removeImage(courseId: string, imageKey: string): Promise<void> {
    const dir = this.dir(courseId);
    key(imageKey);
    for (const variant of VARIANTS) {
      await rm(join(dir, `${imageKey}.${variant}.webp`), { force: true });
    }
    await rmdir(dir).catch(() => undefined); // only when empty
  }

  /** Deletes the course's directory (hard delete of the course by the retention job). */
  async removeCourse(courseId: string): Promise<void> {
    await rm(this.dir(courseId), { recursive: true, force: true });
  }

  /** The file `<key>.<lg|sm>.webp` of a course, or null when the name is invalid or absent. */
  async file(courseId: string, file: string): Promise<StoredMediaFile | null> {
    const id = courseId.toLowerCase();
    if (!COURSE_ID.test(id) || !COURSE_IMAGE_FILE_PATTERN.test(file)) return null;
    const path = join(this.root, id, file);
    try {
      const info = await stat(path);
      return info.isFile() ? { path, size: info.size, mtime: info.mtime } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private dir(courseId: string): string {
    const id = courseId.toLowerCase();
    if (!COURSE_ID.test(id)) throw new Error('Invalid course id');
    return join(this.root, id);
  }
}

function key(value: string): void {
  if (!COURSE_IMAGE_KEY_PATTERN.test(value)) throw new Error('Invalid image key');
}
