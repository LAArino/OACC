// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { maintenanceJobRunResponse, maintenanceRunList } from '@oecp/schemas';
import { sql } from 'kysely';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminActivityRecorder } from '../../src/admin/auth/admin-activity.recorder.js';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';
import {
  KyselyOrganizationDirectory,
  ORGANIZATION_DIRECTORY,
} from '../../src/admin/auth/organization-directory.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { KYSELY } from '../../src/db/db.module.js';
import { AccountCleanupService } from '../../src/maintenance/account-cleanup.service.js';
import { DormancyService } from '../../src/maintenance/dormancy.service.js';
import { HistoryPartitionsService } from '../../src/maintenance/history-partitions.service.js';
import {
  type MaintenanceOptions,
  maintenanceOptions,
} from '../../src/maintenance/maintenance.constants.js';
import { MaintenanceController } from '../../src/maintenance/maintenance.controller.js';
import { MaintenanceQueue } from '../../src/maintenance/maintenance.queue.js';
import { MaintenanceJobsService } from '../../src/maintenance/maintenance-jobs.service.js';
import {
  MaintenanceJobError,
  MaintenanceRunner,
} from '../../src/maintenance/maintenance-runner.js';
import { MaintenanceRunsRepository } from '../../src/maintenance/maintenance-runs.repository.js';
import { RetentionService } from '../../src/maintenance/retention.service.js';
import { BASE_CLAIMS, createTestTokens } from '../support/admin-tokens.js';
import { FakeKeycloak } from '../support/fake-keycloak.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const options: MaintenanceOptions = maintenanceOptions({
  OECP_RETENTION_HISTORY_MONTHS: 12,
  OECP_RETENTION_SYNC_ERRORS_MONTHS: 12,
  OECP_RETENTION_SYNC_RUNS_MONTHS: 24,
  OECP_RETENTION_AUDIT_MONTHS: 36,
  OECP_RETENTION_SOFT_DELETED_MONTHS: 12,
  OECP_DORMANCY_DAYS: 180,
  OECP_DORMANCY_DRY_RUN: true,
  OECP_ACCOUNT_DELETE_MONTHS: 12,
  OECP_ACCOUNT_CLEANUP_DRY_RUN: true,
});

