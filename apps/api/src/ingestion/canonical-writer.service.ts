// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import {
  type AcademicSession,
  type AttributeDefinition,
  buildAttributesSchema,
  type Course,
  type CourseAttributes,
  type CourseKind,
  type CourseLevel,
  type CourseOffering,
  type CourseText,
  issuesToProblemErrors,
  type LifecycleStatus,
  type ProblemError,
  resolveLevels,
} from '@oecp/schemas';
import { sql, type Transaction } from 'kysely';
import { loadAttributeDefinitions } from '../attributes/attribute-definitions.js';
import type { Database, HistoryEntityType } from '../db/database.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { jcsSha256 } from './jcs.js';
import { teachingUnits } from './teaching-units.js';
import type {
  AbsenceResult,
  SeenSet,
  UpsertResult,
  WriteContext,
} from './ports/canonical-writer.js';

type Trx = Transaction<Database>;
type Overrides = Record<string, { value: unknown; by: string; at: string }>;

/** Spec §6.2.5: absence is not counted when this share of published courses is missing. */
export const MASS_ABSENCE_RATIO = 0.3;
/** `audit_log.actor_sub` of harvester-driven status changes (spec §6.2.5). */
export const HARVESTER_ACTOR = 'system:harvester';

/** Course columns an override may replace (keys never; spec §5 "Overrides"). */
const COURSE_OVERRIDABLE = [
  'status',
  'kind',
  'ects',
  'level',
  'levels',
  'attributes',
  'eqf_level',
  'teaching_hours',
  'info_url',
  'contact_email',
  'isced_codes',
] as const;

const TEXT_OVERRIDABLE = [
  'title',
  'abstract',
  'description',
  'learning_outcomes',
  'prerequisites',
  'assessment',
  'keywords',
  'is_machine_translated',
] as const;

const OFFERING_OVERRIDABLE = [
  'status',
  'start_date',
  'end_date',
  'enrol_start_date',
  'application_deadline',
  'timezone',
  'teaching_languages',
  'delivery_modes',
  'campus',
  'max_students',
  'alliance_seats',
  'seats_available',
  'seats_updated_at',
  'application_url',
  'application_instructions',
] as const;

/** Source values merged with overrides; overrides win field by field. */
export function applyOverrides<T extends Record<string, unknown>>(
  source: T,
  overrides: Overrides | null | undefined,
  allowed: readonly string[],
): T {
  const effective: Record<string, unknown> = { ...source };
  for (const field of allowed) {
    const override = overrides?.[field];
    if (override && typeof override === 'object' && 'value' in override) {
      effective[field] = override.value;
    }
  }
  return effective as T;
}

/**
 * Effective `level`/`levels` after overrides (decision 18): an override of
 * `levels` decides both; an override of `level` alone makes it the primary of the
 * source levels; otherwise {@link resolveLevels}.
 */
export function effectiveLevels(
  effective: { level: unknown; levels: unknown },
  overrides: Overrides | null | undefined,
): { level: CourseLevel | null; levels: CourseLevel[] } {
  const levels = Array.isArray(effective.levels) ? (effective.levels as CourseLevel[]) : [];
  const level = typeof effective.level === 'string' ? (effective.level as CourseLevel) : null;
  if (overrides?.['levels']) return resolveLevels(null, levels);
  if (overrides?.['level']) {
    return level
      ? resolveLevels(level, [level, ...levels.filter((l) => l !== level)])
      : { level: null, levels: [] };
  }
  return resolveLevels(level, levels);
}

/**
 * Content the canonical schema accepts but the alliance's definitions do not
 * (attributes). Thrown before anything is written; the caller rejects the entity
 * with {@link errors} (pointers relative to the course DTO).
 */
export class CanonicalContentRejected extends Error {
  constructor(readonly errors: ProblemError[]) {
    super(errors.map((e) => `${e.code}${e.pointer ? ` at ${e.pointer}` : ''}`).join('; '));
    this.name = 'CanonicalContentRejected';
  }
}

/** `ext_metadata_history.ext_id` and `sync_errors.ext_id` of an offering (unique per partner). */
export const offeringHistoryId = (courseExtId: string, extOfferingId: string): string =>
  `${courseExtId}#${extOfferingId}`;

