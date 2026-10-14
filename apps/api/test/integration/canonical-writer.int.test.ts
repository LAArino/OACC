// SPDX-License-Identifier: EUPL-1.2
import type { Course, CourseOffering } from '@oecp/schemas';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CanonicalWriter } from '../../src/ingestion/canonical-writer.service.js';
import { jcsSha256 } from '../../src/ingestion/jcs.js';
import { offeringKey, type WriteContext } from '../../src/ingestion/ports/canonical-writer.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const T0 = new Date('2026-10-14T03:00:00Z');

const course = (patch: Partial<Course> = {}): Course => ({
  ext_id: 'C1',
  source_ref: 'c-1',
  status: 'published',
  ects: 7.5,
  level: 'master',
  eqf_level: 7,
  teaching_hours: null,
  teaching_unit_ext_id: null,
  info_url: 'https://example.org/c1',
  contact_email: null,
  isced_codes: ['0613', '0611'],
  texts: {
    en: {
      title: 'Machine Learning',
      abstract: null,
      description: 'Stats.',
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: [],
      is_machine_translated: false,
    },
    de: {
      title: 'Maschinelles Lernen',
      abstract: null,
      description: null,
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: [],
      is_machine_translated: false,
    },
  },
  ...patch,
});

const offering = (patch: Partial<CourseOffering> = {}): CourseOffering => ({
  course_ext_id: 'C1',
  ext_offering_id: 'C1-2026S',
  source_ref: 'o-1',
  status: 'published',
  academic_session_ext_id: 'SS2026',
  start_date: '2026-03-02',
  end_date: '2026-06-30',
  enrol_start_date: '2026-01-15',
  application_deadline: '2026-02-20',
  timezone: 'Europe/Vienna',
  teaching_languages: ['en'],
  delivery_modes: ['presential', 'online'],
  campus: null,
  max_students: 30,
  alliance_seats: null,
  seats_available: 5,
  seats_updated_at: T0.toISOString(),
  application_url: null,
  ...patch,
});

