// SPDX-License-Identifier: EUPL-1.2
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import {
  COURSE_IMAGE_MAX_BYTES,
  courseImageUploadFields,
  decodeCsvBytes,
  parseCsvText,
} from '@oecp/schemas';
import { type Db, KYSELY } from '../db/db.module.js';
import { CourseImageService, type ImageActor } from '../media/course-image.service.js';
import { MediaError, processCourseImage } from '../media/image-processor.js';
import { type CliOutput, EXIT, type ExitCode, type ImportCourseImagesOptions } from './program.js';

/** `audit_log.actor_sub` of images set by this command. */
export const CLI_IMAGE_ACTOR = 'system:cli';
const cliActor: ImageActor = { sub: CLI_IMAGE_ACTOR, orgId: null };
/** Name of the list in the image folder. */
export const IMAGES_CSV = 'images.csv';
/** Header of `images.csv`; `course_code` and `file` are required, the rest optional. */
export const IMAGES_CSV_COLUMNS = [
  'course_code',
  'file',
  'alt_en',
  'decorative',
  'credit',
] as const;
/** More rows than a CSV upload takes courses. */
const MAX_ROWS = 5_000;

/** One validated line of `images.csv`. */
export interface ImageRow {
  /** Spreadsheet row number (header = 1). */
  row: number;
  courseCode: string;
  file: string;
  alt: Record<string, string>;
  decorative: boolean;
  credit: string | null;
}

/** A line that cannot be used; `courseCode` is empty when the line has none. */
export interface ImageRowError {
  row: number;
  courseCode: string;
  message: string;
}

export interface ParsedImagesCsv {
  rows: ImageRow[];
  rowErrors: ImageRowError[];
  /** Problems of the file as a whole (encoding, structure, header): nothing is processed. */
  fileErrors: string[];
}

/**
 * Parses and validates `images.csv` (UTF-8, comma or semicolon, RFC 4180):
 * `course_code,file,alt_en,decorative,credit`. Alt text, `decorative` and credit
 * follow the web form (`courseImageUploadFields`: English alt required unless
 * `decorative`, ≤ 300 characters each). A repeated course code is an error from
 * its second line on. Pure: no file system, no database.
 */
export function parseImagesCsv(bytes: Uint8Array): ParsedImagesCsv {
  const out: ParsedImagesCsv = { rows: [], rowErrors: [], fileErrors: [] };
  const decoded = decodeCsvBytes(bytes);
  if (decoded.errors.length > 0) {
    out.fileErrors.push(`${IMAGES_CSV} is not valid UTF-8 (save it as "CSV UTF-8")`);
    return out;
  }
  const parsed = parseCsvText(decoded.text, { maxRows: MAX_ROWS, maxCols: 20 });
  for (const e of parsed.errors) {
    out.fileErrors.push(`${IMAGES_CSV}${e.row ? ` row ${e.row}` : ''}: ${e.message}`);
  }
  const allowed = new Set<string>(IMAGES_CSV_COLUMNS);
  const unknown = parsed.header.filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    out.fileErrors.push(
      `${IMAGES_CSV}: unknown column ${unknown.map((n) => `"${n}"`).join(', ')} ` +
        `(expected ${IMAGES_CSV_COLUMNS.join(',')})`,
    );
  }
  for (const required of ['course_code', 'file']) {
    if (!parsed.header.includes(required)) {
      out.fileErrors.push(`${IMAGES_CSV}: the header has no "${required}" column`);
    }
  }
  if (out.fileErrors.length > 0) return out;
  if (parsed.rows.length === 0) {
    out.fileErrors.push(`${IMAGES_CSV} has a header but no rows`);
    return out;
  }

  const seen = new Set<string>();
  parsed.rows.forEach((cells, index) => {
    const row = parsed.rowNumbers[index] ?? index + 2;
    const courseCode = (cells['course_code'] ?? '').trim();
    const file = (cells['file'] ?? '').trim();
    const fail = (message: string) => out.rowErrors.push({ row, courseCode, message });
    if (!courseCode) return fail('course_code is empty');
    if (!file) return fail('file is empty');
    if (seen.has(courseCode)) return fail('course_code appears twice in the file');
    seen.add(courseCode);

    const decorative = (cells['decorative'] ?? '').trim().toLowerCase();
    if (decorative !== '' && decorative !== 'true' && decorative !== 'false') {
      return fail('decorative must be true or false');
    }
    const fields = courseImageUploadFields.safeParse({
      ...(cells['alt_en'] ? { alt_en: cells['alt_en'] } : {}),
      ...(decorative ? { decorative } : {}),
      ...(cells['credit'] ? { credit: cells['credit'] } : {}),
    });
    if (!fields.success) {
      const issue = fields.error.issues[0];
      const column = String(issue?.path[0] ?? 'alt_en');
      return fail(
        issue?.message === 'oecp.media.alt_required'
          ? 'alt_en is required unless decorative is true'
          : `${column}: ${issue?.message ?? 'invalid'}`,
      );
    }
    out.rows.push({ row, courseCode, file, ...fields.data });
  });
  return out;
}

