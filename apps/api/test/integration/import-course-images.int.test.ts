// SPDX-License-Identifier: EUPL-1.2
// `oecp import-course-images` (decision 27): images from a local folder, through
// the same pipeline as the web form.
import 'reflect-metadata';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportCourseImagesCommand } from '../../src/cli/import-course-images.js';
import { type CliOutput, EXIT } from '../../src/cli/program.js';
import { CourseImageService } from '../../src/media/course-image.service.js';
import { CourseMediaStorage } from '../../src/media/course-media.storage.js';
import { configStub } from '../support/config-stub.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

describe.runIf(describeWithDatabase === 'run')('oecp import-course-images (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let uploadsDir: string;
  let folders: string;
  let command: ImportCourseImagesCommand;
  const ids: Record<string, string> = {};

  async function course(extId: string, org: string = ORG.urv) {
    // One transaction: a published course needs its English text (deferred check).
    return tdb.db.transaction().execute(async (trx) => {
      const { id } = await trx
        .insertInto('courses')
        .values({
          organization_id: org,
          ext_id: extId,
          source_channel: 'form',
          status: 'published',
          ects: 5,
          level: 'master',
          levels: ['master'],
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('course_texts')
        .values({ course_id: id, lang: 'en', title: `Course ${extId}` })
        .execute();
      return id;
    });
  }

  /** A folder with the given files (name → bytes or text). */
  function folder(name: string, content: Record<string, Buffer | string>): string {
    const dir = join(folders, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, data] of Object.entries(content)) writeFileSync(join(dir, file), data);
    return dir;
  }

  async function run(dir: string, dryRun = false, org = 'urv') {
    const out: string[] = [];
    const err: string[] = [];
    const output: CliOutput = {
      writeOut: (t) => void out.push(t),
      writeErr: (t) => void err.push(t),
    };
    const code = await command.run({ org, dir, dryRun }, output);
    return { code, out: out.join(''), err: err.join('') };
  }

  const imageRow = (extId: string) =>
    tdb.db
      .selectFrom('courses')
      .select([
        'image_key',
        'image_alt',
        'image_decorative',
        'image_credit',
        'image_width',
        'image_height',
        'image_source_url',
        'image_updated_at',
      ])
      .where('id', '=', ids[extId] as string)
      .executeTakeFirstOrThrow();

  const mediaFiles = (extId: string) => {
    const dir = join(uploadsDir, 'media', 'courses', ids[extId] as string);
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  };

  const audit = (extId: string) =>
    tdb.db
      .selectFrom('audit_log')
      .select(['actor_sub', 'actor_org_id', 'action', 'changes'])
      .where('entity_id', '=', ids[extId] as string)
      .where('action', 'like', 'course.image%')
      .orderBy('id')
      .execute();

  const png = (width: number, height: number, background = '#2a6f97') =>
    sharp({ create: { width, height, channels: 3, background } })
      .png()
      .toBuffer();
  const jpeg = (width: number, height: number, background = '#c1121f') =>
    sharp({ create: { width, height, channels: 3, background } })
      .jpeg()
      .toBuffer();

  const CSV =
    'course_code,file,alt_en,decorative,credit\n' +
    'CLI-A,a.png,"A blue lecture hall, seen from the back",,"Photo: A. Smith"\n' +
    'CLI-B,sub/b.jpg,,true,\n';

  beforeAll(async () => {
    tdb = await createTestDatabase();
    uploadsDir = mkdtempSync(join(tmpdir(), 'oecp-cli-images-'));
    folders = mkdtempSync(join(tmpdir(), 'oecp-cli-folders-'));
    const storage = new CourseMediaStorage(configStub({ OECP_UPLOADS_DIR: uploadsDir }));
    command = new ImportCourseImagesCommand(tdb.db, new CourseImageService(tdb.db, storage));
    ids['CLI-A'] = await course('CLI-A');
    ids['CLI-B'] = await course('CLI-B');
    ids['CLI-U'] = await course('CLI-U', ORG.uibk);
  });

  afterAll(async () => {
    await tdb?.drop();
    for (const dir of [uploadsDir, folders]) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('dry run validates and writes nothing', async () => {
    const dir = folder('dry', { 'images.csv': CSV, 'a.png': await png(300, 200) });
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.jpg'), await jpeg(200, 300));

    const result = await run(dir, true);
    expect(result.err).toBe('');
    expect(result.code).toBe(EXIT.OK);
    expect(result.out).toMatch(/^would set\s+CLI-A\s+a\.png -> key [0-9a-f]{16} \(300x200\)$/m);
    expect(result.out).toMatch(/^would set\s+CLI-B\s+/m);
    expect(result.out).toContain('dry run: 2 rows checked (would set 2, would replace 0');
    expect((await imageRow('CLI-A')).image_key).toBeNull();
    expect(mediaFiles('CLI-A')).toEqual([]);
    expect(await audit('CLI-A')).toEqual([]);
  });

  it('sets the images with the form pipeline and audits them as system:cli', async () => {
    const dir = join(folders, 'dry');
    const result = await run(dir);
    expect(result.code).toBe(EXIT.OK);
    expect(result.out).toMatch(/^set\s+CLI-A\s+a\.png -> key [0-9a-f]{16} \(300x200\)$/m);
    expect(result.out).toMatch(/^set\s+CLI-B\s+sub\/b\.jpg -> key [0-9a-f]{16} \(200x300\)$/m);
    expect(result.out).toContain('images: 2 rows (set 2, replaced 0, unchanged 0, errors 0)');

    const a = await imageRow('CLI-A');
    expect(a).toMatchObject({
      image_alt: { en: 'A blue lecture hall, seen from the back' },
      image_decorative: false,
      image_credit: 'Photo: A. Smith',
      image_width: 300,
      image_height: 200,
      image_source_url: null,
    });
    expect(a.image_key).toMatch(/^[0-9a-f]{16}$/);
    expect(a.image_updated_at).not.toBeNull();
    expect(mediaFiles('CLI-A')).toEqual([`${a.image_key}.lg.webp`, `${a.image_key}.sm.webp`]);
    const b = await imageRow('CLI-B');
    expect(b).toMatchObject({ image_alt: {}, image_decorative: true, image_credit: null });
    expect(mediaFiles('CLI-B')).toHaveLength(2);

    const rows = await audit('CLI-A');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_sub: 'system:cli',
      actor_org_id: null,
      action: 'course.image_set',
      changes: {
        organization_id: ORG.urv,
        ext_id: 'CLI-A',
        key: a.image_key,
        previous_key: null,
        width: 300,
        height: 200,
        decorative: false,
        alt_languages: ['en'],
        credit: true,
        source_url: null,
        channel: 'cli',
        command: 'import-course-images',
      },
    });
    // Never the credit text.
    expect(JSON.stringify(rows[0]?.changes)).not.toContain('Smith');
  });

  it('is idempotent: a second run reports unchanged and changes nothing', async () => {
    const before = await imageRow('CLI-A');
    const result = await run(join(folders, 'dry'));
    expect(result.code).toBe(EXIT.OK);
    expect(result.out).toMatch(/^unchanged\s+CLI-A\s+key /m);
    expect(result.out).toMatch(/^unchanged\s+CLI-B\s+key /m);
    expect(result.out).toContain('images: 2 rows (set 0, replaced 0, unchanged 2, errors 0)');
    expect(await imageRow('CLI-A')).toEqual(before);
    expect(await audit('CLI-A')).toHaveLength(1);
    expect(await audit('CLI-B')).toHaveLength(1);
  });

  it('replaces when the content or the metadata changes (dry run first)', async () => {
    const previous = (await imageRow('CLI-A')).image_key;
    const dir = folder('replace', {
      'images.csv':
        'course_code,file,alt_en,decorative,credit\n' +
        'CLI-A,new.png,A red hall,false,\n' +
        'CLI-B,b.jpg,,true,Photo: B. Jones\n',
      'new.png': await png(400, 400, '#ff0000'),
    });
    // CLI-B: same picture as before, only the credit differs.
    writeFileSync(join(dir, 'b.jpg'), await jpeg(200, 300));

    const dry = await run(dir, true);
    expect(dry.out).toMatch(/^would replace\s+CLI-A\s+/m);
    expect(dry.out).toMatch(/^would replace\s+CLI-B\s+/m);
    expect((await imageRow('CLI-A')).image_key).toBe(previous);

    const result = await run(dir);
    expect(result.code).toBe(EXIT.OK);
    expect(result.out).toMatch(/^replaced\s+CLI-A\s+/m);
    expect(result.out).toMatch(/^replaced\s+CLI-B\s+/m);
    const a = await imageRow('CLI-A');
    expect(a.image_key).not.toBe(previous);
    expect(a).toMatchObject({ image_alt: { en: 'A red hall' }, image_credit: null });
    // The previous files are gone, the new ones are there.
    expect(mediaFiles('CLI-A')).toEqual([`${a.image_key}.lg.webp`, `${a.image_key}.sm.webp`]);
    expect((await imageRow('CLI-B')).image_credit).toBe('Photo: B. Jones');
    const rows = await audit('CLI-A');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.changes).toMatchObject({ previous_key: previous, key: a.image_key });
  });

  it('reports each failing line, goes on with the others and exits 1', async () => {
    const dir = folder('errors', {
      'images.csv':
        'course_code,file,alt_en,decorative,credit\n' +
        'CLI-NOPE,a.png,Alt,,\n' + // unknown code
        'CLI-U,a.png,Alt,,\n' + // course of another organization
        'CLI-A,missing.png,Alt,,\n' + // missing file
        'CLI-E,../escape.png,Alt,,\n' + // outside the folder
        'CLI-B,notimage.png,Alt,,\n' + // not an image
        ',a.png,Alt,,\n' + // no code
        'CLI-C,a.png,,,\n' + // no alt
        'CLI-OK,a.png,Fine,,\n',
      'a.png': await png(100, 100, '#00ff00'),
      'notimage.png': 'this is not an image',
    });
    writeFileSync(join(folders, 'escape.png'), await png(10, 10));
    ids['CLI-OK'] = await course('CLI-OK');
    ids['CLI-C'] = await course('CLI-C');
    ids['CLI-E'] = await course('CLI-E');
    const before = await imageRow('CLI-B');

    const result = await run(dir);
    expect(result.code).toBe(EXIT.FAILURE);
    const lines = result.out.trim().split('\n');
    expect(lines).toHaveLength(9);
    expect(lines[0]).toMatch(/^error\s+CLI-NOPE\s+row 2: no such course in the organization$/);
    expect(lines[1]).toMatch(/^error\s+CLI-U\s+row 3: no such course in the organization$/);
    expect(lines[2]).toMatch(/^error\s+CLI-A\s+row 4: file "missing\.png" not found$/);
    expect(lines[3]).toMatch(/^error\s+CLI-E\s+row 5: .*"\.\.\/escape\.png".* outside the folder$/);
    expect(lines[4]).toMatch(/^error\s+CLI-B\s+row 6: oecp\.media\.unsupported_type:/);
    expect(lines[5]).toMatch(/^error\s+-\s+row 7: course_code is empty$/);
    expect(lines[6]).toMatch(/^error\s+CLI-C\s+row 8: alt_en is required/);
    expect(lines[7]).toMatch(/^set\s+CLI-OK\s+/);
    expect(lines[8]).toBe('images: 8 rows (set 1, replaced 0, unchanged 0, errors 7)');
    // Failed lines changed nothing; the valid one was written.
    expect(await imageRow('CLI-B')).toEqual(before);
    expect((await imageRow('CLI-OK')).image_key).not.toBeNull();
    expect((await imageRow('CLI-C')).image_key).toBeNull();
    expect((await imageRow('CLI-U')).image_key).toBeNull();
  });

  it('refuses an unknown organization, a missing folder or images.csv, and a bad header', async () => {
    const dir = join(folders, 'dry');
    const unknown = await run(dir, true, 'nowhere');
    expect(unknown.code).toBe(EXIT.FAILURE);
    expect(unknown.err).toContain('Organization "nowhere" not found');

    const noFolder = await run(join(folders, 'absent'), true);
    expect(noFolder.code).toBe(EXIT.FAILURE);
    expect(noFolder.err).toContain('Cannot read folder');

    const noCsv = await run(folder('no-csv', { 'CLI-A.png': await png(10, 10) }), true);
    expect(noCsv.code).toBe(EXIT.FAILURE);
    expect(noCsv.err).toContain('images.csv');
    expect(noCsv.err).toContain('course_code,file,alt_en,decorative,credit');

    const badHeader = await run(
      folder('bad-header', { 'images.csv': 'code,image\nCLI-A,a.png\n' }),
      true,
    );
    expect(badHeader.code).toBe(EXIT.FAILURE);
    expect(badHeader.err).toContain('unknown column "code"');
    expect(badHeader.out).toBe('');
  });
});