export interface RejectedRef {
  entityType: 'course' | 'course_offering' | 'academic_session' | 'organization';
  /** Natural key if known, else the source id; offerings: {@link offeringHistoryId}. */
  extId: string;
  /** For absence bookkeeping of a known course or offering. */
  course?: { extId: string };
  offering?: { courseExtId: string; extOfferingId: string };
}

export interface OfferingUpsertResult extends UpsertResult {
  /** Issues found while resolving references (e.g. unknown academic session). */
  warnings: ProblemError[];
}

function eqBytes(a: Buffer | null | undefined, b: Buffer): boolean {
  return a !== null && a !== undefined && Buffer.compare(a, b) === 0;
}

/**
 * The single write path into the canonical model (spec §6.1), one transaction per
 * entity: content hash (RFC 8785 + SHA-256, before overrides) → unchanged rows only
 * get `last_seen_at`/`absent_count = 0`; otherwise insert or update by natural key
 * with overrides applied on top, children rewritten, `ext_metadata_history`
 * (payloads stored only when they differ from the latest) and `sync_errors`.
 */
@Injectable()
export class CanonicalWriter {
  /** Set on the writer handed out by {@link transaction}: every write joins that transaction. */
  private bound: Trx | null = null;
  /** Definitions read once per bound transaction (an upload sees one consistent set). */
  private definitions: AttributeDefinition[] | null = null;

  constructor(@Inject(KYSELY) private readonly db: Db) {}

  /**
   * Runs `fn` with a writer whose writes all share one transaction (all-or-nothing,
   * e.g. a CSV upload, spec §6.3): any error rolls every write back. Nested calls
   * reuse the outer transaction.
   */
  async transaction<T>(fn: (writer: CanonicalWriter, trx: Trx) => Promise<T>): Promise<T> {
    if (this.bound) return fn(this, this.bound);
    return this.db.transaction().execute(async (trx) => {
      const writer = new CanonicalWriter(trx);
      writer.bound = trx;
      return fn(writer, trx);
    });
  }

  /** One transaction per entity, or the bound one. */
  private run<T>(fn: (trx: Trx) => Promise<T>): Promise<T> {
    return this.bound ? fn(this.bound) : this.db.transaction().execute(fn);
  }

