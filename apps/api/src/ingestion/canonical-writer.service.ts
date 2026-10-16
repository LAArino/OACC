// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  type AcademicSession,
  type AttributeDefinition,
  buildAttributesSchema,
  type Course,
  type CourseAttributes,
  type CourseCompleteness,
  type CourseKind,
  type CourseLevel,
  type CourseOffering,
  type CourseText,
  handbookIncompleteMessage,
  issuesToProblemErrors,
  type LifecycleStatus,
  type ProblemError,
  type PublishRuleMode,
  resolveLevels,
} from '@oecp/schemas';
import { sql, type Transaction } from 'kysely';
import { loadAttributeDefinitions } from '../attributes/attribute-definitions.js';
import type { Database, HistoryEntityType } from '../db/database.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { loadCompleteness } from './handbook-completeness.js';
import { jcsSha256 } from './jcs.js';
import { minimiseRawPayload } from './oeapi/raw-payload.js';
import {
  clearOverrides,
  hasOverrides,
  type OverrideMap,
  setOverrides,
  withSources,
} from './overrides.js';
import { teachingUnits } from './teaching-units.js';
import type {
  AbsenceResult,
  SeenSet,
  UpsertResult,
  WriteContext,
} from './ports/canonical-writer.js';

type Trx = Transaction<Database>;
type Overrides = OverrideMap;

/** Spec §6.2.5: absence is not counted when this share of published courses is missing. */
export const MASS_ABSENCE_RATIO = 0.3;
/** `audit_log.actor_sub` of harvester-driven status changes (spec §6.2.5). */
export const HARVESTER_ACTOR = 'system:harvester';

/** Injection token of the deployment's `OECP_PUBLISH_RULE` (decision 21c); `warn` when absent. */
export const PUBLISH_RULE = Symbol('PUBLISH_RULE');

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
  'instructors',
] as const;