describe.runIf(describeWithDatabase === 'run')('Maintenance jobs (PostgreSQL)', () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    tdb = await createTestDatabase();
  });

  afterAll(async () => {
    await tdb?.drop();
  });

  const insertRun = async (createdAt: string, patch: Record<string, unknown> = {}) =>
    (
      await tdb.db
        .insertInto('sync_runs')
        .values({
          organization_id: ORG.uibk,
          channel: 'oeapi',
          trigger_kind: 'schedule',
          triggered_by: null,
          schema_version: 'oeapi-5.0',
          upload_object_key: null,
          status: 'succeeded',
          started_at: createdAt,
          finished_at: createdAt,
          error_summary: null,
          created_at: createdAt,
          ...patch,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const insertHistory = async (runId: string, receivedAt: string, extId: string) =>
    tdb.db
      .insertInto('ext_metadata_history')
      .values({
        received_at: receivedAt,
        sync_run_id: runId,
        organization_id: ORG.uibk,
        entity_type: 'course',
        entity_id: null,
        ext_id: extId,
        channel: 'oeapi',
        schema_version: 'oeapi-5.0',
        payload_sha256: createHash('sha256').update(`${extId}@${receivedAt}`).digest(),
        validation_result: 'accepted',
        raw_payload: { code: extId },
      })
      .execute();

  const partitionOf = async () =>
    (
      await sql<{ partition: string; ext_id: string }>`
        SELECT tableoid::regclass::text AS partition, ext_id
        FROM ext_metadata_history ORDER BY ext_id`.execute(tdb.db)
    ).rows;

  describe('history partitions', () => {
    it('creates the coming months, moves rows out of the default partition and drops old months', async () => {
      const run = await insertRun('2026-11-02T03:00:00Z');
      await insertHistory(run, '2026-11-02T03:00:00Z', 'nov');
      // No partition yet for December 2026 and January 2027: these land in the default one.
      await insertHistory(run, '2026-12-01T00:00:00Z', 'dec-a');
      await insertHistory(run, '2026-12-31T23:59:59.999Z', 'dec-b');
      await insertHistory(run, '2027-01-10T08:00:00Z', 'jan');
      expect((await partitionOf()).filter((r) => r.partition.endsWith('_default'))).toHaveLength(3);

      const service = new HistoryPartitionsService(
        tdb.db,
        options,
        () => new Date('2026-12-14T00:10:00Z'),
      );
      const first = await service.maintain();
      expect(first.counters).toEqual({
        partitions_created: 4,
        rows_moved: 3,
        partitions_dropped: 0,
        rows_dropped: 0,
        default_rows_remaining: 0,
        errors: 0,
      });
      expect(await service.partitionNames()).toEqual([
        'ext_metadata_history_2026_11',
        'ext_metadata_history_2026_12',
        'ext_metadata_history_2027_01',
        'ext_metadata_history_2027_02',
        'ext_metadata_history_2027_03',
        'ext_metadata_history_default',
      ]);
      expect(await partitionOf()).toEqual([
        { partition: 'ext_metadata_history_2026_12', ext_id: 'dec-a' },
        { partition: 'ext_metadata_history_2026_12', ext_id: 'dec-b' },
        { partition: 'ext_metadata_history_2027_01', ext_id: 'jan' },
        { partition: 'ext_metadata_history_2026_11', ext_id: 'nov' },
      ]);
      // The moved table is a full partition: indexes, foreign keys, identity through the parent.
      const { rows: indexes } = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'ext_metadata_history_2026_12'
        ORDER BY indexname`.execute(tdb.db);
      expect(indexes).toHaveLength(3);
      await insertHistory(run, '2026-12-20T00:00:00Z', 'dec-c');
      await expect(
        sql`INSERT INTO ext_metadata_history_2026_12 (id, received_at, sync_run_id, organization_id,
              entity_type, ext_id, channel, schema_version, payload_sha256, validation_result, raw_payload)
            VALUES (999999, '2026-12-21', gen_random_uuid(), ${ORG.uibk}, 'course', 'x', 'oeapi', '5',
              sha256('x'), 'accepted', '{}')`.execute(tdb.db),
      ).rejects.toThrow(/foreign key/);

      const again = await service.maintain();
      expect(again.counters['partitions_created']).toBe(0);
      expect(again.details).toBeNull();

      // A year later: November 2026 (ends 2026-12-01) is entirely older than 12 months.
      const later = new HistoryPartitionsService(
        tdb.db,
        options,
        () => new Date('2027-12-02T00:10:00Z'),
      );
      const outcome = await later.maintain();
      expect(outcome.counters).toMatchObject({
        partitions_dropped: 1,
        rows_dropped: 1,
        partitions_created: 4, // 2027-12 and the next three; past months without rows are not created
        errors: 0,
      });
      const names = await later.partitionNames();
      expect(names).not.toContain('ext_metadata_history_2026_11');
      expect(names).toContain('ext_metadata_history_2026_12');
      expect(names).toContain('ext_metadata_history_default');
      expect(names).toContain('ext_metadata_history_2028_03');
      expect((await partitionOf()).map((r) => r.ext_id)).toEqual([
        'dec-a',
        'dec-b',
        'dec-c',
        'jan',
      ]);
    });
  });

  describe('retention', () => {
    beforeEach(async () => {
      await sql`TRUNCATE audit_log, admin_invitations, maintenance_runs, admin_activity`.execute(
        tdb.db,
      );
    });

    it('deletes expired rows in batches and reports counters', async () => {
      const now = new Date('2029-01-15T04:45:00Z');
      const oldRun = await insertRun('2026-12-01T00:00:00Z'); // > 24 months
      const recentRun = await insertRun('2028-06-01T00:00:00Z');
      const runningRun = await insertRun('2026-12-01T00:00:00Z', {
        status: 'running',
        finished_at: null,
      });
      const uploadRun = await insertRun('2026-12-01T00:00:00Z', {
        channel: 'csv',
        trigger_kind: 'upload',
        schema_version: 'csv-1.1',
        upload_object_key: `${ORG.uibk}/u1`,
      });
      const referencedRun = await insertRun('2026-12-01T00:00:00Z');
      await insertHistory(referencedRun, '2026-12-03T00:00:00Z', 'kept-by-history');

      // 5 003 expired errors (more than one batch) and 2 recent ones.
      await sql`INSERT INTO sync_errors (sync_run_id, severity, code, message, created_at)
        SELECT ${recentRun}, 'warning', 'oecp.test', 'old', '2027-06-01'::timestamptz
        FROM generate_series(1, 5003)`.execute(tdb.db);
      await sql`INSERT INTO sync_errors (sync_run_id, severity, code, message, created_at)
        SELECT ${recentRun}, 'warning', 'oecp.test', 'new', '2028-12-01'::timestamptz
        FROM generate_series(1, 2)`.execute(tdb.db);
      await sql`INSERT INTO sync_errors (sync_run_id, severity, code, message, created_at)
        VALUES (${oldRun}, 'error', 'oecp.test', 'cascade', '2026-12-01')`.execute(tdb.db);

      await tdb.db
        .insertInto('audit_log')
        .values([
          { actor_sub: 's', action: 'old', entity_type: 'x', occurred_at: '2025-12-31T00:00:00Z' },
          { actor_sub: 's', action: 'new', entity_type: 'x', occurred_at: '2026-02-01T00:00:00Z' },
        ])
        .execute();

      const invitation = (patch: Record<string, unknown>) => ({
        email: `${Math.random()}@x.example`,
        role: 'partner_admin' as const,
        organization_id: ORG.uibk,
        token_sha256: createHash('sha256').update(String(Math.random())).digest(),
        invited_by: 'system:test',
        expires_at: '2030-01-01T00:00:00Z',
        created_at: '2027-01-01T00:00:00Z',
        ...patch,
      });
      await tdb.db
        .insertInto('admin_invitations')
        .values([
          invitation({ accepted_at: '2027-02-01T00:00:00Z', expires_at: '2027-02-08T00:00:00Z' }),
          invitation({ revoked_at: '2027-03-01T00:00:00Z' }),
          invitation({ expires_at: '2027-04-01T00:00:00Z' }),
          invitation({ accepted_at: '2028-12-01T00:00:00Z', expires_at: '2028-12-08T00:00:00Z' }),
          invitation({ expires_at: '2029-01-20T00:00:00Z' }), // pending
        ])
        .execute();

      await tdb.db
        .insertInto('maintenance_runs')
        .values([
          {
            job: 'retention',
            trigger_kind: 'schedule',
            status: 'succeeded',
            started_at: '2027-12-01T00:00:00Z',
            finished_at: '2027-12-01T00:01:00Z',
          },
          {
            job: 'csv-retention',
            trigger_kind: 'schedule',
            status: 'running',
            started_at: '2029-01-14T00:00:00Z',
          },
          {
            job: 'retention',
            trigger_kind: 'schedule',
            status: 'succeeded',
            started_at: '2029-01-14T04:45:00Z',
            finished_at: '2029-01-14T04:45:01Z',
          },
        ])
        .execute();
      await tdb.db
        .insertInto('admin_activity')
        .values([
          { sub: 'idle', organization_id: ORG.uibk, last_seen_at: '2027-12-01T00:00:00Z' },
          { sub: 'busy', organization_id: ORG.uibk, last_seen_at: '2029-01-10T00:00:00Z' },
        ])
        .execute();

      const service = new RetentionService(tdb.db, options, () => now);
      const outcome = await service.purge();
      expect(outcome.counters).toEqual({
        sync_errors: 5004,
        sync_runs: 1,
        // referencedRun, and the run of the history test (2026-11-02) whose partition is kept.
        sync_runs_kept_referenced: 2,
        audit_log: 1,
        admin_invitations: 3,
        maintenance_runs: 1,
        admin_activity: 1,
        soft_deleted_offerings: 0,
        soft_deleted_courses: 0,
        soft_deleted_organizations: 0,
        soft_deleted_organizations_kept: 0,
        stale_maintenance_runs: 1,
      });
      expect(outcome.details).toMatchObject({
        cutoffs: { sync_runs: '2027-01-15T04:45:00.000Z', audit_log: '2026-01-15T04:45:00.000Z' },
      });

      const runIds = (await tdb.db.selectFrom('sync_runs').select('id').execute()).map((r) => r.id);
      expect(runIds).not.toContain(oldRun);
      expect(runIds).toEqual(
        expect.arrayContaining([recentRun, runningRun, uploadRun, referencedRun]),
      );
      const errors = await tdb.db.selectFrom('sync_errors').select('message').execute();
      expect(errors.map((e) => e.message)).toEqual(['new', 'new']);
      expect(
        (await tdb.db.selectFrom('audit_log').select('action').execute()).map((r) => r.action),
      ).toEqual(['new']);
      expect(await tdb.db.selectFrom('admin_invitations').select('id').execute()).toHaveLength(2);
      const runs = await tdb.db
        .selectFrom('maintenance_runs')
        .select(['job', 'status', 'error'])
        .orderBy('started_at')
        .execute();
      expect(runs).toEqual([
        {
          job: 'csv-retention',
          status: 'failed',
          error: 'Did not finish within 6 hours (worker stopped or crashed)',
        },
        { job: 'retention', status: 'succeeded', error: null },
      ]);
      expect(
        (await tdb.db.selectFrom('admin_activity').select('sub').execute()).map((r) => r.sub),
      ).toEqual(['busy']);

      expect((await service.purge()).counters['sync_errors']).toBe(0);
    });

    it('purges records soft-deleted more than 12 months ago', async () => {
      const now = new Date('2029-01-15T04:45:00Z');
      const org = async (slug: string, deletedAt: string) =>
        (
          await sql<{ id: string }>`
            INSERT INTO organizations (org_type, slug, name, parent_id, partner_id, deleted_at)
            VALUES ('faculty', ${slug}, '{"en": "Unit"}', ${ORG.uibk}, ${ORG.uibk}, ${deletedAt})
            RETURNING id`.execute(tdb.db)
        ).rows[0]!.id;
      const gone = await org('gone-unit', '2027-06-01T00:00:00Z');
      const kept = await org('kept-unit', '2027-06-01T00:00:00Z');
      const recent = await org('recent-unit', '2028-12-01T00:00:00Z');
      await sql`INSERT INTO academic_sessions
          (organization_id, ext_id, session_type, name, start_date, end_date, source_channel)
        VALUES (${gone}, 'Y2027', 'academic_year', '{"en": "2027"}', '2027-01-01', '2027-12-31', 'csv')`.execute(
        tdb.db,
      );
      await insertRun('2028-12-01T00:00:00Z', { organization_id: kept });

      const course = async (extId: string, deletedAt: string | null) =>
        (
          await sql<{ id: string }>`
            INSERT INTO courses (organization_id, ext_id, source_channel, ects, deleted_at)
            VALUES (${ORG.urv}, ${extId}, 'form', 3, ${deletedAt}) RETURNING id`.execute(tdb.db)
        ).rows[0]!.id;
      const offering = async (courseId: string, extId: string, deletedAt: string | null) =>
        sql`INSERT INTO course_offerings (course_id, ext_offering_id, source_channel, start_date,
              end_date, timezone, teaching_languages, deleted_at)
            VALUES (${courseId}, ${extId}, 'form', '2027-03-01', '2027-06-30', 'Europe/Madrid',
              '{en}', ${deletedAt})`.execute(tdb.db);
      const old = await course('SOFT-OLD', '2027-12-01T00:00:00Z');
      await sql`INSERT INTO course_texts (course_id, lang, title) VALUES (${old}, 'en', 'Old')`.execute(
        tdb.db,
      );
      await offering(old, 'O1', '2027-12-01T00:00:00Z');
      const newer = await course('SOFT-NEW', '2028-06-01T00:00:00Z');
      const live = await course('SOFT-LIVE', null);
      await offering(live, 'GONE', '2027-01-01T00:00:00Z');
      await offering(live, 'KEPT', null);

      const outcome = await new RetentionService(tdb.db, options, () => now).purge();
      expect(outcome.counters).toMatchObject({
        soft_deleted_offerings: 2,
        soft_deleted_courses: 1,
        soft_deleted_organizations: 1,
        soft_deleted_organizations_kept: 1,
      });
      const courses = await tdb.db
        .selectFrom('courses')
        .select('id')
        .where('id', 'in', [old, newer, live])
        .execute();
      expect(courses.map((c) => c.id).sort()).toEqual([newer, live].sort());
      expect(
        await tdb.db
          .selectFrom('course_texts')
          .select('lang')
          .where('course_id', '=', old)
          .execute(),
      ).toEqual([]);
      const offerings = await tdb.db
        .selectFrom('course_offerings')
        .select('ext_offering_id')
        .where('course_id', 'in', [old, live])
        .execute();
      expect(offerings.map((o) => o.ext_offering_id)).toEqual(['KEPT']);
      const orgs = await tdb.db
        .selectFrom('organizations')
        .select('id')
        .where('id', 'in', [gone, kept, recent])
        .execute();
      expect(orgs.map((o) => o.id).sort()).toEqual([kept, recent].sort());
      expect(outcome.details?.['cutoffs']).toMatchObject({
        soft_deleted: '2028-01-15T04:45:00.000Z',
      });
    });
  });

  describe('maintenance_runs bookkeeping', () => {
    const runner = () => new MaintenanceRunner(tdb.db, new MaintenanceRunsRepository(tdb.db));
    const latest = (job: string) =>
      tdb.db
        .selectFrom('maintenance_runs')
        .selectAll()
        .where('job', '=', job)
        .orderBy('started_at', 'desc')
        .executeTakeFirstOrThrow();

    it('records succeeded, failed and skipped runs', async () => {
      const ok = await runner().run('history-partitions', 'manual', 'sub-1', async () => ({
        counters: { partitions_created: 2 },
        details: { created: ['a', 'b'] },
      }));
      expect(ok.status).toBe('succeeded');
      expect(await latest('history-partitions')).toMatchObject({
        id: ok.runId,
        trigger_kind: 'manual',
        triggered_by: 'sub-1',
        status: 'succeeded',
        counters: { partitions_created: 2 },
        details: { created: ['a', 'b'] },
        error: null,
      });

      await expect(
        runner().run('dormancy', 'schedule', undefined, async () => {
          throw new MaintenanceJobError('u1: Keycloak down', { counters: { revoked: 3 } });
        }),
      ).rejects.toThrow('Keycloak down');
      expect(await latest('dormancy')).toMatchObject({
        status: 'failed',
        counters: { revoked: 3 },
        error: 'u1: Keycloak down',
      });

      // Another worker holds the job's advisory lock.
      const other = new pg.Client({ connectionString: tdb.url });
      await other.connect();
      try {
        await other.query(`SELECT pg_advisory_lock(hashtext('oecp-maintenance:retention'))`);
        let called = false;
        const skipped = await runner().run('retention', 'schedule', undefined, async () => {
          called = true;
          return { counters: {} };
        });
        expect(skipped.status).toBe('skipped');
        expect(called).toBe(false);
        expect(
          (
            await tdb.db
              .selectFrom('maintenance_runs')
              .select(['status', 'details'])
              .where('id', '=', skipped.runId)
              .executeTakeFirstOrThrow()
          ).status,
        ).toBe('skipped');
      } finally {
        await other.end();
      }
      const after = await runner().run('retention', 'schedule', undefined, async () => ({
        counters: { audit_log: 0 },
      }));
      expect(after.status).toBe('succeeded');
    });
  });

  describe('admin activity', () => {
    it('upserts at most once per hour and sub, also across API replicas', async () => {
      let now = new Date('2027-01-01T10:00:00Z');
      const clock = () => now;
      const recorder = new AdminActivityRecorder(tdb.db, clock);
      const row = () =>
        tdb.db
          .selectFrom('admin_activity')
          .selectAll()
          .where('sub', '=', 'admin-1')
          .executeTakeFirstOrThrow();

      expect(await recorder.record('admin-1', ORG.uibk)).toBe(true);
      expect((await row()).last_seen_at.toISOString()).toBe('2027-01-01T10:00:00.000Z');

      now = new Date('2027-01-01T10:59:00Z');
      expect(await recorder.record('admin-1', ORG.uibk)).toBe(false);
      // A second API process (empty in-memory throttle): the upsert condition keeps the row.
      const replica = new AdminActivityRecorder(tdb.db, clock);
      expect(await replica.record('admin-1', ORG.uibk)).toBe(true);
      expect((await row()).last_seen_at.toISOString()).toBe('2027-01-01T10:00:00.000Z');

      now = new Date('2027-01-01T11:00:01Z');
      expect(await recorder.record('admin-1', ORG.uibk)).toBe(true);
      expect((await row()).last_seen_at.toISOString()).toBe('2027-01-01T11:00:01.000Z');

      // A changed organization is written at once; the time never goes backwards.
      const third = new AdminActivityRecorder(tdb.db, () => new Date('2027-01-01T11:30:00Z'));
      await third.record('admin-1', ORG.urv);
      expect(await row()).toMatchObject({ organization_id: ORG.urv });
      expect((await row()).last_seen_at.toISOString()).toBe('2027-01-01T11:30:00.000Z');
      const stale = new AdminActivityRecorder(tdb.db, () => new Date('2026-01-01T00:00:00Z'));
      await stale.record('admin-1', ORG.uibk);
      expect((await row()).last_seen_at.toISOString()).toBe('2027-01-01T11:30:00.000Z');

      // An unknown organization (foreign key) is logged, never thrown.
      await expect(
        recorder.record('admin-2', '0a000000-0000-4000-8000-0000000000ff'),
      ).resolves.toBe(true);
    });
  });

  describe('dormancy', () => {
    const NOW = new Date('2027-12-01T05:00:00Z');
    const created = (iso: string) => Date.parse(iso);
    let keycloak: FakeKeycloak;

    beforeEach(async () => {
      await sql`TRUNCATE audit_log, admin_activity`.execute(tdb.db);
      // Activity tracking started with the 0.3 upgrade on 2026-10-14.
      await sql`UPDATE pgmigrations SET run_on = '2026-10-14 12:00:00'
        WHERE name = '0006_maintenance'`.execute(tdb.db);
      keycloak = new FakeKeycloak();
      keycloak.eventsReadable = true;
      const add = (id: string, roles: string[], org: string, createdAt = '2026-01-01T00:00:00Z') =>
        keycloak.addUser({
          id,
          email: `${id}@x.example`,
          roles: new Set([...roles, 'default-roles-oecp']),
          attributes: { oecp_org_id: [org] },
          createdTimestamp: created(createdAt),
        });
      add('alliance-active', ['alliance_admin'], ORG.aurora);
      add('alliance-idle', ['alliance_admin'], ORG.aurora);
      add('partner-idle', ['partner_admin'], ORG.uibk);
      add('partner-new', ['partner_admin'], ORG.urv, '2027-10-01T00:00:00Z');
      add('partner-login', ['partner_admin'], ORG.urv).lastLogin = created('2027-11-20T08:00:00Z');
      add('not-admin', [], ORG.urv);
      await tdb.db
        .insertInto('admin_activity')
        .values([
          {
            sub: 'alliance-active',
            organization_id: ORG.aurora,
            last_seen_at: '2027-11-30T09:00:00Z',
          },
          { sub: 'partner-idle', organization_id: ORG.uibk, last_seen_at: '2027-03-01T09:00:00Z' },
        ])
        .execute();
    });

    const service = (dryRun: boolean) =>
      new DormancyService(
        tdb.db,
        keycloak.service(),
        { ...options, dormancyDryRun: dryRun },
        () => NOW,
      );
    const audits = () =>
      tdb.db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'admin.dormant_revoke')
        .execute();

    it('dry run reports the administrators it would revoke and changes nothing', async () => {
      const outcome = await service(true).run();
      expect(outcome.counters).toEqual({
        administrators: 5,
        dormant: 2,
        revoked: 0,
        would_revoke: 2,
        kept_last_alliance_admin: 0,
        failed: 0,
        no_evidence: 0,
        dry_run: 1,
        login_events_readable: 1,
      });
      const candidates = (outcome.details?.['candidates'] ?? []) as Record<string, unknown>[];
      expect(candidates).toEqual([
        {
          sub: 'alliance-idle',
          roles: ['alliance_admin'],
          organization_id: ORG.aurora,
          last_activity_at: '2026-10-14T12:00:00.000Z',
          basis: 'tracking_start',
          inactive_days: 412,
          action: 'would_revoke',
        },
        {
          sub: 'partner-idle',
          roles: ['partner_admin'],
          organization_id: ORG.uibk,
          last_activity_at: '2027-03-01T09:00:00.000Z',
          basis: 'api_activity',
          inactive_days: 274,
          action: 'would_revoke',
        },
      ]);
      expect(outcome.details).toMatchObject({ dry_run: true, threshold_days: 180 });
      expect(keycloak.loggedOut).toEqual([]);
      expect(keycloak.users.get('partner-idle')?.roles.has('partner_admin')).toBe(true);
      expect(await audits()).toEqual([]);
    });

    it('revokes dormant administrators, audits them and logs them out', async () => {
      const outcome = await service(false).run();
      expect(outcome.counters).toMatchObject({
        dormant: 2,
        revoked: 2,
        would_revoke: 0,
        dry_run: 0,
      });
      for (const sub of ['alliance-idle', 'partner-idle']) {
        const user = keycloak.users.get(sub);
        expect([...(user?.roles ?? [])]).toEqual(['default-roles-oecp']);
        expect(user?.attributes['oecp_org_id']).toBeUndefined();
      }
      expect(keycloak.loggedOut.sort()).toEqual(['alliance-idle', 'partner-idle']);
      expect(keycloak.users.get('partner-new')?.roles.has('partner_admin')).toBe(true);
      expect(keycloak.users.get('partner-login')?.roles.has('partner_admin')).toBe(true);
      const rows = await audits();
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.entity_id === ORG.uibk)).toMatchObject({
        actor_sub: 'system:dormancy',
        actor_org_id: null,
        entity_type: 'organization',
        changes: {
          keycloak_user_id: 'partner-idle',
          roles_removed: ['partner_admin'],
          oecp_org_id: { from: ORG.uibk, to: null },
          inactive_days: 274,
          threshold_days: 180,
          sessions: 'logged_out',
        },
      });

      // Idempotent: nothing left to revoke.
      expect((await service(false).run()).counters).toMatchObject({ dormant: 0, revoked: 0 });
    });

    it('never revokes the last alliance_admin', async () => {
      await sql`DELETE FROM admin_activity WHERE sub = 'alliance-active'`.execute(tdb.db);
      await tdb.db
        .insertInto('admin_activity')
        .values({
          sub: 'alliance-active',
          organization_id: ORG.aurora,
          last_seen_at: '2027-02-01T00:00:00Z',
        })
        .execute();
      const outcome = await service(false).run();
      expect(outcome.counters).toMatchObject({
        dormant: 3,
        revoked: 2,
        kept_last_alliance_admin: 1,
      });
      // alliance-idle (since 2026-10-14) goes first; alliance-active (2027-02-01) stays.
      expect(keycloak.users.get('alliance-active')?.roles.has('alliance_admin')).toBe(true);
      expect(keycloak.users.get('alliance-idle')?.roles.has('alliance_admin')).toBe(false);
    });

    it('refuses to decide without the start of activity tracking', async () => {
      await sql`UPDATE pgmigrations SET name = '0006_renamed' WHERE name = '0006_maintenance'`.execute(
        tdb.db,
      );
      try {
        await expect(service(true).run()).rejects.toThrow(/tracking unknown/);
      } finally {
        await sql`UPDATE pgmigrations SET name = '0006_maintenance' WHERE name = '0006_renamed'`.execute(
          tdb.db,
        );
      }
    });
  });

  describe('account cleanup', () => {
    const NOW = new Date('2028-06-01T05:15:00Z');
    let keycloak: FakeKeycloak;

    const removal = (sub: string, at: string, action = 'admin.revoke', org: string = ORG.uibk) =>
      tdb.db
        .insertInto('audit_log')
        .values({
          occurred_at: at,
          actor_sub: action === 'admin.revoke' ? 'admin-1' : 'system:dormancy',
          actor_org_id: null,
          action,
          entity_type: 'organization',
          entity_id: org,
          changes: { keycloak_user_id: sub, roles_removed: ['partner_admin'] },
        })
        .execute();

    beforeEach(async () => {
      await sql`TRUNCATE audit_log, admin_activity, admin_invitations`.execute(tdb.db);
      keycloak = new FakeKeycloak();
      keycloak.eventsReadable = true;
      const add = (id: string, patch: Partial<Parameters<FakeKeycloak['addUser']>[0]> = {}) =>
        keycloak.addUser({
          id,
          email: `${id}@x.example`,
          createdTimestamp: Date.parse('2026-01-01T00:00:00Z'),
          ...patch,
        });
      add('gone-old');
      add('dormant-old');
      add('recent-removal');
      add('reinvited', { roles: new Set(['partner_admin', 'default-roles-oecp']) });
      add('active-after');
      add('login-after', { lastLogin: Date.parse('2028-01-01T00:00:00Z') });
      add('pending');
      add('service', { username: 'service-account-oecp-backend', serviceAccountClientId: 'x' });
      add('young', { createdTimestamp: Date.parse('2027-07-01T00:00:00Z') });
      add('holder', { roles: new Set(['partner_admin', 'default-roles-oecp']) });

      await removal('gone-old', '2027-03-01T10:00:00Z');
      // An older revocation does not count: the latest removal is the evidence.
      await removal('dormant-old', '2026-11-01T10:00:00Z');
      await removal('dormant-old', '2027-04-01T05:00:00Z', 'admin.dormant_revoke', ORG.urv);
      await removal('recent-removal', '2027-12-01T10:00:00Z');
      for (const sub of ['reinvited', 'active-after', 'login-after', 'pending', 'service', 'young'])
        await removal(sub, '2027-01-01T10:00:00Z');
      await removal('absent', '2027-01-01T10:00:00Z');
      await tdb.db
        .insertInto('admin_activity')
        .values([
          { sub: 'gone-old', organization_id: ORG.uibk, last_seen_at: '2027-02-01T09:00:00Z' },
          { sub: 'active-after', organization_id: null, last_seen_at: '2027-08-01T09:00:00Z' },
          { sub: 'stranger', organization_id: null, last_seen_at: '2027-01-01T09:00:00Z' },
          { sub: 'holder', organization_id: ORG.uibk, last_seen_at: '2027-01-01T09:00:00Z' },
        ])
        .execute();
      await tdb.db
        .insertInto('admin_invitations')
        .values({
          email: 'pending@x.example',
          role: 'partner_admin',
          organization_id: ORG.urv,
          token_sha256: createHash('sha256').update('pending').digest(),
          invited_by: 'admin-1',
          expires_at: '2028-06-05T00:00:00Z',
        })
        .execute();
    });

    const service = (dryRun: boolean) =>
      new AccountCleanupService(
        tdb.db,
        keycloak.service(),
        { ...options, accountCleanupDryRun: dryRun },
        () => NOW,
      );
    const deletions = () =>
      tdb.db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'admin.account_deleted')
        .orderBy('entity_id')
        .execute();
    const activitySubs = async () =>
      (await tdb.db.selectFrom('admin_activity').select('sub').orderBy('sub').execute()).map(
        (r) => r.sub,
      );

    it('dry run lists the accounts it would delete and changes nothing', async () => {
      const outcome = await service(true).run();
      expect(outcome.counters).toEqual({
        removed_accounts: 10,
        within_period: 1,
        checked: 9,
        deleted: 0,
        would_delete: 2,
        already_absent: 1,
        kept: 6,
        failed: 0,
        activity_rows_deleted: 0,
        activity_rows_would_delete: 1,
        dry_run: 1,
        login_events_readable: 1,
      });
      expect(outcome.details).toMatchObject({
        dry_run: true,
        months: 12,
        cutoff: '2027-06-01T05:15:00.000Z',
        candidates: [
          {
            sub: 'gone-old',
            organization_id: ORG.uibk,
            last_role_removal_at: '2027-03-01T10:00:00.000Z',
            removal_action: 'admin.revoke',
            created_at: '2026-01-01T00:00:00.000Z',
            last_activity_at: '2027-02-01T09:00:00.000Z',
            action: 'would_delete',
          },
          {
            sub: 'dormant-old',
            organization_id: ORG.urv,
            last_role_removal_at: '2027-04-01T05:00:00.000Z',
            removal_action: 'admin.dormant_revoke',
            action: 'would_delete',
          },
        ],
        kept_by_reason: {
          has_role: 1,
          recent_activity: 1,
          recent_login: 1,
          pending_invitation: 1,
          service_account: 1,
          recent_creation: 1,
        },
      });
      const kept = (outcome.details?.['kept'] ?? []) as { sub: string; reason: string }[];
      expect(Object.fromEntries(kept.map((k) => [k.sub, k.reason]))).toEqual({
        reinvited: 'has_role',
        'active-after': 'recent_activity',
        'login-after': 'recent_login',
        pending: 'pending_invitation',
        service: 'service_account',
        young: 'recent_creation',
      });
      expect(keycloak.deleted).toEqual([]);
      expect(keycloak.users.has('gone-old')).toBe(true);
      expect(await deletions()).toEqual([]);
      expect(await activitySubs()).toEqual(['active-after', 'gone-old', 'holder', 'stranger']);
    });

    it('deletes the accounts, audits them and removes their activity rows', async () => {
      const outcome = await service(false).run();
      expect(outcome.counters).toMatchObject({
        deleted: 2,
        would_delete: 0,
        kept: 6,
        activity_rows_deleted: 1,
        dry_run: 0,
      });
      expect(keycloak.deleted.sort()).toEqual(['dormant-old', 'gone-old']);
      for (const sub of ['recent-removal', 'reinvited', 'active-after', 'young', 'service'])
        expect(keycloak.users.has(sub)).toBe(true);
      const rows = await deletions();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        actor_sub: 'system:account-cleanup',
        actor_org_id: null,
        entity_type: 'organization',
        entity_id: ORG.uibk,
        changes: {
          keycloak_user_id: 'gone-old',
          last_role_removal_at: '2027-03-01T10:00:00.000Z',
          removal_action: 'admin.revoke',
          account_created_at: '2026-01-01T00:00:00.000Z',
          last_activity_at: '2027-02-01T09:00:00.000Z',
          last_login_at: null,
          threshold_months: 12,
        },
      });
      // gone-old (deleted) and stranger (no account) go; holder keeps a role.
      expect(await activitySubs()).toEqual(['active-after', 'holder']);

      // Idempotent: deleted accounts are no longer candidates.
      expect((await service(false).run()).counters).toMatchObject({
        removed_accounts: 8,
        deleted: 0,
        activity_rows_deleted: 0,
      });
    });

    it('keeps an account whose role was granted again after the removal', async () => {
      await tdb.db
        .insertInto('admin_invitations')
        .values({
          email: 'gone-old@x.example',
          role: 'partner_admin',
          organization_id: ORG.uibk,
          token_sha256: createHash('sha256').update('regranted').digest(),
          invited_by: 'admin-1',
          expires_at: '2027-04-08T00:00:00Z',
          accepted_at: '2027-04-02T00:00:00Z',
          accepted_sub: 'gone-old',
        })
        .execute();
      const outcome = await service(false).run();
      expect(outcome.details?.['kept_by_reason']).toMatchObject({ granted_after_removal: 1 });
      expect(keycloak.users.has('gone-old')).toBe(true);
    });

    it('records Keycloak failures and fails the run', async () => {
      keycloak.failWith = 503;
      const failure = await service(false)
        .run()
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(MaintenanceJobError);
      expect((failure as MaintenanceJobError).outcome.counters).toMatchObject({
        checked: 9,
        // 9 accounts and 3 idle activity rows (gone-old, holder, stranger).
        failed: 12,
        deleted: 0,
      });
      expect(await deletions()).toEqual([]);
    });
  });

  describe('admin API', () => {
    let app: INestApplication;
    const requested: { job: string; data: unknown; jobId: string }[] = [];
    let queueAnswer: 'queued' | 'already_queued' = 'queued';
    const auth = { alliance: '', partner: '' };
    const ALLIANCE_SUB = '22222222-2222-4222-8222-222222222222';

    beforeAll(async () => {
      const tokens = await createTestTokens();
      const moduleRef = await Test.createTestingModule({
        controllers: [MaintenanceController],
        providers: [
          { provide: KYSELY, useValue: tdb.db },
          { provide: AdminTokenVerifier, useValue: tokens.verifier },
          { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
          {
            provide: MaintenanceQueue,
            useValue: {
              request: async (job: string, data: unknown, jobId: string) => {
                requested.push({ job, data, jobId });
                return queueAnswer;
              },
            },
          },
          AdminJwtGuard,
          AdminActivityRecorder,
          MaintenanceRunsRepository,
          MaintenanceJobsService,
          { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      auth.alliance = `Bearer ${await tokens.sign(
        { ...BASE_CLAIMS, roles: ['alliance_admin'], org_id: ORG.aurora, idp: 'local' },
        ALLIANCE_SUB,
      )}`;
      auth.partner = `Bearer ${await tokens.sign({
        ...BASE_CLAIMS,
        roles: ['partner_admin'],
        org_id: ORG.uibk,
        idp: 'uibk',
      })}`;
    });

    afterAll(async () => {
      await app?.close();
    });

    const http = () => request(app.getHttpServer());

    it('lists recent runs for alliance administrators only', async () => {
      const response = await http()
        .get('/api/admin/v1/maintenance/runs?limit=2')
        .set('Authorization', auth.alliance)
        .expect(200);
      const list = maintenanceRunList.parse(response.body);
      expect(list.items).toHaveLength(2);
      const [newest, older] = list.items.map((r) => r.started_at);
      expect((newest ?? '') >= (older ?? '')).toBe(true);
      const filtered = maintenanceRunList.parse(
        (
          await http()
            .get('/api/admin/v1/maintenance/runs?job=dormancy')
            .set('Authorization', auth.alliance)
            .expect(200)
        ).body,
      );
      expect(filtered.items.every((r) => r.job === 'dormancy')).toBe(true);
      expect(filtered.items[0]).toMatchObject({ status: 'failed', counters: { revoked: 3 } });
      expect(filtered.items[0]?.duration_ms).toBeGreaterThanOrEqual(0);

      await http()
        .get('/api/admin/v1/maintenance/runs')
        .set('Authorization', auth.partner)
        .expect(403);
      await http()
        .get('/api/admin/v1/maintenance/runs?limit=0')
        .set('Authorization', auth.alliance)
        .expect(400);
      await http().get('/api/admin/v1/maintenance/runs').expect(401);
    });

    it('enqueues a known job on demand and audits the request', async () => {
      const response = await http()
        .post('/api/admin/v1/maintenance/jobs/history-partitions/run')
        .set('Authorization', auth.alliance)
        .expect(202);
      expect(maintenanceJobRunResponse.parse(response.body)).toEqual({
        job: 'history-partitions',
        status: 'queued',
      });
      expect(requested.at(-1)).toEqual({
        job: 'history-partitions',
        data: { trigger: 'manual', triggeredBy: ALLIANCE_SUB },
        jobId: 'manual-history-partitions',
      });
      queueAnswer = 'already_queued';
      const again = await http()
        .post('/api/admin/v1/maintenance/jobs/csv-retention/run')
        .set('Authorization', auth.alliance)
        .expect(202);
      expect(again.body).toEqual({ job: 'csv-retention', status: 'already_queued' });
      const audit = await tdb.db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'maintenance.run_requested')
        .orderBy('id')
        .execute();
      queueAnswer = 'queued';
      const cleanup = await http()
        .post('/api/admin/v1/maintenance/jobs/account-cleanup/run')
        .set('Authorization', auth.alliance)
        .expect(202);
      expect(cleanup.body).toEqual({ job: 'account-cleanup', status: 'queued' });
      expect(requested.at(-1)).toMatchObject({
        job: 'account-cleanup',
        jobId: 'manual-account-cleanup',
      });
      expect(audit.map((a) => [a.actor_sub, a.changes])).toEqual([
        [ALLIANCE_SUB, { job: 'history-partitions', status: 'queued' }],
        [ALLIANCE_SUB, { job: 'csv-retention', status: 'already_queued' }],
      ]);
      // The guard recorded the administrator's activity.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        await tdb.db
          .selectFrom('admin_activity')
          .select(['organization_id'])
          .where('sub', '=', ALLIANCE_SUB)
          .executeTakeFirst(),
      ).toEqual({ organization_id: ORG.aurora });
    });

    it('answers 404 for unknown jobs and 403 for partner administrators', async () => {
      const unknown = await http()
        .post('/api/admin/v1/maintenance/jobs/vacuum-everything/run')
        .set('Authorization', auth.alliance)
        .expect(404);
      expect(unknown.body.errors[0].code).toBe('oecp.request.not_found');
      await http()
        .post('/api/admin/v1/maintenance/jobs/retention/run')
        .set('Authorization', auth.partner)
        .expect(403);
    });
  });
});
