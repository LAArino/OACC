// SPDX-License-Identifier: EUPL-1.2
// Course images (decision 27): re-encoding, file storage and the anonymous /media route.
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { CourseMediaStorage } from '../../src/media/course-media.storage.js';
import { MediaError, processCourseImage } from '../../src/media/image-processor.js';
import { MEDIA_CACHE, MediaController } from '../../src/media/media.controller.js';
import { configStub } from '../support/config-stub.js';

const COURSE = '0c000000-0000-4000-8000-000000000001';

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#2a6f97' } })
    .png({ compressionLevel: 1 })
    .toBuffer();

async function refusal(input: Buffer): Promise<MediaError> {
  try {
    await processCourseImage(input);
  } catch (error) {
    if (error instanceof MediaError) return error;
    throw error;
  }
  throw new Error('accepted');
}

describe('processCourseImage', () => {
  it('re-encodes to WebP lg (≤ 1600) and sm (≤ 640), keeps the ratio, key = SHA-256 of lg', async () => {
    const image = await processCourseImage(await png(3000, 1500));
    expect(image).toMatchObject({ width: 1600, height: 800 });
    expect(image.key).toBe(createHash('sha256').update(image.files.lg).digest('hex').slice(0, 16));
    const lg = await sharp(image.files.lg).metadata();
    const sm = await sharp(image.files.sm).metadata();
    expect([lg.format, lg.width, lg.height]).toEqual(['webp', 1600, 800]);
    expect([sm.format, sm.width, sm.height]).toEqual(['webp', 640, 320]);
  });

  it('never upscales', async () => {
    const image = await processCourseImage(await png(320, 200));
    expect([image.width, image.height]).toEqual([320, 200]);
    expect((await sharp(image.files.sm).metadata()).width).toBe(320);
  });

  it('applies the EXIF orientation, then strips every metadata', async () => {
    const jpeg = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#fff' },
    })
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { Artist: 'Jane Doe', Copyright: 'Example' } },
      })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const image = await processCourseImage(jpeg);
    expect([image.width, image.height]).toEqual([200, 400]);
    const out = await sharp(image.files.lg).metadata();
    expect(out.exif).toBeUndefined();
    expect(out.icc).toBeUndefined();
    expect(out.xmp).toBeUndefined();
    expect(out.orientation).toBeUndefined();
  });

  it('accepts WebP input and sniffs the format from the bytes', async () => {
    const webp = await sharp(await png(50, 50))
      .webp()
      .toBuffer();
    await expect(processCourseImage(webp)).resolves.toMatchObject({ width: 50, height: 50 });
  });

  it.each([
    [
      'GIF',
      () =>
        sharp(Buffer.alloc(8 * 8 * 3, 255), { raw: { width: 8, height: 8, channels: 3 } })
          .gif()
          .toBuffer(),
    ],
    ['text', async () => Buffer.from('<html>not an image</html>')],
    [
      'SVG',
      async () =>
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
    ],
  ])('refuses %s with oecp.media.unsupported_type (415)', async (_name, make) => {
    const error = await refusal(await make());
    expect([error.code, error.status]).toEqual(['oecp.media.unsupported_type', 415]);
  });

  it('refuses a truncated image with oecp.media.invalid_image (422)', async () => {
    const full = await sharp({
      create: {
        width: 600,
        height: 400,
        channels: 3,
        background: '#000',
        noise: { type: 'gaussian', mean: 128, sigma: 30 },
      },
    })
      .png()
      .toBuffer();
    const error = await refusal(full.subarray(0, Math.floor(full.length / 2)));
    expect([error.code, error.status]).toEqual(['oecp.media.invalid_image', 422]);
  });

  it('refuses more than 40 megapixels and more than 5 MiB', async () => {
    const huge = await sharp({
      create: { width: 8000, height: 5001, channels: 3, background: '#000' },
    })
      .jpeg({ quality: 10 })
      .toBuffer();
    const pixels = await refusal(huge);
    expect([pixels.code, pixels.status]).toEqual(['oecp.media.invalid_image', 422]);
    const big = await refusal(Buffer.alloc(5 * 1024 * 1024 + 1));
    expect([big.code, big.status]).toEqual(['oecp.media.too_large', 413]);
  });
});