const TEXT_OVERRIDABLE = [
  'title',
  'abstract',
  'description',
  'learning_outcomes',
  'prerequisites',
  'assessment',
  'mode_of_repetition',
  'methods',
  'literature',
  'privacy_notice',
  'remarks',
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

/** Effective course values in the writer's shapes (ISCED codes primary first). */
export interface CourseEffective {
  status: LifecycleStatus;
  kind: CourseKind;
  ects: number;
  level: CourseLevel | null;
  levels: CourseLevel[];
  attributes: CourseAttributes;
  eqf_level: number | null;
  teaching_hours: number | null;
  info_url: string | null;
  contact_email: string | null;
  isced_codes: string[];
  instructors: string[];
}

export interface TextEffective {
  title: string;
  abstract: string | null;
  description: string | null;
  learning_outcomes: string | null;
  prerequisites: string | null;
  assessment: string | null;
  mode_of_repetition: string | null;
  methods: string | null;
  literature: string | null;
  privacy_notice: string | null;
  remarks: string | null;
  keywords: string[];
  is_machine_translated: boolean;
}

export interface OfferingEffective {
  status: LifecycleStatus;
  start_date: string;
  end_date: string;
  enrol_start_date: string | null;
  application_deadline: string | null;
  timezone: string;
  teaching_languages: string[];
  delivery_modes: string[];
  campus: string | null;
  max_students: number | null;
  alliance_seats: number | null;
  seats_available: number | null;
  seats_updated_at: string | null;
  application_url: string | null;
  application_instructions: Record<string, string>;
}

/** Overrides to store (`set`, values in the writer's shapes) and to remove (`clear`). */
export interface OverrideChange {
  set: Readonly<Record<string, unknown>>;
  clear: readonly string[];
}

export interface CourseOverrideChange extends OverrideChange {
  /** Per language (`course_texts`); a language without row needs `title` in `set`. */
  texts: Readonly<Record<string, OverrideChange>>;
}

export interface OverrideOutcome {
  outcome: 'updated' | 'unchanged';
  entityId: string;
  /** Keys whose override or effective value changed (`texts.<lang>.<field>` for texts). */
  changed: string[];
  /** Effective status the overrides ask for (courses; before the publication rule). */
  requestedStatus?: LifecycleStatus;
}

/** Result of {@link CanonicalWriter.applyPublishRule}. */
export interface PublishRuleOutcome {
  courseId: string;
  extId: string;
  completeness: CourseCompleteness;
  /** Status after the rule. */
  status: LifecycleStatus;
  /** The `oecp.content.handbook_incomplete` warning recorded in `sync_errors`, if any. */
  warning: ProblemError | null;
}

/** Final check of the effective record before anything is written; throws to refuse. */
export type CourseOverrideCheck = (next: {
  course: CourseEffective;
  texts: Record<string, TextEffective>;
}) => void | Promise<void>;
export type OfferingOverrideCheck = (next: OfferingEffective) => void | Promise<void>;

const same = (a: unknown, b: unknown): boolean =>
  Buffer.compare(jcsSha256(a ?? null), jcsSha256(b ?? null)) === 0;

const isoOrNull = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();

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
  /** `OECP_PUBLISH_RULE` (decision 21c). */
  readonly publishRule: PublishRuleMode;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    @Optional() @Inject(PUBLISH_RULE) publishRule?: PublishRuleMode,
  ) {
    this.publishRule = publishRule ?? 'warn';
  }

  /**
   * Runs `fn` with a writer whose writes all share one transaction (all-or-nothing,
   * e.g. a CSV upload, spec §6.3): any error rolls every write back. Nested calls
   * reuse the outer transaction.
   */
  async transaction<T>(fn: (writer: CanonicalWriter, trx: Trx) => Promise<T>): Promise<T> {
    if (this.bound) return fn(this, this.bound);
    return this.db.transaction().execute(async (trx) => {
      const writer = new CanonicalWriter(trx, this.publishRule);
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
      const found = await trx
        .selectFrom('courses')
        .select(['id', 'status', 'content_hash', 'overrides', 'absent_count', 'deleted_at'])
        .where('organization_id', '=', ctx.organizationId)
        .where('ext_id', '=', course.ext_id)
        .forUpdate()
        .executeTakeFirst();
      const revived = found?.deleted_at
        ? await this.reviveCourse(trx, ctx, found, course.ext_id)
        : false;
      const dropped =
        found && !revived
          ? await this.dropLeftoverCourseOverrides(trx, ctx, found, course.ext_id)
          : false;
      const existing =
        found && (revived || dropped) ? { ...found, overrides: {}, content_hash: null } : found;

      const source = {
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
        instructors: course.instructors as unknown,
      };
      const effective = applyOverrides(source, existing?.overrides, COURSE_OVERRIDABLE);
      const levels = effectiveLevels(effective, existing?.overrides);
      const status = this.heldStatus(existing?.status, effective.status);

      let outcome: UpsertResult['outcome'];
      let entityId: string;
      if (existing && eqBytes(existing.content_hash, contentHash)) {
        entityId = existing.id;
        const statusChanged = existing.status !== status;
        await trx
          .updateTable('courses')
          .set({
            last_seen_at: ctx.now,
            absent_count: 0,
            ...(statusChanged ? { status } : {}),
          })
          .where('id', '=', entityId)
          .execute();
        if (statusChanged) {
          await this.auditStatus(trx, ctx, 'course', entityId, existing, status);
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
          status,
          kind: effective.kind,
          ects: effective.ects,
          level: levels.level,
          levels: levels.levels,
          attributes: (effective.attributes ?? {}) as CourseAttributes,
          eqf_level: effective.eqf_level,
          teaching_hours: effective.teaching_hours,
          info_url: effective.info_url,
          contact_email: effective.contact_email,
          instructors: (effective.instructors ?? []) as string[],
          content_hash: contentHash,
          absent_count: 0,
          last_seen_at: ctx.now,
          // Overrides keep the source values they hide (restored when removed).
          ...(hasOverrides(existing?.overrides)
            ? {
                overrides: withSources(existing.overrides, {
                  ...source,
                  ...resolveLevels(course.level ?? null, course.levels),
                }),
              }
            : {}),
        };
        if (existing) {
          entityId = existing.id;
          await trx.updateTable('courses').set(columns).where('id', '=', entityId).execute();
          if (existing.status !== status) {
            await this.auditStatus(trx, ctx, 'course', entityId, existing, status);
          }
          outcome = revived ? 'created' : 'updated';
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
      return { outcome, entityId, contentHash, requestedStatus: effective.status };
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
            code: 'oecp.content.session_ignored',
            severity: 'warning',
            message: `Unknown academic session ${offering.academic_session_ext_id}; offering stored without it`,
            pointer: '/academicSession',
            ext_id: historyId,
          });
        }
      }

      const found = await trx
        .selectFrom('course_offerings')
        .select(['id', 'status', 'content_hash', 'overrides', 'absent_count', 'deleted_at'])
        .where('course_id', '=', course.id)
        .where('ext_offering_id', '=', offering.ext_offering_id)
        .forUpdate()
        .executeTakeFirst();
      const revived = found?.deleted_at
        ? await this.reviveOffering(trx, ctx, found, historyId)
        : false;
      const dropped =
        found && !revived
          ? await this.dropLeftoverOfferingOverrides(trx, ctx, found, historyId)
          : false;
      const existing =
        found && (revived || dropped) ? { ...found, overrides: {}, content_hash: null } : found;

      const source = {
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
      };
      const effective = applyOverrides(source, existing?.overrides, OFFERING_OVERRIDABLE);

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
          ...(hasOverrides(existing?.overrides)
            ? { overrides: withSources(existing.overrides, source) }
            : {}),
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
          outcome = revived ? 'created' : 'updated';
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
   * Stores and removes overrides of a course and its texts (spec §5 "Overrides",
   * §6.5 form in `oeapi` organizations). The source values stay in place: only
   * `overrides` and the effective columns change; `content_hash` too only when a
   * removed override has no recorded source (the next harvest rewrites the record).
   * A language the source does not have exists through its `title` override and
   * goes when that override is removed. `check` sees the effective record first.
   */
  async applyCourseOverrides(
    ctx: WriteContext,
    courseId: string,
    change: CourseOverrideChange,
    raw: unknown,
    check?: CourseOverrideCheck,
  ): Promise<OverrideOutcome> {
    return this.run(async (trx) => {
      const row = await trx
        .selectFrom('courses')
        .selectAll()
        .where('id', '=', courseId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const isced = await trx
        .selectFrom('course_isced_codes')
        .select('isced_code')
        .where('course_id', '=', courseId)
        .orderBy('is_primary', 'desc')
        .orderBy('isced_code')
        .execute();
      const current: CourseEffective = {
        status: row.status,
        kind: row.kind,
        ects: Number(row.ects),
        level: row.level as CourseLevel | null,
        levels: row.levels as CourseLevel[],
        attributes: row.attributes,
        eqf_level: row.eqf_level,
        teaching_hours: row.teaching_hours === null ? null : Number(row.teaching_hours),
        info_url: row.info_url,
        contact_email: row.contact_email,
        isced_codes: isced.map((r) => r.isced_code),
        instructors: row.instructors,
      };
      const at = ctx.now.toISOString();
      const cleared = clearOverrides(row.overrides, change.clear);
      const overrides = setOverrides(
        cleared.map,
        change.set,
        current as unknown as Record<string, unknown>,
        ctx.actor,
        at,
      );
      const next = { ...current, ...cleared.restored, ...change.set } as CourseEffective;
      if ('levels' in change.set || 'levels' in cleared.restored) {
        Object.assign(next, resolveLevels(null, next.levels ?? []));
      }

      const textRows = await trx
        .selectFrom('course_texts')
        .select([
          'lang',
          'title',
          'abstract',
          'description',
          'learning_outcomes',
          'prerequisites',
          'assessment',
          'mode_of_repetition',
          'methods',
          'literature',
          'privacy_notice',
          'remarks',
          'keywords',
          'is_machine_translated',
          'overrides',
        ])
        .where('course_id', '=', courseId)
        .forUpdate()
        .execute();
      const texts: Record<string, TextEffective> = {};
      for (const { lang, overrides: _o, ...text } of textRows) texts[lang] = text;
      const textWrites: {
        lang: string;
        next: TextEffective | null;
        overrides: Overrides;
        changed: string[];
      }[] = [];
      const changed: string[] = [];
      for (const [lang, textChange] of Object.entries(change.texts)) {
        const existing = textRows.find((r) => r.lang === lang);
        const before = texts[lang];
        const currentText: Record<string, unknown> = before
          ? { ...before }
          : Object.fromEntries(TEXT_OVERRIDABLE.map((f) => [f, null]));
        const textCleared = clearOverrides(existing?.overrides, textChange.clear);
        const textOverrides = setOverrides(
          textCleared.map,
          textChange.set,
          currentText,
          ctx.actor,
          at,
        );
        // No row, or a title override without source: the source lacks this language.
        const titleEntry = existing?.overrides?.['title'];
        const sourceless =
          !existing ||
          (titleEntry !== undefined && 'source' in titleEntry && titleEntry.source === null);
        let nextText: TextEffective | null;
        if (sourceless && !textOverrides['title']) {
          nextText = null;
        } else {
          const merged = { ...currentText, ...textCleared.restored, ...textChange.set };
          if (typeof merged['title'] !== 'string' || merged['title'] === '') {
            throw new CanonicalContentRejected([
              {
                code: 'oecp.content.invalid_value',
                severity: 'error',
                message: `texts.${lang}.title is required`,
                pointer: `/texts/${lang}/title`,
              },
            ]);
          }
          nextText = {
            ...(merged as unknown as TextEffective),
            keywords: (merged['keywords'] as string[] | null) ?? [],
            is_machine_translated: (merged['is_machine_translated'] as boolean | null) ?? false,
          };
        }
        const fields = TEXT_OVERRIDABLE.filter(
          (f) =>
            !same(before?.[f], nextText?.[f]) || !same(existing?.overrides?.[f], textOverrides[f]),
        );
        if (nextText) texts[lang] = nextText;
        else delete texts[lang];
        textWrites.push({ lang, next: nextText, overrides: textOverrides, changed: fields });
        changed.push(...fields.map((f) => `texts.${lang}.${f}`));
      }

      const fields = COURSE_OVERRIDABLE.filter(
        (f) =>
          !same(current[f as keyof CourseEffective], next[f as keyof CourseEffective]) ||
          !same(row.overrides?.[f], overrides[f]),
      );
      changed.unshift(...fields);
      await check?.({ course: next, texts });
      const status = this.heldStatus(current.status, next.status);

      if (fields.length > 0) {
        await trx
          .updateTable('courses')
          .set({
            overrides,
            status,
            kind: next.kind,
            ects: next.ects,
            level: next.level,
            levels: next.levels,
            attributes: next.attributes,
            eqf_level: next.eqf_level,
            teaching_hours: next.teaching_hours,
            info_url: next.info_url,
            contact_email: next.contact_email,
            instructors: next.instructors,
            ...(cleared.unknownSource.length > 0 ? { content_hash: null } : {}),
          })
          .where('id', '=', courseId)
          .execute();
        if (!same(current.isced_codes, next.isced_codes)) {
          await this.writeIsced(trx, courseId, next.isced_codes);
        }
        if (current.status !== status) {
          await this.auditStatus(trx, ctx, 'course', courseId, row, status);
        }
      }
      for (const write of textWrites) {
        if (write.changed.length === 0) continue;
        if (!write.next) {
          await trx
            .deleteFrom('course_texts')
            .where('course_id', '=', courseId)
            .where('lang', '=', write.lang)
            .execute();
          continue;
        }
        const values = { ...write.next, overrides: write.overrides };
        await trx
          .insertInto('course_texts')
          .values({ course_id: courseId, lang: write.lang, ...values })
          .onConflict((oc) => oc.columns(['course_id', 'lang']).doUpdateSet(values))
          .execute();
      }
      await this.history(trx, ctx, 'course', courseId, row.ext_id, raw, 'accepted');
      return {
        outcome: changed.length > 0 ? 'updated' : 'unchanged',
        entityId: courseId,
        changed,
        requestedStatus: next.status,
      };
    });
  }

  /**
   * Stores and removes overrides of an offering; see {@link applyCourseOverrides}.
   * `seats_updated_at` is stored with `seats_available` by the caller.
   */
  async applyOfferingOverrides(
    ctx: WriteContext,
    offeringId: string,
    change: OverrideChange,
    raw: unknown,
    check?: OfferingOverrideCheck,
  ): Promise<OverrideOutcome> {
    return this.run(async (trx) => {
      const row = await trx
        .selectFrom('course_offerings as o')
        .innerJoin('courses as c', 'c.id', 'o.course_id')
        .selectAll('o')
        .select('c.ext_id as course_ext_id')
        .where('o.id', '=', offeringId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const modes = await trx
        .selectFrom('course_offering_delivery_modes')
        .select('mode_code')
        .where('offering_id', '=', offeringId)
        .orderBy('mode_code')
        .execute();
      const current: OfferingEffective = {
        status: row.status,
        start_date: row.start_date,
        end_date: row.end_date,
        enrol_start_date: row.enrol_start_date,
        application_deadline: row.application_deadline,
        timezone: row.timezone,
        teaching_languages: row.teaching_languages,
        delivery_modes: modes.map((m) => m.mode_code),
        campus: row.campus,
        max_students: row.max_students,
        alliance_seats: row.alliance_seats,
        seats_available: row.seats_available,
        seats_updated_at: isoOrNull(row.seats_updated_at),
        application_url: row.application_url,
        application_instructions: row.application_instructions,
      };
      const cleared = clearOverrides(row.overrides, change.clear);
      const overrides = setOverrides(
        cleared.map,
        change.set,
        current as unknown as Record<string, unknown>,
        ctx.actor,
        ctx.now.toISOString(),
      );
      const next = { ...current, ...cleared.restored, ...change.set } as OfferingEffective;
      if (next.seats_available === null) next.seats_updated_at = null;
      const changed = OFFERING_OVERRIDABLE.filter(
        (f) => !same(current[f], next[f]) || !same(row.overrides?.[f], overrides[f]),
      );
      await check?.(next);

      if (changed.length > 0) {
        await trx
          .updateTable('course_offerings')
          .set({
            overrides,
            status: next.status,
            start_date: next.start_date,
            end_date: next.end_date,
            enrol_start_date: next.enrol_start_date,
            application_deadline: next.application_deadline,
            timezone: next.timezone,
            teaching_languages: next.teaching_languages,
            campus: next.campus,
            max_students: next.max_students,
            alliance_seats: next.alliance_seats,
            seats_available: next.seats_available,
            seats_updated_at: next.seats_updated_at,
            application_url: next.application_url,
            application_instructions: next.application_instructions,
            ...(cleared.unknownSource.length > 0 ? { content_hash: null } : {}),
          })
          .where('id', '=', offeringId)
          .execute();
        if (!same(current.delivery_modes, next.delivery_modes)) {
          await trx
            .deleteFrom('course_offering_delivery_modes')
            .where('offering_id', '=', offeringId)
            .execute();
          const list = [...new Set(next.delivery_modes)];
          if (list.length > 0) {
            await trx
              .insertInto('course_offering_delivery_modes')
              .values(list.map((mode_code) => ({ offering_id: offeringId, mode_code })))
              .execute();
          }
        }
        if (current.status !== next.status) {
          await this.auditStatus(trx, ctx, 'course_offering', offeringId, row, next.status);
        }
      }
      await this.history(
        trx,
        ctx,
        'course_offering',
        offeringId,
        offeringHistoryId(row.course_ext_id, row.ext_offering_id),
        raw,
        'accepted',
      );
      return {
        outcome: changed.length > 0 ? 'updated' : 'unchanged',
        entityId: offeringId,
        changed,
      };
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
   * The IT Handbook publication rule (decision 21c, spec §6.1), applied after a
   * channel has written a course and its offerings. `requested` is the status the
   * channel asks for ({@link UpsertResult.requestedStatus}); without it, the
   * stored status (so a later offering save can unpublish, never publish).
   *
   * When the requested status is `published` the stored, effective values are
   * checked: an incomplete course gets the warning
   * `oecp.content.handbook_incomplete` (missing fields in the message) in the
   * run's `sync_errors`; in `warn` mode it is published, in `enforce` mode it is
   * stored as `draft`. A complete course is published (in `enforce` mode the
   * writer holds publication until this check). Status changes are audited with
   * `publish_rule`. Never throws for an incomplete course.
   */
  async applyPublishRule(
    ctx: WriteContext,
    course: { id: string } | { extId: string },
    requested?: LifecycleStatus,
  ): Promise<PublishRuleOutcome | null> {
    return this.run(async (trx) => {
      let query = trx
        .selectFrom('courses')
        .select(['id', 'ext_id', 'status'])
        .where('organization_id', '=', ctx.organizationId)
        .where('deleted_at', 'is', null);
      query =
        'id' in course
          ? query.where('id', '=', course.id)
          : query.where('ext_id', '=', course.extId);
      const row = await query.forUpdate().executeTakeFirst();
      if (!row) return null;
      const result = (await loadCompleteness(trx, [row.id])).get(row.id) ?? {
        complete: false,
        missing: [],
      };
      const target = requested ?? row.status;
      if (target !== 'published') {
        return {
          courseId: row.id,
          extId: row.ext_id,
          completeness: result,
          status: row.status,
          warning: null,
        };
      }
      let warning: ProblemError | null = null;
      let next: LifecycleStatus = 'published';
      if (!result.complete) {
        warning = {
          code: 'oecp.content.handbook_incomplete',
          severity: 'warning',
          message: handbookIncompleteMessage(result.missing),
          ext_id: row.ext_id,
        };
        if (this.publishRule === 'enforce') next = 'draft';
      }
      if (row.status !== next) {
        await trx.updateTable('courses').set({ status: next }).where('id', '=', row.id).execute();
        await trx
          .insertInto('audit_log')
          .values({
            actor_sub: ctx.actor,
            actor_org_id: null,
            action: 'course.status',
            entity_type: 'course',
            entity_id: row.id,
            changes: {
              status: { from: row.status, to: next },
              publish_rule: this.publishRule,
              ...(result.complete ? {} : { missing: result.missing }),
              sync_run_id: ctx.syncRunId,
            },
          })
          .execute();
      }
      if (warning) await this.insertIssues(trx, ctx, 'course', row.ext_id, [warning]);
      return {
        courseId: row.id,
        extId: row.ext_id,
        completeness: result,
        status: next,
        warning,
      };
    });
  }

  /**
   * Status to store for a course write: in `enforce` mode a course that is not
   * yet published is not published by the write itself but by
   * {@link applyPublishRule} once its offerings are in place (new courses wait as
   * `draft`, others keep their status).
   */
  private heldStatus(
    current: LifecycleStatus | undefined,
    requested: LifecycleStatus,
  ): LifecycleStatus {
    if (this.publishRule !== 'enforce' || requested !== 'published' || current === 'published') {
      return requested;
    }
    return current ?? 'draft';
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
      .select(['lang', 'title', 'overrides'])
      .where('course_id', '=', courseId)
      .execute();
    const overridesByLang = new Map(existing.map((row) => [row.lang, row.overrides]));
    for (const [lang, text] of Object.entries(texts)) {
      const source = {
        title: text.title,
        abstract: text.abstract ?? null,
        description: text.description ?? null,
        learning_outcomes: text.learning_outcomes ?? null,
        prerequisites: text.prerequisites ?? null,
        assessment: text.assessment ?? null,
        mode_of_repetition: text.mode_of_repetition ?? null,
        methods: text.methods ?? null,
        literature: text.literature ?? null,
        privacy_notice: text.privacy_notice ?? null,
        remarks: text.remarks ?? null,
        keywords: text.keywords as unknown,
        is_machine_translated: text.is_machine_translated as unknown,
      };
      const overrides = overridesByLang.get(lang);
      const effective = applyOverrides(source, overrides, TEXT_OVERRIDABLE);
      const values = {
        ...effective,
        keywords: effective.keywords as string[],
        is_machine_translated: effective.is_machine_translated as boolean,
        ...(hasOverrides(overrides) ? { overrides: withSources(overrides, source) } : {}),
      };
      // Only a real change updates the row, so `course_texts.updated_at` (public
      // `texts.<lang>.updated_at`) dates the language's last change, not the course's.
      const columns = Object.keys(values) as (keyof typeof values)[];
      await trx
        .insertInto('course_texts')
        .values({ course_id: courseId, lang, ...values })
        .onConflict((oc) =>
          oc
            .columns(['course_id', 'lang'])
            .doUpdateSet(values)
            .where(
              sql<boolean>`(${sql.join(columns.map((c) => sql.ref(`course_texts.${c}`)))}) IS DISTINCT FROM (${sql.join(columns.map((c) => sql.ref(`excluded.${c}`)))})`,
            ),
        )
        .execute();
    }
    // Languages the source no longer has but overrides keep: no source value any more,
    // and the title becomes an override (the language now exists through overrides only).
    for (const row of existing) {
      if (row.lang in texts || !hasOverrides(row.overrides)) continue;
      const entries = Object.values(row.overrides);
      if (row.overrides['title'] && entries.every((e) => 'source' in e && e.source === null)) {
        continue;
      }
      const first = Object.values(row.overrides)[0] as { by: string; at: string };
      const overrides = withSources(row.overrides, {});
      overrides['title'] ??= { value: row.title, by: first.by, at: first.at, source: null };
      await trx
        .updateTable('course_texts')
        .set({ overrides })
        .where('course_id', '=', courseId)
        .where('lang', '=', row.lang)
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

  /**
   * A write to a soft-deleted course brings it back (spec §8.2: a code deleted in
   * error comes back when it is written again, from any channel): `deleted_at`
   * cleared, overrides dropped, hash reset so the write applies; audited
   * `course.revive`. Its deleted offerings stay deleted until written again.
   */
  private async reviveCourse(
    trx: Trx,
    ctx: WriteContext,
    course: { id: string; overrides: Record<string, unknown> | null },
    extId: string,
  ): Promise<true> {
    await trx
      .updateTable('courses')
      .set({ deleted_at: null, overrides: {}, content_hash: null })
      .where('id', '=', course.id)
      .execute();
    await trx
      .updateTable('course_texts')
      .set({ overrides: {} })
      .where('course_id', '=', course.id)
      .execute();
    await this.auditRevive(
      trx,
      ctx,
      'course',
      course.id,
      Object.keys(course.overrides ?? {}),
      extId,
    );
    return true;
  }

  private async reviveOffering(
    trx: Trx,
    ctx: WriteContext,
    offering: { id: string; overrides: Record<string, unknown> | null },
    historyId: string,
  ): Promise<true> {
    await trx
      .updateTable('course_offerings')
      .set({ deleted_at: null, overrides: {}, content_hash: null })
      .where('id', '=', offering.id)
      .execute();
    await this.auditRevive(
      trx,
      ctx,
      'course_offering',
      offering.id,
      Object.keys(offering.overrides ?? {}),
      historyId,
    );
    return true;
  }

  /**
   * Spec §6.5: overrides exist only while the authoritative channel is `oeapi`. A
   * CSV or form write (only possible when it is not) drops the overrides left
   * from an `oeapi` period, the course's text overrides included, and resets the
   * hash so the write applies; audited `course.overrides_drop`. The form drops
   * them itself before writing (its save audit row lists them), so this applies
   * to CSV runs in practice. Harvests keep overrides.
   */
  private async dropLeftoverCourseOverrides(
    trx: Trx,
    ctx: WriteContext,
    course: { id: string; overrides: Record<string, unknown> | null },
    extId: string,
  ): Promise<boolean> {
    if (ctx.channel === 'oeapi') return false;
    const texts = await trx
      .selectFrom('course_texts')
      .select(['lang', 'overrides'])
      .where('course_id', '=', course.id)
      .where(sql<boolean>`overrides <> '{}'::jsonb`)
      .orderBy('lang')
      .execute();
    const keys = [
      ...Object.keys(course.overrides ?? {}),
      ...texts.flatMap((t) => Object.keys(t.overrides).map((field) => `texts.${t.lang}.${field}`)),
    ];
    if (keys.length === 0) return false;
    await trx
      .updateTable('courses')
      .set({ overrides: {}, content_hash: null })
      .where('id', '=', course.id)
      .execute();
    if (texts.length > 0) {
      await trx
        .updateTable('course_texts')
        .set({ overrides: {} })
        .where('course_id', '=', course.id)
        .execute();
    }
    await this.auditOverridesDrop(trx, ctx, 'course', course.id, keys, extId);
    return true;
  }

  /** {@link dropLeftoverCourseOverrides} for an offering (`course_offering.overrides_drop`). */
  private async dropLeftoverOfferingOverrides(
    trx: Trx,
    ctx: WriteContext,
    offering: { id: string; overrides: Record<string, unknown> | null },
    historyId: string,
  ): Promise<boolean> {
    const keys = Object.keys(offering.overrides ?? {});
    if (ctx.channel === 'oeapi' || keys.length === 0) return false;
    await trx
      .updateTable('course_offerings')
      .set({ overrides: {}, content_hash: null })
      .where('id', '=', offering.id)
      .execute();
    await this.auditOverridesDrop(trx, ctx, 'course_offering', offering.id, keys, historyId);
    return true;
  }

  private async auditOverridesDrop(
    trx: Trx,
    ctx: WriteContext,
    entityType: 'course' | 'course_offering',
    entityId: string,
    droppedOverrides: string[],
    extId: string,
  ): Promise<void> {
    await trx
      .insertInto('audit_log')
      .values({
        actor_sub: ctx.actor,
        actor_org_id: null,
        action: `${entityType}.overrides_drop`,
        entity_type: entityType,
        entity_id: entityId,
        changes: {
          ext_id: extId,
          channel: ctx.channel,
          overrides_dropped: droppedOverrides,
          sync_run_id: ctx.syncRunId,
        },
      })
      .execute();
  }

  private async auditRevive(
    trx: Trx,
    ctx: WriteContext,
    entityType: 'course' | 'course_offering',
    entityId: string,
    droppedOverrides: string[],
    extId?: string,
  ): Promise<void> {
    await trx
      .insertInto('audit_log')
      .values({
        actor_sub: ctx.actor,
        actor_org_id: null,
        action: `${entityType}.revive`,
        entity_type: entityType,
        entity_id: entityId,
        changes: {
          ...(extId ? { ext_id: extId } : {}),
          channel: ctx.channel,
          deleted: { from: true, to: false },
          ...(droppedOverrides.length ? { overrides_dropped: droppedOverrides } : {}),
          sync_run_id: ctx.syncRunId,
        },
      })
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

  /**
   * Stores the raw payload unless it equals the latest one of the same entity
   * (spec §5 "History"); harvested payloads are minimised first.
   */
  private async history(
    trx: Trx,
    ctx: WriteContext,
    entityType: HistoryEntityType,
    entityId: string | null,
    extId: string,
    source: unknown,
    result: 'accepted' | 'rejected',
  ): Promise<void> {
    // Harvested payloads lose their person data before they are kept (spec §5.2).
    const raw = ctx.channel === 'oeapi' ? minimiseRawPayload(source) : source;
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