type Outcome = 'set' | 'replaced' | 'unchanged' | 'error';

interface Report {
  /** Spreadsheet row of `images.csv`; reports are printed in file order. */
  row: number;
  outcome: Outcome;
  code: string;
  message: string;
}

/**
 * `oecp import-course-images --org <slug> --dir <dir> [--dry-run]`: sets course
 * images from a local folder with an `images.csv`, through the same
 * {@link processCourseImage} and {@link CourseImageService.set} as the web form
 * (decision 27: ≤ 5 MiB, JPEG/PNG/WebP sniffed, ≤ 40 MP, WebP lg/sm, metadata
 * stripped, one `course.image_set` audit row by `system:cli`). Courses are those
 * of the organization itself, by course code (`ext_id`), as in a CSV upload.
 * Idempotent: an image with the same content key and the same English alt,
 * decorative flag and credit is `unchanged`. A bad line is reported and the
 * others go on; the exit code is 1 if any line failed.
 */
@Injectable()
export class ImportCourseImagesCommand {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly images: CourseImageService,
  ) {}

  async run(options: ImportCourseImagesOptions, output: CliOutput): Promise<ExitCode> {
    const organization = await this.db
      .selectFrom('organizations')
      .select(['id', 'slug'])
      .where('slug', '=', options.org)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!organization) {
      output.writeErr(
        `Organization "${options.org}" not found; run "oecp seed-organizations" first.\n`,
      );
      return EXIT.FAILURE;
    }

    let root: string;
    let bytes: Buffer;
    try {
      root = await realpath(options.dir);
      if (!(await stat(root)).isDirectory()) throw new Error('not a directory');
    } catch (error) {
      output.writeErr(`Cannot read folder ${options.dir}: ${(error as Error).message}\n`);
      return EXIT.FAILURE;
    }
    try {
      bytes = await readFile(join(root, IMAGES_CSV));
    } catch (error) {
      output.writeErr(
        `Cannot read ${IMAGES_CSV} in ${options.dir}: ${(error as Error).message}\n` +
          `Expected header: ${IMAGES_CSV_COLUMNS.join(',')}\n`,
      );
      return EXIT.FAILURE;
    }
    const parsed = parseImagesCsv(bytes);
    if (parsed.fileErrors.length > 0) {
      output.writeErr(`Invalid ${IMAGES_CSV}:\n`);
      for (const message of parsed.fileErrors) output.writeErr(`  ${message}\n`);
      return EXIT.FAILURE;
    }

    const reports: Report[] = parsed.rowErrors.map((e) => ({
      row: e.row,
      outcome: 'error',
      code: e.courseCode || '-',
      message: `row ${e.row}: ${e.message}`,
    }));
    for (const row of parsed.rows) {
      reports.push(await this.importRow(organization.id, root, row, options.dryRun));
    }
    reports.sort((a, b) => a.row - b.row);

    const count = (outcome: Outcome) => reports.filter((r) => r.outcome === outcome).length;
    const errors = count('error');
    for (const r of reports) output.writeOut(this.line(r, options.dryRun));
    const [set, replaced, unchanged] = [count('set'), count('replaced'), count('unchanged')];
    output.writeOut(
      options.dryRun
        ? `dry run: ${reports.length} rows checked (would set ${set}, would replace ${replaced}, ` +
            `unchanged ${unchanged}, errors ${errors}), nothing written\n`
        : `images: ${reports.length} rows (set ${set}, replaced ${replaced}, ` +
            `unchanged ${unchanged}, errors ${errors})\n`,
    );
    return errors > 0 ? EXIT.FAILURE : EXIT.OK;
  }

  private line(r: Report, dryRun: boolean): string {
    const label =
      dryRun && r.outcome !== 'unchanged' && r.outcome !== 'error'
        ? `would ${r.outcome === 'set' ? 'set' : 'replace'}`
        : r.outcome;
    return `${label.padEnd(13)}  ${r.code}  ${r.message}\n`;
  }

  private async importRow(
    organizationId: string,
    root: string,
    row: ImageRow,
    dryRun: boolean,
  ): Promise<Report> {
    const error = (message: string): Report => ({
      row: row.row,
      outcome: 'error',
      code: row.courseCode,
      message: `row ${row.row}: ${message}`,
    });
    try {
      const course = await this.db
        .selectFrom('courses')
        .select(['id', 'image_key', 'image_alt', 'image_decorative', 'image_credit'])
        .where('organization_id', '=', organizationId)
        .where('ext_id', '=', row.courseCode)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!course) return error('no such course in the organization');

      const path = await this.imagePath(root, row.file);
      if (typeof path !== 'string') return error(path.error);
      const info = await stat(path);
      if (info.size > COURSE_IMAGE_MAX_BYTES) {
        return error(`oecp.media.too_large: ${info.size} bytes`);
      }
      const image = await processCourseImage(await readFile(path));

      const same =
        course.image_key === image.key &&
        course.image_decorative === row.decorative &&
        (course.image_alt?.['en'] ?? '') === (row.alt['en'] ?? '') &&
        course.image_credit === row.credit;
      if (same) {
        return {
          row: row.row,
          outcome: 'unchanged',
          code: row.courseCode,
          message: `key ${image.key}`,
        };
      }
      const outcome: Outcome = course.image_key ? 'replaced' : 'set';
      if (!dryRun) {
        await this.images.set(
          course.id,
          image,
          { alt: row.alt, decorative: row.decorative, credit: row.credit, sourceUrl: null },
          cliActor,
          { channel: 'cli', command: 'import-course-images' },
        );
      }
      return {
        row: row.row,
        outcome,
        code: row.courseCode,
        message: `${row.file} -> key ${image.key} (${image.width}x${image.height})`,
      };
    } catch (e) {
      if (e instanceof MediaError) return error(`${e.code}: ${e.message}`);
      return error(e instanceof Error ? e.message : String(e));
    }
  }

  /** The real path of `file` inside `root`; an error when it is absent or leaves the folder. */
  private async imagePath(root: string, file: string): Promise<string | { error: string }> {
    if (isAbsolute(file)) return { error: `file "${file}" must be relative to the folder` };
    let path: string;
    try {
      path = await realpath(resolve(root, file));
    } catch {
      return { error: `file "${file}" not found` };
    }
    const rel = relative(root, path);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return { error: `file "${file}" is outside the folder` };
    }
    if (!(await stat(path)).isFile()) return { error: `"${file}" is not a file` };
    return path;
  }
}
