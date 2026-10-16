// SPDX-License-Identifier: EUPL-1.2
// Course images (decision 27): migration 0008, the admin endpoints, /media, the
// public card and page, the CSV image_url pipeline, retention and the harvester.
import 'reflect-metadata';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  adminCourse,
  type Course,
  type CourseImageFetchJob,
  courseImage,
  publicCourseDetail,
  validateCsvFiles,
} from '@oecp/schemas';
import { sql } from 'kysely';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';
import {
  KyselyOrganizationDirectory,
  ORGANIZATION_DIRECTORY,
} from '../../src/admin/auth/organization-directory.js';
import {
  CourseImageController,
  CourseImageUploadInterceptor,
} from '../../src/admin/courses/course-image.controller.js';
import { CoursesController } from '../../src/admin/courses/courses.controller.js';
import { CoursesRepository } from '../../src/admin/courses/courses.repository.js';
import { CoursesService } from '../../src/admin/courses/courses.service.js';
import { OrganizationAccess } from '../../src/admin/integrations/organization-access.js';
import { CatalogueRepository } from '../../src/catalogue/catalogue.repository.js';
import { toCourseDetail } from '../../src/catalogue/catalogue.mapper.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { KYSELY } from '../../src/db/db.module.js';
import { CanonicalWriter, HARVESTER_ACTOR } from '../../src/ingestion/canonical-writer.service.js';
import { CsvIngestionService } from '../../src/ingestion/csv/csv-ingestion.service.js';
import { CsvAdapter } from '../../src/ingestion/csv/csv.adapter.js';
import { UploadStorage } from '../../src/ingestion/csv/upload-storage.js';
import { SyncRunsRepository } from '../../src/ingestion/sync-runs.repository.js';
import type { HttpTransport, Resolver } from '../../src/ingestion/oeapi/http-transport.js';
import { maintenanceOptions } from '../../src/maintenance/maintenance.constants.js';
import { RetentionService } from '../../src/maintenance/retention.service.js';
import { CourseImageFetchService } from '../../src/media/course-image-fetch.service.js';
import { CourseImageService } from '../../src/media/course-image.service.js';
import { CourseMediaStorage } from '../../src/media/course-media.storage.js';
import { MediaController } from '../../src/media/media.controller.js';
import { MediaQueue } from '../../src/media/media.queue.js';
import { BASE_CLAIMS, createTestTokens } from '../support/admin-tokens.js';
import { seedAttributeDefinitions } from '../support/attribute-definitions.js';
import { configStub } from '../support/config-stub.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const ALLIANCE_SUB = '22222222-2222-4222-8222-222222222222';
const URV_SUB = '33333333-3333-4333-8333-333333333333';
const BASE = '/api/admin/v1';

const png = (width: number, height: number, background = '#2a6f97') =>
  sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();