describe.runIf(describeWithDatabase === 'run')('CanonicalWriter (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let writer: CanonicalWriter;
  let ctx: WriteContext;

  async function newRun(now = T0): Promise<WriteContext> {
    const run = await tdb.db
      .insertInto('sync_runs')
      .values({
        organization_id: ORG.uibk,
        channel: 'oeapi',
        trigger_kind: 'schedule',
        schema_version: 'oeapi-5.0',
        status: 'running',
        started_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      syncRunId: run.id,
      organizationId: ORG.uibk,
      channel: 'oeapi',
      schemaVersion: 'oeapi-5.0',
      actor: 'system:harvester',
      now,
    };
  }

  const courseRow = (extId = 'C1') =>
    tdb.db
      .selectFrom('courses')
      .selectAll()
      .where('organization_id', '=', ORG.uibk)
      .where('ext_id', '=', extId)
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    tdb = await createTestDatabase();
    writer = new CanonicalWriter(tdb.db);
    ctx = await newRun();
  }, 60_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  it('creates a course with texts, ISCED codes, hash, history and warnings', async () => {
    const result = await writer.upsertCourse(ctx, course(), { courseId: 'c-1', v: 1 }, [
      {
        code: 'oecp.oeapi.insecure_link',
        severity: 'warning',
        message: 'dropped',
        pointer: '/link',
      },
    ]);
    expect(result.outcome).toBe('created');
    const row = await courseRow();
    expect(row).toMatchObject({
      status: 'published',
      ects: '7.50',
      level: 'master',
      eqf_level: 7,
      source_channel: 'oeapi',
      source_ref: 'c-1',
      absent_count: 0,
    });
    expect(row.content_hash?.equals(jcsSha256(course()))).toBe(true);
    const texts = await tdb.db
      .selectFrom('course_texts')
      .select(['lang', 'title'])
      .where('course_id', '=', row.id)
      .orderBy('lang')
      .execute();
    expect(texts).toEqual([
      { lang: 'de', title: 'Maschinelles Lernen' },
      { lang: 'en', title: 'Machine Learning' },
    ]);
    const isced = await tdb.db
      .selectFrom('course_isced_codes')
      .select(['isced_code', 'broad_code', 'is_primary'])
      .where('course_id', '=', row.id)
      .orderBy('isced_code', 'desc')
      .execute();
    expect(isced).toEqual([
      { isced_code: '0613', broad_code: '06', is_primary: true },
      { isced_code: '0611', broad_code: '06', is_primary: false },
    ]);
    const history = await tdb.db
      .selectFrom('ext_metadata_history')
      .selectAll()
      .where('ext_id', '=', 'C1')
      .execute();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      entity_type: 'course',
      entity_id: row.id,
      channel: 'oeapi',
      schema_version: 'oeapi-5.0',
      validation_result: 'accepted',
      raw_payload: { courseId: 'c-1', v: 1 },
    });
    const errors = await tdb.db
      .selectFrom('sync_errors')
      .selectAll()
      .where('sync_run_id', '=', ctx.syncRunId)
      .execute();
    expect(errors).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'oecp.oeapi.insecure_link',
        entity_type: 'course',
        ext_id: 'C1',
        json_pointer: '/link',
      }),
    ]);
  });

  it('counts an identical course as unchanged and only touches last_seen_at', async () => {
    const before = await courseRow();
    await tdb.db
      .updateTable('courses')
      .set({ absent_count: 2 })
      .where('id', '=', before.id)
      .execute();
    const later = { ...ctx, now: new Date('2026-10-15T03:00:00Z') };
    const result = await writer.upsertCourse(later, course(), { courseId: 'c-1', v: 1 });
    expect(result.outcome).toBe('unchanged');
    const after = await courseRow();
    expect(after.updated_at).not.toEqual(before.updated_at); // last_seen_at write
    expect(after.last_seen_at).toEqual(later.now);
    expect(after.absent_count).toBe(0);
    const history = await tdb.db
      .selectFrom('ext_metadata_history')
      .select('id')
      .where('ext_id', '=', 'C1')
      .execute();
    expect(history).toHaveLength(1); // same payload: no new history row
  });

  it('applies overrides on top of harvested values and keeps the hash of the source', async () => {
    const row = await courseRow();
    const by = { by: 'admin-sub', at: '2026-10-14T10:00:00Z' };
    await tdb.db
      .updateTable('courses')
      .set({ overrides: { ects: { value: 6, ...by }, isced_codes: { value: ['0511'], ...by } } })
      .where('id', '=', row.id)
      .execute();
    await tdb.db
      .updateTable('course_texts')
      .set({ overrides: { title: { value: 'ML (edited)', ...by } } })
      .where('course_id', '=', row.id)
      .where('lang', '=', 'en')
      .execute();

    // German text disappears from the source; English text changes.
    const changed = course({
      ects: 8,
      texts: {
        en: { ...course().texts['en']!, title: 'Machine Learning II', description: 'New.' },
      },
    });
    const result = await writer.upsertCourse(ctx, changed, { courseId: 'c-1', v: 2 });
    expect(result.outcome).toBe('updated');
    const after = await courseRow();
    expect(after.ects).toBe('6.00'); // override wins
    expect(after.content_hash?.equals(jcsSha256(changed))).toBe(true);
    const texts = await tdb.db
      .selectFrom('course_texts')
      .select(['lang', 'title', 'description'])
      .where('course_id', '=', row.id)
      .execute();
    expect(texts).toEqual([{ lang: 'en', title: 'ML (edited)', description: 'New.' }]);
    const isced = await tdb.db
      .selectFrom('course_isced_codes')
      .select('isced_code')
      .where('course_id', '=', row.id)
      .execute();
    expect(isced).toEqual([{ isced_code: '0511' }]);
    const history = await tdb.db
      .selectFrom('ext_metadata_history')
      .select('id')
      .where('ext_id', '=', 'C1')
      .execute();
    expect(history).toHaveLength(2);
  });

  it('never deletes English texts and stores a German-only course as draft', async () => {
    await writer.upsertCourse(
      ctx,
      course({ ext_id: 'C2', status: 'draft', texts: { de: course().texts['de']! } }),
      {},
    );
    expect((await courseRow('C2')).status).toBe('draft');
    // C1 without English in the source keeps its English row.
    const c1 = await courseRow();
    await writer.upsertCourse(
      ctx,
      course({ status: 'draft', texts: { de: course().texts['de']! } }),
      { v: 3 },
    );
    const langs = await tdb.db
      .selectFrom('course_texts')
      .select('lang')
      .where('course_id', '=', c1.id)
      .orderBy('lang')
      .execute();
    expect(langs.map((l) => l.lang)).toEqual(['de', 'en']);
    // Restore C1 to a published state for the next tests.
    await writer.upsertCourse(ctx, course(), { v: 4 });
    expect((await courseRow()).status).toBe('published');
  });

  it('fails the transaction when an override publishes a course without English', async () => {
    const c2 = await courseRow('C2');
    await tdb.db
      .updateTable('courses')
      .set({ overrides: { status: { value: 'published', by: 'x', at: '2026-10-14T00:00:00Z' } } })
      .where('id', '=', c2.id)
      .execute();
    await expect(
      writer.upsertCourse(
        ctx,
        course({ ext_id: 'C2', status: 'draft', ects: 3, texts: { de: course().texts['de']! } }),
        {},
      ),
    ).rejects.toThrow(/no English text/);
    await tdb.db.updateTable('courses').set({ overrides: {} }).where('id', '=', c2.id).execute();
  });

  it('upserts academic sessions and offerings with delivery modes and seats', async () => {
    const session = await writer.upsertAcademicSession(
      ctx,
      {
        ext_id: 'SS2026',
        parent_ext_id: 'AY2026',
        session_type: 'semester',
        name: { en: 'Summer semester 2026' },
        start_date: '2026-03-01',
        end_date: '2026-09-30',
      },
      { academicSessionId: 'SS2026' },
    );
    expect(session.outcome).toBe('created');
    const again = await writer.upsertAcademicSession(
      ctx,
      {
        ext_id: 'SS2026',
        parent_ext_id: 'AY2026',
        session_type: 'semester',
        name: { en: 'Summer semester 2026' },
        start_date: '2026-03-01',
        end_date: '2026-09-30',
      },
      { academicSessionId: 'SS2026' },
    );
    expect(again.outcome).toBe('unchanged');

    const result = await writer.upsertOffering(ctx, offering(), { offeringId: 'o-1' });
    expect(result.outcome).toBe('created');
    expect(result.warnings).toEqual([]);
    const row = await tdb.db
      .selectFrom('course_offerings')
      .selectAll()
      .where('id', '=', result.entityId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      academic_session_id: session.entityId,
      start_date: '2026-03-02',
      application_deadline: '2026-02-20',
      teaching_languages: ['en'],
      max_students: 30,
      seats_available: 5,
      timezone: 'Europe/Vienna',
      source_channel: 'oeapi',
    });
    expect(row.seats_updated_at).toEqual(T0);
    const modes = await tdb.db
      .selectFrom('course_offering_delivery_modes')
      .select('mode_code')
      .where('offering_id', '=', result.entityId)
      .orderBy('mode_code')
      .execute();
    expect(modes.map((m) => m.mode_code)).toEqual(['online', 'presential']);

    // Next fetch: same content, newer fetch time → unchanged, seats timestamp refreshed.
    const t1 = new Date('2026-10-15T03:00:00Z');
    const next = await writer.upsertOffering(
      { ...ctx, now: t1 },
      offering({ seats_updated_at: t1.toISOString() }),
      { offeringId: 'o-1' },
    );
    expect(next.outcome).toBe('unchanged');
    const refreshed = await tdb.db
      .selectFrom('course_offerings')
      .select(['seats_updated_at', 'last_seen_at'])
      .where('id', '=', result.entityId)
      .executeTakeFirstOrThrow();
    expect(refreshed).toEqual({ seats_updated_at: t1, last_seen_at: t1 });
  });

  it('stores an offering with an unknown session reference without it, with a warning', async () => {
    const result = await writer.upsertOffering(
      ctx,
      offering({
        ext_offering_id: 'C1-X',
        academic_session_ext_id: 'NOPE',
        seats_available: null,
        seats_updated_at: null,
      }),
      {},
    );
    expect(result.outcome).toBe('created');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'oecp.content.unknown_session', ext_id: 'C1#C1-X' }),
    ]);
  });

  it('records rejections and resets the absence counter of known entities', async () => {
    const c1 = await courseRow();
    await tdb.db.updateTable('courses').set({ absent_count: 2 }).where('id', '=', c1.id).execute();
    await writer.reject(
      ctx,
      { entityType: 'course', extId: 'C1', course: { extId: 'C1' } },
      { bad: true },
      [
        {
          code: 'oecp.oeapi.study_load_unit',
          severity: 'error',
          message: 'x',
          pointer: '/studyLoad',
        },
      ],
    );
    expect((await courseRow()).absent_count).toBe(0);
    const history = await tdb.db
      .selectFrom('ext_metadata_history')
      .select(['validation_result', 'entity_id'])
      .where('ext_id', '=', 'C1')
      .orderBy('received_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(history).toEqual({ validation_result: 'rejected', entity_id: c1.id });
  });

  describe('withdrawal by absence (spec §6.2.5)', () => {
    let run: WriteContext;

    beforeAll(async () => {
      run = await newRun();
      // C1 (published) + C3..C5 published; C2 is a draft.
      for (const id of ['C3', 'C4', 'C5']) {
        await writer.upsertCourse(run, course({ ext_id: id }), { id });
      }
      await writer.upsertOffering(
        run,
        offering({
          course_ext_id: 'C3',
          ext_offering_id: 'C3-OLD',
          start_date: '2024-09-01',
          end_date: '2024-12-01',
          enrol_start_date: null,
          application_deadline: null,
          academic_session_ext_id: null,
        }),
        {},
      );
      await writer.upsertOffering(
        run,
        offering({ course_ext_id: 'C3', ext_offering_id: 'C3-NEW', academic_session_ext_id: null }),
        {},
      );
    });

    const status = async (extId: string) => {
      const row = await courseRow(extId);
      return [row.status, row.absent_count];
    };

    it('does not count absences when 30% or more of published courses are missing', async () => {
      const result = await writer.applyAbsences(
        run,
        {
          courseExtIds: new Set(['C1', 'C2', 'C3']),
          offeringKeys: new Set(),
          offeringWindowStart: '2025-10-14',
        },
        1,
      );
      expect(result).toMatchObject({
        massAbsence: true,
        publishedCourses: 4,
        missingPublishedCourses: 2,
        withdrawn: 0,
      });
      expect(await status('C4')).toEqual(['published', 0]);
    });

    it('counts absences, withdraws at N with an audit row, honours status overrides and the window', async () => {
      const c5 = await courseRow('C5');
      await tdb.db
        .updateTable('courses')
        .set({ overrides: { status: { value: 'published', by: 'x', at: '2026-10-14T00:00:00Z' } } })
        .where('id', '=', c5.id)
        .execute();
      const seen = {
        courseExtIds: new Set(['C1', 'C2', 'C3', 'C4']),
        offeringKeys: new Set([offeringKey('C1', 'C1-2026S'), offeringKey('C1', 'C1-X')]),
        offeringWindowStart: '2025-10-14',
      };
      // 1 of 4 published missing (25%): counted. C5 absent but status overridden.
      const first = await writer.applyAbsences(run, seen, 2);
      expect(first).toMatchObject({ massAbsence: false, withdrawn: 0 });
      expect(await status('C5')).toEqual(['published', 1]);

      // C3's offerings: the new one is absent, the old one predates the window.
      const offerings = await tdb.db
        .selectFrom('course_offerings')
        .select(['ext_offering_id', 'absent_count', 'status'])
        .where('ext_offering_id', 'in', ['C3-OLD', 'C3-NEW'])
        .orderBy('ext_offering_id')
        .execute();
      expect(offerings).toEqual([
        { ext_offering_id: 'C3-NEW', absent_count: 1, status: 'published' },
        { ext_offering_id: 'C3-OLD', absent_count: 0, status: 'published' },
      ]);

      const second = await writer.applyAbsences(run, seen, 2);
      expect(second.withdrawn).toBe(1); // C3-NEW; C5 has a status override
      expect(await status('C5')).toEqual(['published', 2]);
      const audit = await tdb.db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'course_offering.withdraw')
        .execute();
      expect(audit).toEqual([
        expect.objectContaining({
          actor_sub: 'system:harvester',
          entity_type: 'course_offering',
          changes: expect.objectContaining({ reason: 'absence', absent_count: 2 }),
        }),
      ]);
    });

    it('withdraws an absent course and republishes it when it is seen again', async () => {
      const c4 = await courseRow('C4');
      await tdb.db
        .updateTable('courses')
        .set({ absent_count: 2 })
        .where('id', '=', c4.id)
        .execute();
      const result = await writer.applyAbsences(
        run,
        {
          courseExtIds: new Set(['C1', 'C2', 'C3', 'C5']),
          offeringKeys: new Set(),
          offeringWindowStart: '2025-10-14',
        },
        3,
      );
      expect(result.withdrawn).toBeGreaterThanOrEqual(1);
      expect(await status('C4')).toEqual(['withdrawn', 3]);

      const back = await writer.upsertCourse(run, course({ ext_id: 'C4' }), { id: 'C4' });
      expect(back.outcome).toBe('updated');
      expect(await status('C4')).toEqual(['published', 0]);
      const audit = await tdb.db
        .selectFrom('audit_log')
        .select(['action', 'changes'])
        .where('entity_id', '=', c4.id)
        .orderBy('id')
        .execute();
      expect(audit.map((a) => a.action)).toEqual(['course.withdraw', 'course.republish']);
    });
  });

  it('keeps one history row per distinct payload', async () => {
    const { count } = await tdb.db
      .selectFrom('ext_metadata_history')
      .select(sql<string>`count(*)`.as('count'))
      .where('ext_id', '=', 'C3')
      .executeTakeFirstOrThrow();
    expect(Number(count)).toBe(1);
  });
});
