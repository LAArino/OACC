// SPDX-License-Identifier: EUPL-1.2
import { randomUUID } from 'node:crypto';
import {
  HttpException,
  Inject,
  Injectable,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AdminCourse,
  type AdminCourseHistory,
  type AdminCourseList,
  type AdminCourseListQuery,
  type AdminOffering,
  type AdminReference,
  buildAttributesSchema,
  type Course,
  course as courseSchema,
  type CourseInputValue,
  type CourseOffering,
  courseOffering as courseOfferingSchema,
  courseOverrideKey,
  ERROR_CODES,
  FORM_LANGUAGE_TAGS,
  FORM_SCHEMA_VERSION,
  type LifecycleStatus,
  type OfferingInputValue,
  type ParsedOverridesPatch,
  parseCourseOverrideKey,
  type ProblemError,
  issuesToProblemErrors,
} from '@oecp/schemas';
import type { Transaction } from 'kysely';
import { loadAttributeDefinitions } from '../../attributes/attribute-definitions.js';
import { ProblemException } from '../../common/problem.js';
import type { ProblemBody } from '../../common/problem-details.filter.js';
import type { Database } from '../../db/database.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import {
  CanonicalContentRejected,
  CanonicalWriter,
  type CourseOverrideChange,
  type OverrideChange,
} from '../../ingestion/canonical-writer.service.js';
import { CsvAdapter } from '../../ingestion/csv/csv.adapter.js';
import type { WriteContext } from '../../ingestion/ports/canonical-writer.js';
import { teachingUnits } from '../../ingestion/teaching-units.js';
import type { AdminPrincipal } from '../auth/claims.js';
import {
  changedKeys,
  courseFields,
  courseFromAdmin,
  courseFromEffective,
  courseFromInput,
  iscedList,
  offeringFields,
  offeringFromAdmin,
  offeringFromEffective,
  offeringFromInput,
} from './course-dto.js';
import { CoursesRepository, type FormOrganization } from './courses.repository.js';

export const FORM_CLOCK = Symbol('FORM_CLOCK');

type Trx = Transaction<Database>;
type Outcome = 'created' | 'updated' | 'unchanged';

interface Saved {
  outcome: Outcome;
  entityId: string;
  /** Extra audit members (ext_id, fields…); never payload bodies. */
  audit: Record<string, unknown>;
  /**
   * The course whose IT Handbook publication rule (decision 21c) runs after the
   * save, and the status the save asks for (none: offering saves, which never
   * publish a course).
   */
  publish?: { courseId: string; requested?: LifecycleStatus | undefined };
}

/** 422 problem+json with every error (spec §6.6). */
export function validationProblem(errors: ProblemError[]): UnprocessableEntityException {
  const body: ProblemBody = {
    type: '/problems/validation-failed',
    title: 'Validation failed',
    errors,
  };
  return new UnprocessableEntityException(body);
}

function error(code: keyof typeof ERROR_CODES, pointer: string, detail?: string): ProblemError {
  const message = ERROR_CODES[code].message;
  return {
    code,
    severity: 'error',
    message: detail ? `${message}: ${detail}` : message,
    pointer,
  };
}

/** `status: {from, to}` audit member when the status changed. */
function statusAudit(from: LifecycleStatus, to: LifecycleStatus): Record<string, unknown> {
  return from === to ? {} : { status: { from, to } };
}

/** Canonical schema check of a DTO; issues become 422 errors with JSON pointers. */
function checkCanonical(schema: typeof courseSchema | typeof courseOfferingSchema, dto: unknown) {
  const result = schema.safeParse(dto);
  if (!result.success) {
    throw validationProblem(
      issuesToProblemErrors(result.error.issues, { fallback: 'oecp.content.invalid_value' }),
    );
  }
}