describe('CourseMediaStorage', () => {
  let dir: string;
  let storage: CourseMediaStorage;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'oecp-media-'));
    storage = new CourseMediaStorage(configStub({ OECP_UPLOADS_DIR: dir }));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes both files atomically under media/courses/<id>/ and removes them', async () => {
    const image = await processCourseImage(await png(800, 600));
    await storage.write(COURSE, image);
    const courseDir = join(dir, 'media', 'courses', COURSE);
    expect(readdirSync(courseDir).sort()).toEqual([`${image.key}.lg.webp`, `${image.key}.sm.webp`]);
    expect(statSync(join(courseDir, `${image.key}.lg.webp`)).mode & 0o777).toBe(0o640);
    // Writing the same image again replaces the files in place.
    await storage.write(COURSE, image);
    expect(readdirSync(courseDir)).toHaveLength(2);
    const file = await storage.file(COURSE.toUpperCase(), `${image.key}.sm.webp`);
    expect(file?.size).toBe(image.files.sm.length);

    await storage.removeImage(COURSE, image.key);
    expect(existsSync(courseDir)).toBe(false);
  });

  it('deletes the directory of a course', async () => {
    const image = await processCourseImage(await png(100, 100));
    await storage.write(COURSE, image);
    await storage.removeCourse(COURSE);
    expect(existsSync(join(dir, 'media', 'courses', COURSE))).toBe(false);
    await expect(storage.removeCourse(COURSE)).resolves.toBeUndefined();
  });

  it('validates course ids, keys and file names', async () => {
    await expect(storage.removeCourse('../../etc')).rejects.toThrow('Invalid course id');
    await expect(storage.removeImage(COURSE, '../x')).rejects.toThrow('Invalid image key');
    for (const name of [
      '../0123456789abcdef.lg.webp',
      '0123456789ABCDEF.lg.webp',
      '0123456789abcdef.xl.webp',
      '0123456789abcdef.lg.png',
      '.0123456789abcdef.lg.webp.tmp',
    ]) {
      expect(await storage.file(COURSE, name), name).toBeNull();
    }
    expect(await storage.file('not-a-uuid', '0123456789abcdef.lg.webp')).toBeNull();
    expect(await storage.file(COURSE, '0123456789abcdef.lg.webp')).toBeNull();
  });
});

describe('GET /media/courses/{courseId}/{file}', () => {
  let dir: string;
  let app: INestApplication;
  let key: string;
  let lg: Buffer;

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    dir = mkdtempSync(join(tmpdir(), 'oecp-media-http-'));
    const storage = new CourseMediaStorage(configStub({ OECP_UPLOADS_DIR: dir }));
    const image = await processCourseImage(await png(1200, 900));
    await storage.write(COURSE, image);
    key = image.key;
    lg = image.files.lg;
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        { provide: CourseMediaStorage, useValue: storage },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());

  it('streams the file with immutable caching, a weak ETag and no cookies', async () => {
    const response = await http()
      .get(`/media/courses/${COURSE}/${key}.lg.webp`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['cache-control']).toBe(MEDIA_CACHE);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers['etag']).toBe(`W/"${key}.lg"`);
    expect(response.headers['content-length']).toBe(String(lg.length));
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(Buffer.compare(response.body as Buffer, lg)).toBe(0);
  });

  it('answers HEAD without a body and If-None-Match with 304', async () => {
    const head = await http().head(`/media/courses/${COURSE}/${key}.sm.webp`).expect(200);
    expect(head.headers['content-type']).toBe('image/webp');
    expect(head.text ?? '').toBe('');
    await http()
      .get(`/media/courses/${COURSE}/${key}.sm.webp`)
      .set('If-None-Match', `W/"${key}.sm"`)
      .expect(304);
    await http()
      .get(`/media/courses/${COURSE}/${key}.sm.webp`)
      .set('If-None-Match', `"${key}.sm"`)
      .expect(304);
  });

  it.each([
    `/media/courses/${COURSE}/0123456789abcdef.lg.webp`,
    `/media/courses/0c000000-0000-4000-8000-000000000002/KEY.lg.webp`,
    `/media/courses/not-a-uuid/0123456789abcdef.lg.webp`,
    `/media/courses/${COURSE}/..%2F..%2Fsecret.lg.webp`,
    `/media/courses/${COURSE}/0123456789abcdef.lg.png`,
  ])('404 problem for %s', async (path) => {
    const response = await http().get(path).expect(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.headers['cache-control']).toBeUndefined();
  });
});
