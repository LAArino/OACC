// SPDX-License-Identifier: EUPL-1.2
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CsvFileKind } from '@oecp/schemas';
import type { Env } from '../../config/env.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^${UUID}/${UUID}$`);
const UUID_ONLY = new RegExp(`^${UUID}$`);

/**
 * Raw upload files under `OECP_UPLOADS_DIR` (spec §6.3, §10): one directory per
 * upload, object key `<orgId>/<uploadId>` (stored in `sync_runs.upload_object_key`),
 * holding `courses.csv` and/or `offerings.csv`. Keys are validated (UUIDs only),
 * so no path can leave the root.
 */
@Injectable()
export class UploadStorage {
  readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('OECP_UPLOADS_DIR', { infer: true }));
  }

  static key(organizationId: string, uploadId: string): string {
    const key = `${organizationId.toLowerCase()}/${uploadId.toLowerCase()}`;
    if (!KEY.test(key)) throw new Error('Invalid upload key');
    return key;
  }

  async write(key: string, kind: CsvFileKind, bytes: Uint8Array): Promise<void> {
    const dir = this.dir(key);
    await mkdir(dir, { recursive: true, mode: 0o750 });
    await writeFile(join(dir, `${kind}.csv`), bytes, { flag: 'wx', mode: 0o640 });
  }

  /** The file, or null when the upload has no such file. */
  async read(key: string, kind: CsvFileKind): Promise<Buffer | null> {
    try {
      return await readFile(join(this.dir(key), `${kind}.csv`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Deletes the upload directory (and the organization directory once empty). */
  async remove(key: string): Promise<void> {
    const dir = this.dir(key);
    await rm(dir, { recursive: true, force: true });
    await rmdir(join(dir, '..')).catch(() => undefined);
  }

  /**
   * Deletes upload directories last modified before `cutoff` that no database row
   * references (e.g. a crash between writing the files and committing the run).
   */
  async sweep(cutoff: Date, isReferenced: (key: string) => boolean): Promise<string[]> {
    const removed: string[] = [];
    let organizations: string[];
    try {
      organizations = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return removed;
      throw error;
    }
    for (const organization of organizations.filter((n) => UUID_ONLY.test(n))) {
      for (const upload of (await readdir(join(this.root, organization)).catch(() => [])).filter(
        (n) => UUID_ONLY.test(n),
      )) {
        const key = `${organization}/${upload}`;
        const info = await stat(this.dir(key)).catch(() => null);
        if (info && info.mtime < cutoff && !isReferenced(key)) {
          await this.remove(key);
          removed.push(key);
        }
      }
    }
    return removed;
  }

  private dir(key: string): string {
    if (!KEY.test(key)) throw new Error('Invalid upload key');
    return join(this.root, ...key.split('/'));
  }
}