/** Database errors that a concurrent change or an unchecked rule can still raise. */
function mapWriteError(err: unknown): unknown {
  if (err instanceof HttpException) return err;
  if (err instanceof CanonicalContentRejected) return validationProblem(err.errors);
  const pg = err as { code?: unknown; message?: unknown; constraint?: unknown };
  if (typeof pg.code !== 'string') return err;
  const detail = typeof pg.constraint === 'string' ? pg.constraint : undefined;
  if (pg.code === '23514') {
    if (typeof pg.message === 'string' && pg.message.includes('no English text')) {
      return validationProblem([error('oecp.content.english_missing', '/texts/en')]);
    }
    return validationProblem([error('oecp.content.invalid_value', '', detail)]);
  }
  if (pg.code === '23505') {
    return new ProblemException(409, 'oecp.content.duplicate_ext_id', detail);
  }
  if (pg.code === '23503') {
    return validationProblem([error('oecp.content.invalid_value', '', detail)]);
  }
  return err;
}

/**
 * Channel C, the web form (spec §6.4, §6.5, §8.1): course and offering writes of
 * `write` organizations (authoritative channel `csv`, `form` or none) through
 * {@link CanonicalWriter} (hash, history, status rules), overrides on the records
 * of `overrides` organizations (`oeapi`), status changes and soft deletes. Every
 * save is one transaction with one single-entity `sync_runs` row (`form`/`form`,
 * `form-1`) and one audit row; a refused save writes nothing.
 */