describe.runIf(describeWithDatabase === 'run')('Course images (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let app: INestApplication;
  let uploadsDir: string;
  let storage: CourseMediaStorage;
  let images: CourseImageService;
  let ingestion: CsvIngestionService;
  let uploadStorage: UploadStorage;
  const jobs: CourseImageFetchJob[] = [];
  const auth = { alliance: '', urv: '' };
  const http = () => request(app.getHttpServer());

  /** A URV course (form channel) or a UIBK course (harvested). */
  async function course(extId: string, org: string = ORG.urv, channel: 'form' | 'oeapi' = 'form') {
    // One transaction: a published course needs its English text (deferred check).
    return tdb.db.transaction().execute(async (trx) => {
      const { id } = await trx
        .insertInto('courses')
        .values({
          organization_id: org,
          ext_id: extId,
          source_channel: channel,
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

  const files = (id: string) => {
    const dir = join(uploadsDir, 'media', 'courses', id);
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  };

  const put = (id: string, file: Buffer, fields: Record<string, string>, token = auth.alliance) => {
    let req = http().put(`${BASE}/courses/${id}/image`).set('Authorization', token);
    for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
    return req.attach('file', file, 'photo.png');
  };

  const audit = (id: string) =>
    tdb.db
      .selectFrom('audit_log')
      .select(['actor_sub', 'action', 'changes'])
      .where('entity_id', '=', id)
      .where('action', 'like', 'course.image%')
      .orderBy('id')
      .execute();

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    tdb = await createTestDatabase();
    uploadsDir = mkdtempSync(join(tmpdir(), 'oecp-images-'));
    const config = configStub({ OECP_UPLOADS_DIR: uploadsDir });
    storage = new CourseMediaStorage(config);
    uploadStorage = new UploadStorage(config);
    const tokens = await createTestTokens();
    const moduleRef = await Test.createTestingModule({
      controllers: [CoursesController, CourseImageController, MediaController],
      providers: [
        { provide: KYSELY, useValue: tdb.db },
        { provide: AdminTokenVerifier, useValue: tokens.verifier },
        { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
        AdminJwtGuard,
        OrganizationAccess,
        CoursesService,
        CoursesRepository,
        CanonicalWriter,
        CsvAdapter,
        CourseImageUploadInterceptor,
        CourseImageService,
        { provide: CourseMediaStorage, useValue: storage },
        CsvIngestionService,
        SyncRunsRepository,
        { provide: UploadStorage, useValue: uploadStorage },
        {
          provide: MediaQueue,
          useValue: {
            enqueueFetch: vi.fn(async (job: CourseImageFetchJob) => void jobs.push(job)),
          },
        },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    images = moduleRef.get(CourseImageService);
    ingestion = moduleRef.get(CsvIngestionService);
    auth.alliance = `Bearer ${await tokens.sign(
      { ...BASE_CLAIMS, roles: ['alliance_admin'], org_id: ORG.aurora },
      ALLIANCE_SUB,
    )}`;
    auth.urv = `Bearer ${await tokens.sign(
      { ...BASE_CLAIMS, roles: ['partner_admin'], org_id: ORG.urv, idp: 'urv' },
      URV_SUB,
    )}`;
    await seedAttributeDefinitions(tdb.db);
  });

  afterAll(async () => {
    await app?.close();
    await tdb?.drop();
    if (uploadsDir) rmSync(uploadsDir, { recursive: true, force: true });
  });

  describe('migration 0008', () => {
    it('adds the image columns, empty for existing courses', async () => {
      const id = await course('MIG-1');
      const row = await tdb.db
        .selectFrom('courses')
        .select(['image_key', 'image_alt', 'image_decorative', 'image_credit', 'image_source_url'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({
        image_key: null,
        image_alt: {},
        image_decorative: false,
        image_credit: null,
        image_source_url: null,
      });
    });

    it.each([
      [
        "image_key = '0123456789abcdef', image_width = 10, image_height = 10, image_updated_at = now()",
      ],
      [
        "image_key = 'NOT-HEX', image_width = 10, image_height = 10, image_updated_at = now(), image_decorative = true",
      ],
      ["image_key = '0123456789abcdef', image_decorative = true"],
      ["image_credit = repeat('x', 301)"],
      ["image_source_url = 'http://insecure.example/x.png'"],
    ])('refuses %s', async (assignment) => {
      const id = await course(`MIG-${Math.random().toString(36).slice(2, 8)}`);
      await expect(
        sql.raw(`UPDATE courses SET ${assignment} WHERE id = '${id}'`).execute(tdb.db),
      ).rejects.toThrow(/check constraint/);
    });

    it('accepts a decorative image without alt and an image with an English alt', async () => {
      const id = await course('MIG-OK');
      await sql`UPDATE courses SET image_key = '0123456789abcdef', image_width = 10,
        image_height = 10, image_updated_at = now(), image_decorative = true WHERE id = ${id}`.execute(
        tdb.db,
      );
      await sql`UPDATE courses SET image_decorative = false, image_alt = '{"en": "A lab"}'
        WHERE id = ${id}`.execute(tdb.db);
    });
  });

  describe('admin endpoints and /media', () => {
    it('uploads, serves, replaces, patches and removes the image of a course', async () => {
      const id = await course('IMG-1');
      const first = await put(id, await png(2400, 1200), {
        alt_en: 'Students in a lab',
        credit: 'Photo: A. Example',
      }).expect(200);
      const stored = courseImage.parse(first.body);
      expect(stored).toMatchObject({
        alt: { en: 'Students in a lab' },
        decorative: false,
        credit: 'Photo: A. Example',
        width: 1600,
        height: 800,
        source_url: null,
      });
      expect(files(id)).toEqual([`${stored.key}.lg.webp`, `${stored.key}.sm.webp`]);

      const record = adminCourse.parse(
        (await http().get(`${BASE}/courses/${id}`).set('Authorization', auth.alliance).expect(200))
          .body,
      );
      expect(record.image).toEqual(stored);

      const served = await http().get(`/media/courses/${id}/${stored.key}.sm.webp`).expect(200);
      expect(served.headers['content-type']).toBe('image/webp');
      expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');

      // Replace: decorative without alt; the previous files are deleted.
      const second = courseImage.parse(
        (await put(id, await png(500, 500, '#ff0000'), { decorative: 'true' }).expect(200)).body,
      );
      expect(second).toMatchObject({ decorative: true, alt: {}, credit: null, width: 500 });
      expect(second.key).not.toBe(stored.key);
      expect(files(id)).toEqual([`${second.key}.lg.webp`, `${second.key}.sm.webp`]);
      await http().get(`/media/courses/${id}/${stored.key}.lg.webp`).expect(404);

      // Patch: no longer decorative needs an English alt.
      const refused = await http()
        .patch(`${BASE}/courses/${id}/image`)
        .set('Authorization', auth.alliance)
        .send({ decorative: false })
        .expect(422);
      expect(refused.body.errors[0].code).toBe('oecp.media.alt_required');
      const patched = await http()
        .patch(`${BASE}/courses/${id}/image`)
        .set('Authorization', auth.alliance)
        .send({
          decorative: false,
          alt: { en: 'A red square', ca: 'Un quadrat vermell' },
          credit: 'CC0',
        })
        .expect(200);
      expect(patched.body).toMatchObject({
        key: second.key,
        decorative: false,
        alt: { en: 'A red square', ca: 'Un quadrat vermell' },
        credit: 'CC0',
      });

      await http()
        .delete(`${BASE}/courses/${id}/image`)
        .set('Authorization', auth.alliance)
        .expect(204);
      expect(files(id)).toEqual([]);
      const gone = await http()
        .delete(`${BASE}/courses/${id}/image`)
        .set('Authorization', auth.alliance)
        .expect(404);
      expect(gone.body.errors[0].code).toBe('oecp.media.not_found');
      const nothing = await http()
        .patch(`${BASE}/courses/${id}/image`)
        .set('Authorization', auth.alliance)
        .send({ credit: null })
        .expect(404);
      expect(nothing.body.errors[0].code).toBe('oecp.media.not_found');

      const rows = await audit(id);
      expect(rows.map((r) => [r.actor_sub, r.action])).toEqual([
        [ALLIANCE_SUB, 'course.image_set'],
        [ALLIANCE_SUB, 'course.image_set'],
        [ALLIANCE_SUB, 'course.image_set'],
        [ALLIANCE_SUB, 'course.image_removed'],
      ]);
      expect(rows[0]!.changes).toMatchObject({
        channel: 'form',
        key: stored.key,
        previous_key: null,
        credit: true,
        alt_languages: ['en'],
      });
      expect(JSON.stringify(rows)).not.toContain('Photo: A. Example');
      expect(rows[1]!.changes).toMatchObject({ previous_key: stored.key });

      const history = await http()
        .get(`${BASE}/courses/${id}/history`)
        .set('Authorization', auth.alliance)
        .expect(200);
      expect(history.body.items.map((i: { summary: string }) => i.summary)).toEqual(
        expect.arrayContaining(['Image set', 'Image replaced', 'Image removed']),
      );
    });

    it('refuses bad files and missing alt texts with stable codes', async () => {
      const id = await course('IMG-BAD');
      const noAlt = await put(id, await png(100, 100), {}).expect(422);
      expect(noAlt.body.errors[0].code).toBe('oecp.media.alt_required');
      const text = await put(id, Buffer.from('<html>'), { alt_en: 'x' }).expect(415);
      expect(text.body.errors[0].code).toBe('oecp.media.unsupported_type');
      const big = await put(id, Buffer.alloc(5 * 1024 * 1024 + 10), { alt_en: 'x' }).expect(413);
      expect(big.body.errors[0].code).toBe('oecp.media.too_large');
      const decorativeTypo = await put(id, await png(10, 10), { decorative: 'yes' });
      expect(decorativeTypo.status).toBe(400);
      await http()
        .put(`${BASE}/courses/${id}/image`)
        .set('Authorization', auth.alliance)
        .field('alt_en', 'No file')
        .expect(400);
      expect(files(id)).toEqual([]);
      expect(await audit(id)).toEqual([]);
    });

    it('scopes partner admins to their organization, harvested courses included', async () => {
      const urv = await course('IMG-URV');
      const uibk = await course('IMG-UIBK', ORG.uibk, 'oeapi');
      await put(urv, await png(64, 64), { alt_en: 'URV' }, auth.urv).expect(200);
      const foreign = await put(uibk, await png(64, 64), { alt_en: 'UIBK' }, auth.urv);
      expect([403, 404]).toContain(foreign.status);
      // A harvested course takes an image (alliance admin), no override bookkeeping.
      await put(uibk, await png(64, 64), { alt_en: 'UIBK' }).expect(200);
      const row = await tdb.db
        .selectFrom('courses')
        .select(['overrides', 'image_key'])
        .where('id', '=', uibk)
        .executeTakeFirstOrThrow();
      expect(row.overrides).toEqual({});
      expect(row.image_key).toMatch(/^[0-9a-f]{16}$/);
    });

    it('puts the image on the public course page as /media paths', async () => {
      const id = await course('IMG-PUB');
      const stored = courseImage.parse(
        (await put(id, await png(1000, 500), { alt_en: 'Campus', credit: 'URV' }).expect(200)).body,
      );
      const rows = await new CatalogueRepository(tdb.db).courseDetail(id, '2026-10-16');
      const page = publicCourseDetail.parse(toCourseDetail(rows!));
      expect(page.image).toEqual({
        url: `/media/courses/${id}/${stored.key}.lg.webp`,
        thumbnail_url: `/media/courses/${id}/${stored.key}.sm.webp`,
        alt: { en: 'Campus' },
        decorative: false,
        credit: 'URV',
        width: 1000,
        height: 500,
      });
    });
  });

  describe('CSV template 1.3 and the media job', () => {
    const HEADER =
      'template_version,course_code,status,ects,isced_codes,title_en,image_url,image_alt_en,image_credit';

    async function uploadRun(courses: string): Promise<string> {
      const { id } = await tdb.db
        .insertInto('sync_runs')
        .values({
          organization_id: ORG.urv,
          channel: 'csv',
          trigger_kind: 'upload',
          triggered_by: URV_SUB,
          schema_version: 'csv-1.3',
          status: 'queued',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const key = UploadStorage.key(ORG.urv, id);
      await uploadStorage.write(key, 'courses', Buffer.from(courses, 'utf8'));
      await tdb.db
        .updateTable('sync_runs')
        .set({ upload_object_key: key })
        .where('id', '=', id)
        .execute();
      const outcome = await ingestion.process(id);
      expect(outcome.status).toBe('succeeded');
      return id;
    }

    function fetcher(body: Buffer | null) {
      const transport: HttpTransport = async () =>
        body
          ? { status: 200, headers: {}, body }
          : { status: 404, headers: {}, body: Buffer.alloc(0) };
      const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];
      return new CourseImageFetchService(
        tdb.db,
        images,
        configStub({ OECP_ALLOW_INSECURE_PARTNER_HTTP: false }),
        { transport, resolve },
      );
    }

    it('queues one fetch per row with a new image_url, then stores the image with the row metadata', async () => {
      const csv =
        `${HEADER}\n` +
        '1.3,CSV-IMG-1,draft,5,0613,One,https://img.example.org/1.png,A lecture hall,Photo: URV\n' +
        '1.3,CSV-IMG-2,draft,5,0613,Two,https://img.example.org/2.png,,\n' +
        '1.3,CSV-IMG-3,draft,5,0613,Three,,Ignored,Ignored\n';
      expect(validateCsvFiles({ courses: csv }).errorCount).toBe(0);
      jobs.length = 0;
      const run = await uploadRun(csv);
      expect(jobs.map((j) => [j.extId, j.row, j.url, j.alt, j.decorative, j.credit])).toEqual([
        [
          'CSV-IMG-1',
          2,
          'https://img.example.org/1.png',
          { en: 'A lecture hall' },
          false,
          'Photo: URV',
        ],
        ['CSV-IMG-2', 3, 'https://img.example.org/2.png', {}, true, null],
      ]);
      expect(jobs.every((j) => j.syncRunId === run)).toBe(true);
      // Nothing is stored before the fetch.
      const before = await tdb.db
        .selectFrom('courses')
        .select(['image_key', 'image_alt', 'image_credit'])
        .where('id', '=', jobs[0]!.courseId)
        .executeTakeFirstOrThrow();
      expect(before).toEqual({ image_key: null, image_alt: {}, image_credit: null });

      const body = await png(800, 600);
      expect(await fetcher(body).run(jobs[0]!)).toBe('set');
      const after = await images.get(jobs[0]!.courseId);
      expect(after).toMatchObject({
        alt: { en: 'A lecture hall' },
        decorative: false,
        credit: 'Photo: URV',
        width: 800,
        height: 600,
        source_url: 'https://img.example.org/1.png',
      });
      const rows = await audit(jobs[0]!.courseId);
      expect(rows.map((r) => [r.actor_sub, r.action])).toEqual([
        ['system:csv', 'course.image_set'],
      ]);
      expect(rows[0]!.changes).toMatchObject({ channel: 'csv', sync_run_id: run });

      // The same URL again is a no-op: no job.
      jobs.length = 0;
      await uploadRun(
        `${HEADER}\n1.3,CSV-IMG-1,draft,5,0613,One,https://img.example.org/1.png,Other alt,\n`,
      );
      expect(jobs).toEqual([]);
      // An empty image_url keeps the image.
      const courseId = (
        await tdb.db
          .selectFrom('courses')
          .select('id')
          .where('ext_id', '=', 'CSV-IMG-1')
          .executeTakeFirstOrThrow()
      ).id;
      await uploadRun(`${HEADER}\n1.3,CSV-IMG-1,draft,5,0613,One,,,\n`);
      expect(jobs).toEqual([]);
      expect((await images.get(courseId))?.key).toBe(after!.key);
    });

    it('records a failed fetch as a warning on the upload run and changes nothing', async () => {
      jobs.length = 0;
      const run = await uploadRun(
        `${HEADER}\n1.3,CSV-IMG-404,draft,5,0613,Gone,https://img.example.org/missing.png,Alt,\n`,
      );
      const job = jobs[0]!;
      expect(await fetcher(null).run(job)).toBe('failed');
      expect(await images.get(job.courseId)).toBeNull();
      const errors = await tdb.db
        .selectFrom('sync_errors')
        .selectAll()
        .where('sync_run_id', '=', run)
        .execute();
      expect(errors).toEqual([
        expect.objectContaining({
          severity: 'warning',
          code: 'oecp.media.fetch_failed',
          entity_type: 'course',
          ext_id: 'CSV-IMG-404',
          file: 'courses',
          row_number: 2,
          column_name: 'image_url',
        }),
      ]);
      expect(errors[0]!.message).toContain('HTTP 404');
    });
  });

  describe('harvest and retention', () => {
    it('a harvest leaves the image of a harvested course untouched', async () => {
      const id = await course('UIBK-IMG', ORG.uibk, 'oeapi');
      await put(id, await png(300, 200), { alt_en: 'Innsbruck', credit: 'UIBK' }).expect(200);
      const before = await images.get(id);
      const writer = new CanonicalWriter(tdb.db);
      const harvested: Course = {
        ext_id: 'UIBK-IMG',
        source_ref: 'uibk-img',
        status: 'published',
        kind: 'course',
        ects: 6,
        level: 'master',
        levels: ['master'],
        eqf_level: 7,
        teaching_hours: null,
        teaching_unit_ext_id: null,
        info_url: null,
        contact_email: 'x@uibk.example',
        isced_codes: ['0613'],
        instructors: [],
        attributes: {},
        texts: {
          en: {
            title: 'Renamed by the partner',
            abstract: null,
            description: null,
            learning_outcomes: null,
            prerequisites: null,
            assessment: null,
            keywords: [],
            is_machine_translated: false,
          },
        },
      };
      const runId = (
        await tdb.db
          .insertInto('sync_runs')
          .values({
            organization_id: ORG.uibk,
            channel: 'oeapi',
            trigger_kind: 'manual',
            schema_version: 'oeapi-5.0',
            status: 'running',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const result = await writer.upsertCourse(
        {
          syncRunId: runId,
          organizationId: ORG.uibk,
          channel: 'oeapi',
          schemaVersion: 'oeapi-5.0',
          actor: HARVESTER_ACTOR,
          now: new Date(),
        },
        harvested,
        {},
      );
      expect(result.outcome).toBe('updated');
      const after = await images.get(id);
      expect(after).toEqual({ ...before, updated_at: before!.updated_at });
      expect(files(id)).toHaveLength(2);
    });

    it('the retention job deletes the image directory with the course', async () => {
      const id = await course('SOFT-IMG');
      await put(id, await png(120, 80), { alt_en: 'Soon gone' }).expect(200);
      expect(files(id)).toHaveLength(2);
      await tdb.db
        .updateTable('courses')
        .set({ status: 'draft', deleted_at: new Date('2025-01-01T00:00:00Z') })
        .where('id', '=', id)
        .execute();
      const retention = new RetentionService(
        tdb.db,
        maintenanceOptions({
          OECP_RETENTION_HISTORY_MONTHS: 12,
          OECP_RETENTION_SYNC_ERRORS_MONTHS: 12,
          OECP_RETENTION_SYNC_RUNS_MONTHS: 24,
          OECP_RETENTION_AUDIT_MONTHS: 36,
          OECP_RETENTION_SOFT_DELETED_MONTHS: 12,
          OECP_DORMANCY_DAYS: 180,
          OECP_DORMANCY_DRY_RUN: true,
          OECP_ACCOUNT_DELETE_MONTHS: 12,
          OECP_ACCOUNT_CLEANUP_DRY_RUN: true,
        }),
        () => new Date('2026-10-16T00:00:00Z'),
        storage,
      );
      const outcome = await retention.purge();
      expect(outcome.counters['soft_deleted_courses']).toBeGreaterThanOrEqual(1);
      expect(outcome.counters['soft_deleted_course_media']).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(uploadsDir, 'media', 'courses', id))).toBe(false);
    });
  });
});