  async upsertAcademicSession(
    ctx: WriteContext,
    session: AcademicSession,
    raw: unknown,
  ): Promise<UpsertResult> {
    const contentHash = jcsSha256(session);
    return this.run(async (trx) => {
      const parentId = session.parent_ext_id
        ? ((
            await trx
              .selectFrom('academic_sessions')
              .select('id')
              .where('organization_id', '=', ctx.organizationId)
              .where('ext_id', '=', session.parent_ext_id)
              .executeTakeFirst()
          )?.id ?? null)
        : null;
      const values = {
        parent_id: parentId,
        session_type: session.session_type,
        name: session.name,
        start_date: session.start_date,
        end_date: session.end_date,
        source_channel: ctx.channel,
      };
      const existing = await trx
        .selectFrom('academic_sessions')
        .select(['id', 'parent_id', 'session_type', 'name', 'start_date', 'end_date'])
        .where('organization_id', '=', ctx.organizationId)
        .where('ext_id', '=', session.ext_id)
        .forUpdate()
        .executeTakeFirst();
      let outcome: UpsertResult['outcome'];
      let entityId: string;
      if (!existing) {
        entityId = (
          await trx
            .insertInto('academic_sessions')
            .values({ organization_id: ctx.organizationId, ext_id: session.ext_id, ...values })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
        outcome = 'created';
      } else {
        entityId = existing.id;
        const same =
          existing.parent_id === parentId &&
          existing.session_type === session.session_type &&
          eqBytes(jcsSha256(existing.name), jcsSha256(session.name)) &&
          existing.start_date === session.start_date &&
          existing.end_date === session.end_date;
        if (same) {
          outcome = 'unchanged';
        } else {
          await trx
            .updateTable('academic_sessions')
            .set(values)
            .where('id', '=', entityId)
            .execute();
          outcome = 'updated';
        }
      }
      await this.history(trx, ctx, 'academic_session', entityId, session.ext_id, raw, 'accepted');
      return { outcome, entityId, contentHash };
    });
  }

  async upsertCourse(
    ctx: WriteContext,
    course: Course,
    raw: unknown,
    warnings: readonly ProblemError[] = [],
  ): Promise<UpsertResult> {
    const contentHash = jcsSha256(course);
    return this.run(async (trx) => {
      await this.checkAttributes(trx, course);
      const existing = await trx
        .selectFrom('courses')
        .select(['id', 'status', 'content_hash', 'overrides', 'absent_count'])
        .where('organization_id', '=', ctx.organizationId)
        .where('ext_id', '=', course.ext_id)
        .forUpdate()
        .executeTakeFirst();

      const effective = applyOverrides(
        {
          status: course.status as LifecycleStatus,
          kind: course.kind as CourseKind,
          ects: course.ects,
          level: course.level ?? null,
          levels: course.levels as unknown,
          attributes: course.attributes as unknown,
          eqf_level: course.eqf_level ?? null,
          teaching_hours: course.teaching_hours ?? null,
          info_url: course.info_url ?? null,
          contact_email: course.contact_email ?? null,
          isced_codes: course.isced_codes as unknown,
        },
        existing?.overrides,
        COURSE_OVERRIDABLE,
      );
      const levels = effectiveLevels(effective, existing?.overrides);

      let outcome: UpsertResult['outcome'];
      let entityId: string;
      if (existing && eqBytes(existing.content_hash, contentHash)) {
        entityId = existing.id;
        const statusChanged = existing.status !== effective.status;
        await trx
          .updateTable('courses')
          .set({
            last_seen_at: ctx.now,
            absent_count: 0,
            ...(statusChanged ? { status: effective.status } : {}),
          })
          .where('id', '=', entityId)
          .execute();
        if (statusChanged) {
          await this.auditStatus(trx, ctx, 'course', entityId, existing, effective.status);
        }
        outcome = statusChanged ? 'updated' : 'unchanged';
      } else {
        // Channel A never sets teaching units (sub-units come from CSV or the form).
        const teachingUnit =
          ctx.channel === 'oeapi'
            ? {}
            : {
                teaching_unit_id: course.teaching_unit_ext_id
                  ? ((await teachingUnits(trx, ctx.organizationId)).get(
                      course.teaching_unit_ext_id,
                    ) ?? null)
                  : null,
              };
        const columns = {
          source_ref: course.source_ref ?? null,
          source_channel: ctx.channel,
          ...teachingUnit,
          status: effective.status,
          kind: effective.kind,
          ects: effective.ects,
          level: levels.level,
          levels: levels.levels,
          attributes: (effective.attributes ?? {}) as CourseAttributes,
          eqf_level: effective.eqf_level,
          teaching_hours: effective.teaching_hours,
          info_url: effective.info_url,
          contact_email: effective.contact_email,
          content_hash: contentHash,
          absent_count: 0,
          last_seen_at: ctx.now,
        };
        if (existing) {
          entityId = existing.id;
          await trx.updateTable('courses').set(columns).where('id', '=', entityId).execute();
          if (existing.status !== effective.status) {
            await this.auditStatus(trx, ctx, 'course', entityId, existing, effective.status);
          }
          outcome = 'updated';
        } else {
          entityId = (
            await trx
              .insertInto('courses')
              .values({ organization_id: ctx.organizationId, ext_id: course.ext_id, ...columns })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
          outcome = 'created';
        }
        await this.writeTexts(trx, entityId, course.texts);
        await this.writeIsced(trx, entityId, effective.isced_codes);
      }

      await this.history(trx, ctx, 'course', entityId, course.ext_id, raw, 'accepted');
      await this.insertIssues(trx, ctx, 'course', course.ext_id, warnings);
      return { outcome, entityId, contentHash };
    });
  }

  async upsertOffering(
    ctx: WriteContext,
    offering: CourseOffering,
    raw: unknown,
    warnings: readonly ProblemError[] = [],
  ): Promise<OfferingUpsertResult> {
    // seats_updated_at is the fetch time and changes on every run: it is not content.
    const { seats_updated_at: _fetchTime, ...hashed } = offering;
    const contentHash = jcsSha256(hashed);
    const historyId = offeringHistoryId(offering.course_ext_id, offering.ext_offering_id);
    return this.run(async (trx) => {
      const issues = [...warnings];
      const course = await trx
        .selectFrom('courses')
        .select('id')
        .where('organization_id', '=', ctx.organizationId)
        .where('ext_id', '=', offering.course_ext_id)
        .executeTakeFirst();
      if (!course) throw new Error(`Course ${offering.course_ext_id} is not in the database`);

      let sessionId: string | null = null;
      if (offering.academic_session_ext_id) {
        sessionId =
          (
            await trx
              .selectFrom('academic_sessions')
              .select('id')
              .where('organization_id', '=', ctx.organizationId)
              .where('ext_id', '=', offering.academic_session_ext_id)
              .executeTakeFirst()
          )?.id ?? null;
        if (!sessionId) {
          issues.push({
            code: 'oecp.content.unknown_session',
            severity: 'warning',
            message: `Unknown academic session ${offering.academic_session_ext_id}; offering stored without it`,
            pointer: '/academicSession',
            ext_id: historyId,
          });
        }
      }

      const existing = await trx
        .selectFrom('course_offerings')
        .select(['id', 'status', 'content_hash', 'overrides', 'absent_count'])
        .where('course_id', '=', course.id)
        .where('ext_offering_id', '=', offering.ext_offering_id)
        .forUpdate()
        .executeTakeFirst();

      const effective = applyOverrides(
        {
          status: offering.status as LifecycleStatus,
          start_date: offering.start_date,
          end_date: offering.end_date,
          enrol_start_date: offering.enrol_start_date ?? null,
          application_deadline: offering.application_deadline ?? null,
          timezone: offering.timezone,
          teaching_languages: offering.teaching_languages as unknown,
          delivery_modes: offering.delivery_modes as unknown,
          campus: offering.campus ?? null,
          max_students: offering.max_students ?? null,
          alliance_seats: offering.alliance_seats ?? null,
          seats_available: offering.seats_available ?? null,
          seats_updated_at: (offering.seats_updated_at ?? null) as string | null,
          application_url: offering.application_url ?? null,
          application_instructions: offering.application_instructions as unknown,
        },
        existing?.overrides,
        OFFERING_OVERRIDABLE,
      );

      let outcome: UpsertResult['outcome'];
      let entityId: string;
      if (existing && eqBytes(existing.content_hash, contentHash)) {
        entityId = existing.id;
        const statusChanged = existing.status !== effective.status;
        await trx
          .updateTable('course_offerings')
          .set({
            last_seen_at: ctx.now,
            absent_count: 0,
            // Seat counts are unchanged and current as of this fetch.
            ...(effective.seats_available !== null && effective.seats_updated_at !== null
              ? { seats_updated_at: effective.seats_updated_at }
              : {}),
            ...(statusChanged ? { status: effective.status } : {}),
          })
          .where('id', '=', entityId)
          .execute();
        if (statusChanged) {
          await this.auditStatus(trx, ctx, 'course_offering', entityId, existing, effective.status);
        }
        outcome = statusChanged ? 'updated' : 'unchanged';
      } else {
        const columns = {
          source_ref: offering.source_ref ?? null,
          source_channel: ctx.channel,
          status: effective.status,
          academic_session_id: sessionId,
          start_date: effective.start_date,
          end_date: effective.end_date,
          enrol_start_date: effective.enrol_start_date,
          application_deadline: effective.application_deadline,
          timezone: effective.timezone,
          teaching_languages: effective.teaching_languages as string[],
          campus: effective.campus,
          max_students: effective.max_students,
          alliance_seats: effective.alliance_seats,
          seats_available: effective.seats_available,
          seats_updated_at: effective.seats_available === null ? null : effective.seats_updated_at,
          application_url: effective.application_url,
          application_instructions: (effective.application_instructions ?? {}) as Record<
            string,
            string
          >,
          content_hash: contentHash,
          absent_count: 0,
          last_seen_at: ctx.now,
        };
        if (existing) {
          entityId = existing.id;
          await trx
            .updateTable('course_offerings')
            .set(columns)
            .where('id', '=', entityId)
            .execute();
          if (existing.status !== effective.status) {
            await this.auditStatus(
              trx,
              ctx,
              'course_offering',
              entityId,
              existing,
              effective.status,
            );
          }
          outcome = 'updated';
        } else {
          entityId = (
            await trx
              .insertInto('course_offerings')
              .values({
                course_id: course.id,
                ext_offering_id: offering.ext_offering_id,
                ...columns,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
          outcome = 'created';
        }
        await trx
          .deleteFrom('course_offering_delivery_modes')
          .where('offering_id', '=', entityId)
          .execute();
        const modes = [...new Set(effective.delivery_modes as string[])];
        if (modes.length > 0) {
          await trx
            .insertInto('course_offering_delivery_modes')
            .values(modes.map((mode_code) => ({ offering_id: entityId, mode_code })))
            .execute();
        }
      }

      await this.history(trx, ctx, 'course_offering', entityId, historyId, raw, 'accepted');
      await this.insertIssues(trx, ctx, 'course_offering', historyId, issues);
      return { outcome, entityId, contentHash, warnings: issues };
    });
  }

  /**
   * Records a rejected source entity: history (`rejected`), errors and warnings.
   * A known course or offering still counts as seen: its `absent_count` is reset
   * and `last_seen_at` set (spec §6.2.5), nothing else changes.
   */
  async reject(
    ctx: WriteContext,
    ref: RejectedRef,
    raw: unknown,
    errors: readonly ProblemError[],
    warnings: readonly ProblemError[] = [],
  ): Promise<void> {
    await this.run(async (trx) => {
      let entityId: string | null = null;
      if (ref.entityType === 'course' && ref.course) {
        entityId =
          (
            await trx
              .updateTable('courses')
              .set({ absent_count: 0, last_seen_at: ctx.now })
              .where('organization_id', '=', ctx.organizationId)
              .where('ext_id', '=', ref.course.extId)
              .returning('id')
              .executeTakeFirst()
          )?.id ?? null;
      } else if (ref.entityType === 'course_offering' && ref.offering) {
        entityId =
          (
            await trx
              .updateTable('course_offerings')
              .set({ absent_count: 0, last_seen_at: ctx.now })
              .where('ext_offering_id', '=', ref.offering.extOfferingId)
              .where('course_id', 'in', (eb) =>
                eb
                  .selectFrom('courses')
                  .select('id')
                  .where('organization_id', '=', ctx.organizationId)
                  .where('ext_id', '=', ref.offering?.courseExtId ?? ''),
              )
              .returning('id')
              .executeTakeFirst()
          )?.id ?? null;
      } else if (ref.entityType === 'organization') {
        entityId = ctx.organizationId;
      }
      await this.history(trx, ctx, ref.entityType, entityId, ref.extId, raw, 'rejected');
      await this.insertIssues(trx, ctx, ref.entityType, ref.extId, [...errors, ...warnings]);
    });
  }

  /** History row of the root organization (matched, never written; spec §6.2.4). */
  async recordOrganization(ctx: WriteContext, extId: string, raw: unknown): Promise<void> {
    await this.run(async (trx) => {
      await this.history(trx, ctx, 'organization', ctx.organizationId, extId, raw, 'accepted');
    });
  }

  /** Run-level issues (listing failures, mass absence…). */
  async recordIssues(
    ctx: WriteContext,
    issues: readonly ProblemError[],
    entityType: string | null = null,
  ): Promise<void> {
    if (issues.length === 0) return;
    await this.insertIssues(this.db, ctx, entityType, null, issues);
  }

  /**
   * Withdrawal by absence (spec §6.2.5), for complete `succeeded`/`partial` runs
   * only (the caller decides). Under 30% of published courses missing: absent
   * draft/published courses and offerings (offerings starting on or after the
   * `since` window) get `absent_count + 1`; at `withdrawAfter` they become
   * `withdrawn`, audited as `system:harvester`, unless a `status` override exists.
   */
  async applyAbsences(
    ctx: WriteContext,
    seen: SeenSet,
    withdrawAfter: number,
  ): Promise<AbsenceResult> {
    const seenCourses = [...seen.courseExtIds];
    const seenOfferings = [...seen.offeringKeys].map((key) => key.split('\u0000'));
    const seenOfferingCourses = seenOfferings.map(([c]) => c ?? '');
    const seenOfferingCodes = seenOfferings.map(([, o]) => o ?? '');

    return this.run(async (trx) => {
      const counts = await trx
        .selectFrom('courses')
        .select([
          sql<string>`count(*)`.as('published'),
          sql<string>`count(*) filter (where not (ext_id = any(${seenCourses}::text[])))`.as(
            'missing',
          ),
        ])
        .where('organization_id', '=', ctx.organizationId)
        .where('deleted_at', 'is', null)
        .where('status', '=', 'published')
        .executeTakeFirstOrThrow();
      const publishedCourses = Number(counts.published);
      const missingPublishedCourses = Number(counts.missing);
      const result: AbsenceResult = {
        incremented: 0,
        withdrawn: 0,
        massAbsence: false,
        publishedCourses,
        missingPublishedCourses,
      };
      if (
        publishedCourses > 0 &&
        missingPublishedCourses / publishedCourses >= MASS_ABSENCE_RATIO
      ) {
        result.massAbsence = true;
        return result;
      }

      const courses = await trx
        .updateTable('courses')
        .set({ absent_count: sql`least(absent_count + 1, 32767)` })
        .where('organization_id', '=', ctx.organizationId)
        .where('deleted_at', 'is', null)
        .where('status', 'in', ['draft', 'published'])
        .where(sql<boolean>`not (ext_id = any(${seenCourses}::text[]))`)
        .returning(['id', 'status', 'absent_count', 'overrides'])
        .execute();

      const offerings = await trx
        .updateTable('course_offerings')
        .set({ absent_count: sql`least(course_offerings.absent_count + 1, 32767)` })
        .from('courses')
        .whereRef('course_offerings.course_id', '=', 'courses.id')
        .where('courses.organization_id', '=', ctx.organizationId)
        .where('course_offerings.deleted_at', 'is', null)
        .where('course_offerings.status', 'in', ['draft', 'published'])
        .where('course_offerings.start_date', '>=', seen.offeringWindowStart)
        .where(
          sql<boolean>`not exists (select 1 from unnest(${seenOfferingCourses}::text[], ${seenOfferingCodes}::text[]) as s(c, o) where s.c = courses.ext_id and s.o = course_offerings.ext_offering_id)`,
        )
        .returning([
          'course_offerings.id as id',
          'course_offerings.status as status',
          'course_offerings.absent_count as absent_count',
          'course_offerings.overrides as overrides',
        ])
        .execute();

      result.incremented = courses.length + offerings.length;
      for (const [table, rows] of [
        ['courses', courses],
        ['course_offerings', offerings],
      ] as const) {
        for (const row of rows) {
          if (row.absent_count < withdrawAfter || row.overrides?.['status']) continue;
          await trx
            .updateTable(table)
            .set({ status: 'withdrawn' })
            .where('id', '=', row.id)
            .execute();
          await trx
            .insertInto('audit_log')
            .values({
              actor_sub: HARVESTER_ACTOR,
              actor_org_id: null,
              action: `${table === 'courses' ? 'course' : 'course_offering'}.withdraw`,
              entity_type: table === 'courses' ? 'course' : 'course_offering',
              entity_id: row.id,
              changes: {
                status: { from: row.status, to: 'withdrawn' },
                reason: 'absence',
                absent_count: row.absent_count,
                sync_run_id: ctx.syncRunId,
              },
            })
            .execute();
          result.withdrawn += 1;
        }
      }
      return result;
    });
  }

  /**
   * Checks the source attributes against the alliance's definitions (decision 18);
   * nothing to check (and no query) when the course has none.
   */
  private async checkAttributes(trx: Trx, course: Course): Promise<void> {
    if (Object.keys(course.attributes ?? {}).length === 0) return;
    const definitions =
      this.bound && this.definitions ? this.definitions : await loadAttributeDefinitions(trx);
    if (this.bound) this.definitions = definitions;
    const checked = buildAttributesSchema(definitions).safeParse(course.attributes);
    if (checked.success) return;
    const errors = issuesToProblemErrors(checked.error.issues, {
      fallback: 'oecp.content.invalid_attribute_value',
    }).map((e) => ({ ...e, pointer: `/attributes${e.pointer ?? ''}`, ext_id: course.ext_id }));
    throw new CanonicalContentRejected(errors);
  }

  private async writeTexts(
    trx: Trx,
    courseId: string,
    texts: Readonly<Record<string, CourseText>>,
  ): Promise<void> {
    const existing = await trx
      .selectFrom('course_texts')
      .select(['lang', 'overrides'])
      .where('course_id', '=', courseId)
      .execute();
    const overridesByLang = new Map(existing.map((row) => [row.lang, row.overrides]));
    for (const [lang, text] of Object.entries(texts)) {
      const effective = applyOverrides(
        {
          title: text.title,
          abstract: text.abstract ?? null,
          description: text.description ?? null,
          learning_outcomes: text.learning_outcomes ?? null,
          prerequisites: text.prerequisites ?? null,
          assessment: text.assessment ?? null,
          keywords: text.keywords as unknown,
          is_machine_translated: text.is_machine_translated as unknown,
        },
        overridesByLang.get(lang),
        TEXT_OVERRIDABLE,
      );
      const values = {
        ...effective,
        keywords: effective.keywords as string[],
        is_machine_translated: effective.is_machine_translated as boolean,
      };
      await trx
        .insertInto('course_texts')
        .values({ course_id: courseId, lang, ...values })
        .onConflict((oc) => oc.columns(['course_id', 'lang']).doUpdateSet(values))
        .execute();
    }
    // Languages the source no longer has go, except English and rows carrying overrides.
    const stale = existing
      .filter((row) => !(row.lang in texts))
      .filter((row) => row.lang !== 'en' && Object.keys(row.overrides ?? {}).length === 0)
      .map((row) => row.lang);
    if (stale.length > 0) {
      await trx
        .deleteFrom('course_texts')
        .where('course_id', '=', courseId)
        .where('lang', 'in', stale)
        .execute();
    }
  }

  private async writeIsced(trx: Trx, courseId: string, codes: unknown): Promise<void> {
    await trx.deleteFrom('course_isced_codes').where('course_id', '=', courseId).execute();
    const list = Array.isArray(codes)
      ? [...new Set(codes.filter((c): c is string => typeof c === 'string'))]
      : [];
    if (list.length === 0) return;
    await trx
      .insertInto('course_isced_codes')
      .values(
        list.map((isced_code, i) => ({
          course_id: courseId,
          isced_code,
          broad_code: isced_code.slice(0, 2),
          is_primary: i === 0,
        })),
      )
      .execute();
  }

  private async auditStatus(
    trx: Trx,
    ctx: WriteContext,
    entityType: 'course' | 'course_offering',
    entityId: string,
    before: { status: LifecycleStatus; absent_count: number },
    after: LifecycleStatus,
  ): Promise<void> {
    const republished = before.status === 'withdrawn' && before.absent_count > 0;
    await trx
      .insertInto('audit_log')
      .values({
        actor_sub: ctx.actor,
        actor_org_id: null,
        action: `${entityType}.${republished ? 'republish' : 'status'}`,
        entity_type: entityType,
        entity_id: entityId,
        changes: {
          status: { from: before.status, to: after },
          ...(republished ? { reason: 'seen_again' } : {}),
          sync_run_id: ctx.syncRunId,
        },
      })
      .execute();
  }

  /** Stores the raw payload unless it equals the latest one of the same entity (spec §5 "History"). */
  private async history(
    trx: Trx,
    ctx: WriteContext,
    entityType: HistoryEntityType,
    entityId: string | null,
    extId: string,
    raw: unknown,
    result: 'accepted' | 'rejected',
  ): Promise<void> {
    const payloadSha = jcsSha256(raw ?? null);
    const latest = await trx
      .selectFrom('ext_metadata_history')
      .select('payload_sha256')
      .where('organization_id', '=', ctx.organizationId)
      .where('entity_type', '=', entityType)
      .where('ext_id', '=', extId)
      .orderBy('received_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (latest && eqBytes(latest.payload_sha256, payloadSha)) return;
    await trx
      .insertInto('ext_metadata_history')
      .values({
        sync_run_id: ctx.syncRunId,
        organization_id: ctx.organizationId,
        entity_type: entityType,
        entity_id: entityId,
        ext_id: extId,
        channel: ctx.channel,
        schema_version: ctx.schemaVersion,
        payload_sha256: payloadSha,
        validation_result: result,
        // jsonb: arrays must be serialised explicitly (pg would send a PostgreSQL array).
        raw_payload: JSON.stringify(raw ?? null),
      })
      .execute();
  }

  private async insertIssues(
    db: Db | Trx,
    ctx: WriteContext,
    entityType: string | null,
    extId: string | null,
    issues: readonly ProblemError[],
  ): Promise<void> {
    if (issues.length === 0) return;
    await db
      .insertInto('sync_errors')
      .values(
        issues.map((issue) => ({
          sync_run_id: ctx.syncRunId,
          severity: issue.severity,
          code: issue.code,
          message: issue.message.slice(0, 2000),
          entity_type: entityType,
          ext_id: extId ?? issue.ext_id ?? null,
          file: issue.file ?? null,
          row_number: issue.row ?? null,
          column_name: issue.column ?? null,
          json_pointer: issue.pointer ?? null,
        })),
      )
      .execute();
  }
}