@Injectable()
export class CoursesService {
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly writer: CanonicalWriter,
    private readonly adapter: CsvAdapter,
    private readonly courses: CoursesRepository,
    @Optional() @Inject(FORM_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  /* --------------------------------------------------------------- reads */

  async reference(organizationId: string): Promise<AdminReference> {
    return this.courses.reference(await this.organization(organizationId));
  }

  list(organizationId: string, query: AdminCourseListQuery): Promise<AdminCourseList> {
    return this.courses.list(organizationId, query);
  }

  /** Organization of a course, for the scope check; 404 when unknown or deleted. */
  async courseOrganization(courseId: string): Promise<string> {
    const organizationId = await this.courses.courseOrganization(courseId);
    if (!organizationId)
      throw new ProblemException(404, 'oecp.request.not_found', 'Course not found');
    return organizationId;
  }

  async offeringOrganization(offeringId: string): Promise<string> {
    const scope = await this.courses.offeringScope(offeringId);
    if (!scope) {
      throw new ProblemException(404, 'oecp.request.not_found', 'Offering not found');
    }
    return scope.organizationId;
  }

  async getCourse(id: string): Promise<AdminCourse> {
    const course = await this.courses.course(id);
    if (!course) throw new ProblemException(404, 'oecp.request.not_found', 'Course not found');
    return course;
  }

  async getOffering(id: string): Promise<AdminOffering> {
    const offering = await this.courses.offering(id);
    if (!offering) throw new ProblemException(404, 'oecp.request.not_found', 'Offering not found');
    return offering;
  }

  async history(courseId: string, limit: number): Promise<AdminCourseHistory> {
    return { items: await this.courses.history(courseId, limit) };
  }

  /* -------------------------------------------------------------- courses */

  async createCourse(
    admin: AdminPrincipal,
    organizationId: string,
    input: CourseInputValue,
  ): Promise<AdminCourse> {
    const organization = await this.organization(organizationId);
    this.requireWrite(organization);
    const dto = courseFromInput(input, { status: input.status ?? 'draft', sourceRef: null });
    checkCanonical(courseSchema, dto);
    const saved = await this.save(
      admin,
      organizationId,
      'course.create',
      'course',
      async (writer, trx, ctx) => {
        await this.checkCourseReferences(trx, organizationId, dto);
        const existing = await trx
          .selectFrom('courses')
          .select(['id', 'deleted_at'])
          .where('organization_id', '=', organizationId)
          .where('ext_id', '=', dto.ext_id)
          .forUpdate()
          .executeTakeFirst();
        if (existing && !existing.deleted_at) {
          throw new ProblemException(409, 'oecp.content.duplicate_ext_id', dto.ext_id);
        }
        // A course deleted in error comes back under its code, without its old overrides.
        if (existing) await this.reviveCourse(trx, existing.id);
        const result = await writer.upsertCourse(ctx, dto, input);
        return {
          outcome: 'created',
          entityId: result.entityId,
          audit: { ext_id: dto.ext_id, status: dto.status, ...(existing ? { revived: true } : {}) },
          publish: { courseId: result.entityId, requested: result.requestedStatus },
        };
      },
    );
    return this.loadCourse(saved.entityId);
  }

  async replaceCourse(
    admin: AdminPrincipal,
    courseId: string,
    input: CourseInputValue,
  ): Promise<AdminCourse> {
    const organizationId = await this.courseOrganization(courseId);
    const organization = await this.organization(organizationId);
    this.requireWrite(organization);
    await this.save(admin, organizationId, 'course.update', 'course', async (writer, trx, ctx) => {
      const before = await this.lockCourse(trx, courseId);
      if (input.ext_id !== before.ext_id) {
        throw new ProblemException(
          409,
          'oecp.content.ext_id_immutable',
          `${before.ext_id} cannot become ${input.ext_id}`,
        );
      }
      const dto = courseFromInput(input, {
        status: input.status ?? before.status,
        sourceRef: before.source_ref,
      });
      checkCanonical(courseSchema, dto);
      await this.checkCourseReferences(trx, organizationId, dto);
      const dropped = await this.dropCourseOverrides(trx, before);
      const result = await writer.upsertCourse(ctx, dto, input);
      const after = await this.courses.course(courseId, trx);
      return {
        outcome: result.outcome,
        entityId: courseId,
        audit: {
          ext_id: before.ext_id,
          fields: changedKeys(courseFields(before), courseFields(after)),
          ...(dropped ? { overrides_dropped: dropped } : {}),
        },
        publish: { courseId, requested: result.requestedStatus },
      };
    });
    return this.loadCourse(courseId);
  }

  /** `write`: a new record status; `overrides`: a `status` override. */
  async setCourseStatus(
    admin: AdminPrincipal,
    courseId: string,
    status: LifecycleStatus,
  ): Promise<AdminCourse> {
    const organizationId = await this.courseOrganization(courseId);
    const organization = await this.organization(organizationId);
    if (organization.form_mode === 'overrides') {
      return this.patchCourseOverrides(
        admin,
        courseId,
        { set: { status }, clear: [] },
        'course.status',
      );
    }
    await this.save(admin, organizationId, 'course.status', 'course', async (writer, trx, ctx) => {
      const before = await this.lockCourse(trx, courseId);
      const dto = courseFromAdmin(before, status);
      checkCanonical(courseSchema, dto);
      const dropped = await this.dropCourseOverrides(trx, before);
      const result = await writer.upsertCourse(ctx, dto, { status });
      return {
        outcome: result.outcome,
        entityId: courseId,
        audit: {
          ext_id: before.ext_id,
          status: { from: before.status, to: status },
          ...(dropped ? { overrides_dropped: dropped } : {}),
        },
        publish: { courseId, requested: result.requestedStatus },
      };
    });
    return this.loadCourse(courseId);
  }

  async patchCourseOverrides(
    admin: AdminPrincipal,
    courseId: string,
    patch: ParsedOverridesPatch,
    action = 'course.overrides',
  ): Promise<AdminCourse> {
    const organizationId = await this.courseOrganization(courseId);
    const organization = await this.organization(organizationId);
    this.requireOverrides(organization);
    await this.save(admin, organizationId, action, 'course', async (writer, trx, ctx) => {
      const before = await this.lockCourse(trx, courseId);
      const change = await this.courseChange(trx, before, patch);
      const result = await writer.applyCourseOverrides(ctx, courseId, change, patch, (next) =>
        checkCanonical(courseSchema, courseFromEffective(before, next)),
      );
      return {
        outcome: result.outcome,
        entityId: courseId,
        audit: {
          ext_id: before.ext_id,
          set: Object.keys(patch.set),
          clear: patch.clear,
          fields: result.changed,
          ...statusAudit(before.status, await this.currentStatus(trx, 'courses', courseId)),
        },
        publish: { courseId, requested: result.requestedStatus },
      };
    });
    return this.loadCourse(courseId);
  }

  /** Soft delete (`deleted_at`) of a course created in error, with its offerings. */
  async deleteCourse(admin: AdminPrincipal, courseId: string): Promise<void> {
    const organizationId = await this.courseOrganization(courseId);
    const organization = await this.organization(organizationId);
    this.requireWrite(organization);
    await this.save(admin, organizationId, 'course.delete', 'course', async (_writer, trx, ctx) => {
      const before = await this.lockCourse(trx, courseId);
      if (before.source_channel === 'oeapi') {
        throw new ProblemException(409, 'oecp.content.harvested_not_deletable');
      }
      const published = before.offerings.filter((o) => o.status === 'published');
      if (published.length > 0) {
        throw new ProblemException(
          409,
          'oecp.content.has_published_offerings',
          published.map((o) => o.ext_offering_id).join(', '),
        );
      }
      await trx
        .updateTable('course_offerings')
        .set({ deleted_at: ctx.now })
        .where('course_id', '=', courseId)
        .where('deleted_at', 'is', null)
        .execute();
      await trx
        .updateTable('courses')
        .set({ deleted_at: ctx.now })
        .where('id', '=', courseId)
        .execute();
      return {
        outcome: 'updated',
        entityId: courseId,
        audit: {
          ext_id: before.ext_id,
          deleted: true,
          offerings_deleted: before.offerings.map((o) => o.ext_offering_id),
        },
      };
    });
  }

  /* ------------------------------------------------------------ offerings */

  async createOffering(
    admin: AdminPrincipal,
    courseId: string,
    input: OfferingInputValue,
  ): Promise<AdminOffering> {
    const organizationId = await this.courseOrganization(courseId);
    const organization = await this.organization(organizationId);
    this.requireWrite(organization);
    const saved = await this.save(
      admin,
      organizationId,
      'course_offering.create',
      'course_offering',
      async (writer, trx, ctx) => {
        const course = await this.lockCourse(trx, courseId);
        const dto = offeringFromInput(input, {
          courseExtId: course.ext_id,
          status: input.status ?? 'draft',
          sourceRef: null,
          defaultTimezone: organization.default_timezone,
          now: ctx.now,
        });
        checkCanonical(courseOfferingSchema, dto);
        await this.checkDeliveryModes(trx, dto.delivery_modes, '/delivery_modes');
        const existing = await trx
          .selectFrom('course_offerings')
          .select(['id', 'deleted_at'])
          .where('course_id', '=', courseId)
          .where('ext_offering_id', '=', dto.ext_offering_id)
          .forUpdate()
          .executeTakeFirst();
        if (existing && !existing.deleted_at) {
          throw new ProblemException(409, 'oecp.content.duplicate_ext_id', dto.ext_offering_id);
        }
        if (existing) await this.reviveOffering(trx, existing.id);
        await this.ensureSession(writer, trx, ctx, dto);
        const result = await writer.upsertOffering(ctx, dto, input);
        return {
          outcome: 'created',
          entityId: result.entityId,
          audit: {
            ext_id: `${course.ext_id}#${dto.ext_offering_id}`,
            status: dto.status,
            ...(existing ? { revived: true } : {}),
          },
          publish: { courseId },
        };
      },
    );
    return this.loadOffering(saved.entityId);
  }

  async replaceOffering(
    admin: AdminPrincipal,
    offeringId: string,
    input: OfferingInputValue,
  ): Promise<AdminOffering> {
    const organizationId = await this.offeringOrganization(offeringId);
    const organization = await this.organization(organizationId);
    this.requireWrite(organization);
    await this.save(
      admin,
      organizationId,
      'course_offering.update',
      'course_offering',
      async (writer, trx, ctx) => {
        const before = await this.lockOffering(trx, offeringId);
        if (input.ext_offering_id !== before.ext_offering_id) {
          throw new ProblemException(
            409,
            'oecp.content.ext_id_immutable',
            `${before.ext_offering_id} cannot become ${input.ext_offering_id}`,
          );
        }
        const dto = offeringFromInput(input, {
          courseExtId: before.course_ext_id,
          status: input.status ?? before.status,
          sourceRef: before.source_ref,
          defaultTimezone: organization.default_timezone,
          now: ctx.now,
        });
        checkCanonical(courseOfferingSchema, dto);
        await this.checkDeliveryModes(trx, dto.delivery_modes, '/delivery_modes');
        const dropped = await this.dropOfferingOverrides(trx, before);
        await this.ensureSession(writer, trx, ctx, dto);
        const result = await writer.upsertOffering(ctx, dto, input);
        const after = await this.courses.offering(offeringId, trx);
        return {
          outcome: result.outcome,
          entityId: offeringId,
          audit: {
            ext_id: `${before.course_ext_id}#${before.ext_offering_id}`,
            fields: changedKeys(offeringFields(before), offeringFields(after)),
            ...(dropped ? { overrides_dropped: dropped } : {}),
          },
          publish: { courseId: before.course_id },
        };
      },
    );
    return this.loadOffering(offeringId);
  }

  async setOfferingStatus(
    admin: AdminPrincipal,
    offeringId: string,
    status: LifecycleStatus,
  ): Promise<AdminOffering> {
    const organizationId = await this.offeringOrganization(offeringId);
    const organization = await this.organization(organizationId);
    if (organization.form_mode === 'overrides') {
      return this.patchOfferingOverrides(
        admin,
        offeringId,
        { set: { status }, clear: [] },
        'course_offering.status',
      );
    }
    await this.save(
      admin,
      organizationId,
      'course_offering.status',
      'course_offering',
      async (writer, trx, ctx) => {
        const before = await this.lockOffering(trx, offeringId);
        const dto = offeringFromAdmin(before, status);
        checkCanonical(courseOfferingSchema, dto);
        const dropped = await this.dropOfferingOverrides(trx, before);
        const result = await writer.upsertOffering(ctx, dto, { status });
        return {
          outcome: result.outcome,
          entityId: offeringId,
          audit: {
            ext_id: `${before.course_ext_id}#${before.ext_offering_id}`,
            status: { from: before.status, to: status },
            ...(dropped ? { overrides_dropped: dropped } : {}),
          },
          publish: { courseId: before.course_id },
        };
      },
    );
    return this.loadOffering(offeringId);
  }

  async patchOfferingOverrides(
    admin: AdminPrincipal,
    offeringId: string,
    patch: ParsedOverridesPatch,
    action = 'course_offering.overrides',
  ): Promise<AdminOffering> {
    const organizationId = await this.offeringOrganization(offeringId);
    const organization = await this.organization(organizationId);
    this.requireOverrides(organization);
    await this.save(admin, organizationId, action, 'course_offering', async (writer, trx, ctx) => {
      const before = await this.lockOffering(trx, offeringId);
      const set: Record<string, unknown> = { ...patch.set };
      const clear = [...patch.clear];
      // The seat count is current as of the override; its timestamp follows it.
      if ('seats_available' in set) {
        set['seats_updated_at'] = set['seats_available'] === null ? null : ctx.now.toISOString();
      }
      if (clear.includes('seats_available')) clear.push('seats_updated_at');
      if (Array.isArray(set['delivery_modes'])) {
        await this.checkDeliveryModes(
          trx,
          set['delivery_modes'] as string[],
          '/set/delivery_modes',
        );
      }
      const change: OverrideChange = { set, clear };
      const result = await writer.applyOfferingOverrides(ctx, offeringId, change, patch, (next) =>
        checkCanonical(courseOfferingSchema, offeringFromEffective(before, next)),
      );
      return {
        outcome: result.outcome,
        entityId: offeringId,
        audit: {
          ext_id: `${before.course_ext_id}#${before.ext_offering_id}`,
          set: Object.keys(patch.set),
          clear: patch.clear,
          fields: result.changed,
          ...statusAudit(
            before.status,
            await this.currentStatus(trx, 'course_offerings', offeringId),
          ),
        },
        publish: { courseId: before.course_id },
      };
    });
    return this.loadOffering(offeringId);
  }

  /** Soft delete of an offering created in error (never published, not harvested). */
  async deleteOffering(admin: AdminPrincipal, offeringId: string): Promise<void> {
    const organizationId = await this.offeringOrganization(offeringId);
    const organization = await this.organization(organizationId);
    this.requireWrite(organization);
    await this.save(
      admin,
      organizationId,
      'course_offering.delete',
      'course_offering',
      async (_writer, trx, ctx) => {
        const before = await this.lockOffering(trx, offeringId);
        if (before.source_channel === 'oeapi') {
          throw new ProblemException(409, 'oecp.content.harvested_not_deletable');
        }
        if (before.status === 'published') {
          throw new ProblemException(409, 'oecp.content.published_not_deletable');
        }
        await trx
          .updateTable('course_offerings')
          .set({ deleted_at: ctx.now })
          .where('id', '=', offeringId)
          .execute();
        return {
          outcome: 'updated',
          entityId: offeringId,
          audit: { ext_id: `${before.course_ext_id}#${before.ext_offering_id}`, deleted: true },
        };
      },
    );
  }

  /* -------------------------------------------------------------- helpers */

  private async currentStatus(
    trx: Trx,
    table: 'courses' | 'course_offerings',
    id: string,
  ): Promise<LifecycleStatus> {
    return (
      await trx.selectFrom(table).select('status').where('id', '=', id).executeTakeFirstOrThrow()
    ).status;
  }

  private async organization(organizationId: string): Promise<FormOrganization> {
    const organization = await this.courses.organization(organizationId);
    if (!organization) {
      throw new ProblemException(404, 'oecp.request.not_found', 'Organization not found');
    }
    return organization;
  }

  /** Spec §6.5: in `oeapi` organizations the form only creates overrides. */
  private requireWrite(organization: FormOrganization): void {
    if (organization.form_mode === 'overrides') {
      throw new ProblemException(
        409,
        'oecp.sync.channel_disabled',
        'The authoritative channel of this organization is oeapi; the form only stores overrides',
      );
    }
  }

  private requireOverrides(organization: FormOrganization): void {
    if (organization.form_mode !== 'overrides') {
      throw new ProblemException(
        409,
        'oecp.content.override_not_allowed',
        `The authoritative channel of this organization is ${organization.authoritative_channel ?? 'form'}; edit the record instead`,
      );
    }
  }

  /**
   * One form save: a `sync_runs` row (`form`/`form`, `form-1`, triggered_by = sub),
   * the work through a transaction-bound writer, counters, audit row. Any error
   * rolls everything back.
   */
  private async save(
    admin: AdminPrincipal,
    organizationId: string,
    action: string,
    entityType: 'course' | 'course_offering',
    work: (writer: CanonicalWriter, trx: Trx, ctx: WriteContext) => Promise<Saved>,
  ): Promise<Saved & { syncRunId: string }> {
    const now = this.now();
    const ctx: WriteContext = {
      syncRunId: randomUUID(),
      organizationId,
      channel: 'form',
      schemaVersion: FORM_SCHEMA_VERSION,
      actor: admin.sub,
      now,
    };
    try {
      return await this.writer.transaction(async (writer, trx) => {
        await trx
          .insertInto('sync_runs')
          .values({
            id: ctx.syncRunId,
            organization_id: organizationId,
            channel: 'form',
            trigger_kind: 'form',
            triggered_by: admin.sub,
            schema_version: FORM_SCHEMA_VERSION,
            status: 'running',
            started_at: now,
            created_at: now,
          })
          .execute();
        const saved = await work(writer, trx, ctx);
        // Decision 21c: after the save, so the rule sees the course with its offerings.
        const rule = saved.publish
          ? await writer.applyPublishRule(
              ctx,
              { id: saved.publish.courseId },
              saved.publish.requested,
            )
          : null;
        const finished = this.now();
        await trx
          .updateTable('sync_runs')
          .set({
            status: 'succeeded',
            is_complete: true,
            finished_at: finished < now ? now : finished,
            n_created: saved.outcome === 'created' ? 1 : 0,
            n_updated: saved.outcome === 'updated' ? 1 : 0,
            n_unchanged: saved.outcome === 'unchanged' ? 1 : 0,
          })
          .where('id', '=', ctx.syncRunId)
          .execute();
        await trx
          .insertInto('audit_log')
          .values({
            actor_sub: admin.sub,
            actor_org_id: admin.orgId ?? null,
            action,
            entity_type: entityType,
            entity_id: saved.entityId,
            changes: {
              organization_id: organizationId,
              sync_run_id: ctx.syncRunId,
              channel: 'form',
              outcome: saved.outcome,
              ...saved.audit,
              ...(rule?.warning
                ? {
                    publish_rule: {
                      mode: writer.publishRule,
                      status: rule.status,
                      missing: rule.completeness.missing,
                    },
                  }
                : {}),
            },
          })
          .execute();
        return { ...saved, syncRunId: ctx.syncRunId };
      });
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  private async loadCourse(id: string): Promise<AdminCourse> {
    const course = await this.courses.course(id);
    if (!course) throw new Error(`course ${id} vanished`);
    return course;
  }

  private async loadOffering(id: string): Promise<AdminOffering> {
    const offering = await this.courses.offering(id);
    if (!offering) throw new Error(`offering ${id} vanished`);
    return offering;
  }

  /** The course, locked for the transaction; 404 when deleted meanwhile. */
  private async lockCourse(trx: Trx, courseId: string): Promise<AdminCourse> {
    await trx.selectFrom('courses').select('id').where('id', '=', courseId).forUpdate().execute();
    const course = await this.courses.course(courseId, trx);
    if (!course) throw new ProblemException(404, 'oecp.request.not_found', 'Course not found');
    return course;
  }

  private async lockOffering(trx: Trx, offeringId: string): Promise<AdminOffering> {
    await trx
      .selectFrom('course_offerings')
      .select('id')
      .where('id', '=', offeringId)
      .forUpdate()
      .execute();
    const offering = await this.courses.offering(offeringId, trx);
    if (!offering) throw new ProblemException(404, 'oecp.request.not_found', 'Offering not found');
    return offering;
  }

  private async reviveCourse(trx: Trx, id: string): Promise<void> {
    await trx
      .updateTable('courses')
      .set({ deleted_at: null, overrides: {}, content_hash: null })
      .where('id', '=', id)
      .execute();
    await trx
      .updateTable('course_texts')
      .set({ overrides: {} })
      .where('course_id', '=', id)
      .execute();
  }

  private async reviveOffering(trx: Trx, id: string): Promise<void> {
    await trx
      .updateTable('course_offerings')
      .set({ deleted_at: null, overrides: {}, content_hash: null })
      .where('id', '=', id)
      .execute();
  }

  /**
   * In `write` organizations what the form shows is the record: overrides left
   * from an `oeapi` period are dropped (and the hash reset so the write applies).
   * Returns the dropped keys.
   */
  private async dropCourseOverrides(trx: Trx, course: AdminCourse): Promise<string[] | null> {
    const keys = Object.keys(course.overrides);
    if (keys.length === 0) return null;
    await trx
      .updateTable('courses')
      .set({ overrides: {}, content_hash: null })
      .where('id', '=', course.id)
      .execute();
    await trx
      .updateTable('course_texts')
      .set({ overrides: {} })
      .where('course_id', '=', course.id)
      .execute();
    return keys;
  }

  private async dropOfferingOverrides(trx: Trx, offering: AdminOffering): Promise<string[] | null> {
    const keys = Object.keys(offering.overrides);
    if (keys.length === 0) return null;
    await trx
      .updateTable('course_offerings')
      .set({ overrides: {}, content_hash: null })
      .where('id', '=', offering.id)
      .execute();
    return keys;
  }

  /** Teaching unit, ISCED broad fields and attributes against the database (422). */
  private async checkCourseReferences(
    trx: Trx,
    organizationId: string,
    dto: Course,
  ): Promise<void> {
    const errors: ProblemError[] = [];
    if (dto.teaching_unit_ext_id) {
      const units = await teachingUnits(trx, organizationId);
      if (!units.has(dto.teaching_unit_ext_id)) {
        errors.push(
          error(
            'oecp.content.unknown_teaching_unit',
            '/teaching_unit_ext_id',
            dto.teaching_unit_ext_id,
          ),
        );
      }
    }
    errors.push(...(await this.iscedErrors(trx, dto.isced_codes, '/isced_codes')));
    errors.push(...(await this.attributeErrors(trx, dto.attributes, '/attributes')));
    if (errors.length > 0) throw validationProblem(errors);
  }

  private async iscedErrors(trx: Trx, codes: readonly string[], pointer: string) {
    if (codes.length === 0) return [];
    const known = new Set(
      (await trx.selectFrom('isced_broad_fields').select('code').execute()).map((r) => r.code),
    );
    return codes.flatMap((code, i) =>
      known.has(code.slice(0, 2))
        ? []
        : [error('oecp.content.unknown_isced_field', `${pointer}/${i}`, code)],
    );
  }

  private async attributeErrors(trx: Trx, attributes: unknown, pointer: string) {
    if (!attributes || Object.keys(attributes).length === 0) return [];
    const checked = buildAttributesSchema(await loadAttributeDefinitions(trx)).safeParse(
      attributes,
    );
    if (checked.success) return [];
    return issuesToProblemErrors(checked.error.issues, {
      fallback: 'oecp.content.invalid_attribute_value',
    }).map((e) => ({ ...e, pointer: `${pointer}${e.pointer ?? ''}` }));
  }

  private async checkDeliveryModes(trx: Trx, modes: readonly string[], pointer: string) {
    const active = new Set(
      (
        await trx.selectFrom('delivery_modes').select('code').where('active', '=', true).execute()
      ).map((r) => r.code),
    );
    const errors = modes.flatMap((mode, i) =>
      active.has(mode)
        ? []
        : [error('oecp.content.unknown_delivery_mode', `${pointer}/${i}`, mode)],
    );
    if (errors.length > 0) throw validationProblem(errors);
  }

  /** Unknown session codes get a minimal session, as in CSV uploads (spec §6.3). */
  private async ensureSession(
    writer: CanonicalWriter,
    trx: Trx,
    ctx: WriteContext,
    dto: CourseOffering,
  ): Promise<void> {
    const code = dto.academic_session_ext_id;
    if (!code) return;
    const known = await trx
      .selectFrom('academic_sessions')
      .select('ext_id')
      .where('organization_id', '=', ctx.organizationId)
      .where('ext_id', '=', code)
      .executeTakeFirst();
    if (known) return;
    for (const { session, raw } of this.adapter.sessionsFor([dto], new Set())) {
      await writer.upsertAcademicSession(ctx, session, { ...raw, derived_from: 'form' });
    }
  }

  /**
   * Patch (API keys and shapes) → writer change: ISCED codes as a list, text keys
   * grouped by language; languages must be supported or already on the course;
   * references checked against the database.
   */
  private async courseChange(
    trx: Trx,
    course: AdminCourse,
    patch: ParsedOverridesPatch,
  ): Promise<CourseOverrideChange> {
    const change: {
      set: Record<string, unknown>;
      clear: string[];
      texts: Record<string, { set: Record<string, unknown>; clear: string[] }>;
    } = {
      set: {},
      clear: [],
      texts: {},
    };
    const errors: ProblemError[] = [];
    const text = (lang: string) => (change.texts[lang] ??= { set: {}, clear: [] });
    const languageOk = (lang: string) =>
      (FORM_LANGUAGE_TAGS as readonly string[]).includes(lang) || lang in course.texts;
    for (const [key, value] of Object.entries(patch.set)) {
      const parsed = parseCourseOverrideKey(key);
      if (!parsed) continue; // rejected by the schema
      if (parsed.kind === 'text') {
        if (!languageOk(parsed.lang)) {
          errors.push(error('oecp.content.unsupported_language', `/set/${key}`, parsed.lang));
          continue;
        }
        text(parsed.lang).set[parsed.field] = value;
      } else if (parsed.field === 'isced_codes') {
        const codes = iscedList(value as { code: string; is_primary: boolean }[]);
        errors.push(...(await this.iscedErrors(trx, codes, `/set/${key}`)));
        change.set[key] = codes;
      } else {
        if (parsed.field === 'attributes') {
          errors.push(...(await this.attributeErrors(trx, value, `/set/${key}`)));
        }
        change.set[key] = value;
      }
    }
    for (const key of patch.clear) {
      const parsed = parseCourseOverrideKey(key);
      if (!parsed) continue;
      if (parsed.kind === 'text') text(parsed.lang).clear.push(parsed.field);
      else change.clear.push(courseOverrideKey(parsed));
    }
    // A language the course does not have needs its title.
    for (const [lang, t] of Object.entries(change.texts)) {
      if (!(lang in course.texts) && !('title' in t.set)) {
        errors.push(
          error(
            'oecp.content.invalid_value',
            `/set/texts.${lang}.title`,
            'a new language needs its title',
          ),
        );
      }
    }
    if (errors.length > 0) throw validationProblem(errors);
    return change;
  }
}
