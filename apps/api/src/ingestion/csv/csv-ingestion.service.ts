// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type CourseAttributes,
  type CourseKind,
  type CourseLevel,
  type CourseOffering,
  type CourseText,
  CSV_SCHEMA_VERSION,
  type CsvFileKind,
  type CsvIssue,
  type CsvReferenceData,
  decodeCsvBytes,
  type LifecycleStatus,
  ERROR_CODES,
  type ErrorCode,
  isErrorCode,
  type NormalizedCourseRow,
  type ProblemError,
  type NormalizedOfferingRow,
  validateCsvFiles,
} from '@oecp/schemas';
import { sql, type Transaction } from 'kysely';
import { loadAttributeDefinitions } from '../../attributes/attribute-definitions.js';
import type { Database } from '../../db/database.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import { CanonicalContentRejected, CanonicalWriter } from '../canonical-writer.service.js';
import { offeringKey, type WriteContext } from '../ports/canonical-writer.js';
import type { FinishRun, RunCounters, SyncRunRow } from '../sync-runs.repository.js';
import { SyncRunsRepository } from '../sync-runs.repository.js';
import { teachingUnits } from '../teaching-units.js';
import { CSV_SYSTEM_ACTOR } from './csv.constants.js';
import {
  CsvAdapter,
  type ExistingCourse,
  type ExistingOffering,
  type MappedCsvCourse,
  type MappedCsvOffering,
} from './csv.adapter.js';
import { UploadStorage } from './upload-storage.js';

export const CSV_CLOCK = Symbol('CSV_CLOCK');

type Trx = Transaction<Database>;

export interface CsvRunOutcome {
  syncRunId: string;
  /** `skipped`: the run was not `queued` (already processed or unknown). */
  status: 'succeeded' | 'failed' | 'skipped';
  counters: RunCounters;
  /** Errors and warnings with file/row/column (at most 1,000 per file and severity). */
  errors: CsvIssue[];
  warnings: CsvIssue[];
  errorCount: number;
  warningCount: number;
}

interface Result {
  ok: boolean;
  counters: RunCounters;
  errors: CsvIssue[];
  warnings: CsvIssue[];
  errorCount: number;
  warningCount: number;
  summary: string | null;
}

/** Canonical validation failed after mapping; the transaction is rolled back. */
class CanonicalRejected extends Error {
  constructor(readonly issues: CsvIssue[]) {
    super('canonical validation failed');
  }
}

/** A writer rejection (pointer `/attributes/<key>`) as a `courses.csv` cell issue. */
function writerIssue(error: ProblemError, row: number): CsvIssue {
  const key = /^\/attributes\/([^/]+)/.exec(error.pointer ?? '')?.[1];
  const issue: CsvIssue = {
    code: (isErrorCode(error.code) ? error.code : 'oecp.content.invalid_value') as ErrorCode,
    severity: 'error',
    file: 'courses',
    row,
    message: error.message,
  };
  if (key) issue.column = `attr_${key}`;
  return issue;
}

const zero = (): RunCounters => ({
  n_created: 0,
  n_updated: 0,
  n_unchanged: 0,
  n_rejected: 0,
  n_withdrawn: 0,
});

function fileIssue(file: CsvFileKind | undefined, code: ErrorCode, detail?: string): CsvIssue {
  const base = ERROR_CODES[code].message;
  return {
    code,
    severity: 'error',
    file: file ?? 'courses',
    message: detail ? `${base}: ${detail}` : base,
  };
}

/**
 * One Channel B run (spec §6.3): read the stored files → decode → parse →
 * validate with the shared validator (reference data from the database; the
 * server always revalidates) → all-or-nothing: any error fails the run and writes
 * nothing but `sync_errors`; otherwise sessions, courses then offerings go
 * through {@link CanonicalWriter} in one transaction. Omission never withdraws.
 */
@Injectable()
export class CsvIngestionService {
  private readonly logger = new Logger(CsvIngestionService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly writer: CanonicalWriter,
    private readonly adapter: CsvAdapter,
    private readonly storage: UploadStorage,
    private readonly runs: SyncRunsRepository,
    @Optional() @Inject(CSV_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async process(syncRunId: string): Promise<CsvRunOutcome> {
    const run = await this.db
      .updateTable('sync_runs')
      .set({ status: 'running', started_at: this.now() })
      .where('id', '=', syncRunId)
      .where('channel', '=', 'csv')
      .where('status', '=', 'queued')
      .returningAll()
      .executeTakeFirst();
    if (!run) {
      return {
        syncRunId,
        status: 'skipped',
        counters: zero(),
        errors: [],
        warnings: [],
        errorCount: 0,
        warningCount: 0,
      };
    }
    const ctx: WriteContext = {
      syncRunId,
      organizationId: run.organization_id,
      channel: 'csv',
      schemaVersion: CSV_SCHEMA_VERSION,
      actor: run.triggered_by ?? CSV_SYSTEM_ACTOR,
      now: this.now(),
    };

    let result: Result;
    try {
      result = await this.execute(run, ctx);
    } catch (error) {
      this.logger.error(error);
      result = this.failure([fileIssue(undefined, 'oecp.internal', (error as Error).message)]);
    }

    if (!result.ok) {
      try {
        await this.writer.recordIssues(ctx, [...result.errors, ...result.warnings]);
      } catch (error) {
        this.logger.error(error);
      }
    }
    const finish: FinishRun = {
      ...result.counters,
      status: result.ok ? 'succeeded' : 'failed',
      is_complete: result.ok,
      error_summary: result.summary?.slice(0, 2000) ?? null,
    };
    await this.runs.finish(syncRunId, finish, this.now());
    await this.db
      .insertInto('audit_log')
      .values({
        actor_sub: ctx.actor,
        actor_org_id: null,
        action: 'upload.processed',
        entity_type: 'sync_run',
        entity_id: syncRunId,
        changes: {
          organization_id: run.organization_id,
          status: finish.status,
          n_created: finish.n_created,
          n_updated: finish.n_updated,
          n_unchanged: finish.n_unchanged,
          n_rejected: finish.n_rejected,
          errors: result.errorCount,
          warnings: result.warningCount,
        },
      })
      .execute()
      .catch((error: unknown) => this.logger.error(error));
    this.logger.log(
      `CSV upload ${syncRunId} of ${run.organization_id}: ${finish.status}, created ${finish.n_created}, ` +
        `updated ${finish.n_updated}, unchanged ${finish.n_unchanged}, errors ${result.errorCount}, ` +
        `warnings ${result.warningCount}`,
    );
    return {
      syncRunId,
      status: finish.status as 'succeeded' | 'failed',
      counters: result.counters,
      errors: result.errors,
      warnings: result.warnings,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
    };
  }

  private async execute(run: SyncRunRow, ctx: WriteContext): Promise<Result> {
    // 1. Stored files (both optional, at least one).
    const key = run.upload_object_key;
    if (!key) return this.failure([fileIssue(undefined, 'oecp.csv.no_files', 'files not found')]);
    const texts: { courses?: string; offerings?: string } = {};
    const decodeErrors: CsvIssue[] = [];
    for (const kind of ['courses', 'offerings'] as const) {
      const bytes = await this.storage.read(key, kind);
      if (bytes === null) continue;
      const decoded = decodeCsvBytes(bytes, kind);
      decodeErrors.push(...decoded.errors);
      texts[kind] = decoded.text;
    }
    if (decodeErrors.length > 0) return this.failure(decodeErrors);
    if (texts.courses === undefined && texts.offerings === undefined) {
      return this.failure([fileIssue(undefined, 'oecp.csv.no_files', 'files not found')]);
    }

    // 2. The organization may have switched to OEAPI while the upload was queued.
    const organization = await this.db
      .selectFrom('organizations')
      .leftJoin('partner_integrations as pi', 'pi.organization_id', 'organizations.id')
      .select([
        'organizations.default_timezone',
        'organizations.deleted_at',
        'pi.authoritative_channel',
      ])
      .where('organizations.id', '=', run.organization_id)
      .executeTakeFirst();
    if (!organization || organization.deleted_at) {
      return this.failure([fileIssue(undefined, 'oecp.request.not_found', 'organization')]);
    }
    if (organization.authoritative_channel === 'oeapi') {
      return this.failure([fileIssue(undefined, 'oecp.sync.channel_disabled')]);
    }

    // 3. Validation with reference data from the database.
    const validation = validateCsvFiles(texts, {
      referenceData: await this.referenceData(run.organization_id),
    });
    const errors = [...(validation.courses?.errors ?? []), ...(validation.offerings?.errors ?? [])];
    const warnings = [
      ...(validation.courses?.warnings ?? []),
      ...(validation.offerings?.warnings ?? []),
    ];
    if (validation.errorCount > 0) {
      return this.failure(errors, warnings, {
        errors: validation.errorCount,
        warnings: validation.warningCount,
      });
    }

    // 4. All-or-nothing write.
    const uploadedAt = new Date(run.created_at);
    const publishWarnings: CsvIssue[] = [];
    try {
      const counters = await this.writer.transaction((writer, trx) =>
        this.write(writer, trx, ctx, {
          courses: validation.courses?.normalized ?? [],
          offerings: validation.offerings?.normalized ?? [],
          defaultTimezone: organization.default_timezone,
          uploadedAt,
          warnings,
          publishWarnings,
        }),
      );
      const warningCount = validation.warningCount + publishWarnings.length;
      return {
        ok: true,
        counters,
        errors: [],
        warnings: [...warnings, ...publishWarnings],
        errorCount: 0,
        warningCount,
        summary: warningCount > 0 ? `${warningCount} warning(s)` : null,
      };
    } catch (error) {
      if (error instanceof CanonicalRejected) return this.failure(error.issues, warnings);
      this.logger.warn(`CSV upload ${ctx.syncRunId} not written: ${(error as Error).message}`);
      return this.failure(
        [fileIssue(undefined, 'oecp.csv.write_failed', (error as Error).message)],
        warnings,
      );
    }
  }

  private async write(
    writer: CanonicalWriter,
    trx: Trx,
    ctx: WriteContext,
    input: {
      courses: readonly NormalizedCourseRow[];
      offerings: readonly NormalizedOfferingRow[];
      defaultTimezone: string;
      uploadedAt: Date;
      warnings: readonly CsvIssue[];
      /** Filled with the `oecp.content.handbook_incomplete` warnings (already recorded). */
      publishWarnings: CsvIssue[];
    },
  ): Promise<RunCounters> {
    // One upload per organization at a time: the snapshot below stays current.
    await sql`select pg_advisory_xact_lock(hashtext(${'oecp-csv:' + ctx.organizationId}))`.execute(
      trx,
    );
    const existingCourses = await this.existingCourses(
      trx,
      ctx.organizationId,
      input.courses.map((r) => r.course_code),
    );
    const existingOfferings = await this.existingOfferings(
      trx,
      ctx.organizationId,
      input.offerings.map((r) => r.course_code),
    );

    const issues: CsvIssue[] = [];
    const courses: (MappedCsvCourse & { row: number })[] = [];
    for (const row of input.courses) {
      const mapped = this.adapter.mapCourse(row, existingCourses.get(row.course_code));
      if (mapped.ok) courses.push({ ...mapped.value, row: row.row });
      else issues.push(...mapped.errors);
    }
    const offerings: MappedCsvOffering[] = [];
    for (const row of input.offerings) {
      const mapped = this.adapter.mapOffering(
        row,
        existingOfferings.get(offeringKey(row.course_code, row.offering_code)),
        { defaultTimezone: input.defaultTimezone, uploadedAt: input.uploadedAt },
      );
      if (mapped.ok) offerings.push(mapped.value);
      else issues.push(...mapped.errors);
    }
    if (issues.length > 0) throw new CanonicalRejected(issues);

    const sessionCodes = [
      ...new Set(
        offerings
          .map((o) => o.offering.academic_session_ext_id)
          .filter((c): c is string => typeof c === 'string'),
      ),
    ];
    const knownSessions = new Set(
      sessionCodes.length === 0
        ? []
        : (
            await trx
              .selectFrom('academic_sessions')
              .select('ext_id')
              .where('organization_id', '=', ctx.organizationId)
              .where('ext_id', 'in', sessionCodes)
              .execute()
          ).map((r) => r.ext_id),
    );
    const offeringDtos: CourseOffering[] = offerings.map((o) => o.offering);
    for (const { session, raw } of this.adapter.sessionsFor(offeringDtos, knownSessions)) {
      await writer.upsertAcademicSession(ctx, session, raw);
    }

    const counters = zero();
    // Courses first, so every offering's course exists (in the database or this transaction).
    // The writer checks attributes against the definitions before writing anything, so a
    // rejection leaves the transaction usable; every rejection is reported, then all roll back.
    const requested = new Map<string, LifecycleStatus | undefined>();
    const courseRows = new Map<string, number>();
    for (const { course, raw, row } of courses) {
      try {
        const result = await writer.upsertCourse(ctx, course, raw);
        counters[`n_${result.outcome}`] += 1;
        requested.set(course.ext_id, result.requestedStatus);
        courseRows.set(course.ext_id, row);
      } catch (error) {
        if (!(error instanceof CanonicalContentRejected)) throw error;
        issues.push(...error.errors.map((e) => writerIssue(e, row)));
      }
    }
    if (issues.length > 0) throw new CanonicalRejected(issues);
    for (const { offering, raw } of offerings) {
      counters[`n_${(await writer.upsertOffering(ctx, offering, raw)).outcome}`] += 1;
      if (!requested.has(offering.course_ext_id)) requested.set(offering.course_ext_id, undefined);
    }
    await writer.recordIssues(ctx, input.warnings);
    // Decision 21c: the IT Handbook publication rule, once every offering is written.
    // Courses only reached through offerings.csv keep their status unless they lose
    // completeness. The writer records the warnings; they are also returned.
    for (const [extId, status] of requested) {
      const outcome = await writer.applyPublishRule(ctx, { extId }, status);
      if (!outcome?.warning) continue;
      const issue: CsvIssue = {
        code: 'oecp.content.handbook_incomplete',
        severity: 'warning',
        file: courseRows.has(extId) ? 'courses' : 'offerings',
        message: `${extId}: ${outcome.warning.message}`,
      };
      const row = courseRows.get(extId);
      if (row !== undefined) issue.row = row;
      input.publishWarnings.push(issue);
    }
    return counters;
  }

  private async referenceData(organizationId: string): Promise<CsvReferenceData> {
    const [isced, modes, units, courses, attributeDefinitions] = await Promise.all([
      this.db.selectFrom('isced_broad_fields').select('code').execute(),
      this.db.selectFrom('delivery_modes').select('code').where('active', '=', true).execute(),
      teachingUnits(this.db, organizationId),
      this.db
        .selectFrom('courses')
        .select('ext_id')
        .where('organization_id', '=', organizationId)
        .where('deleted_at', 'is', null)
        .execute(),
      loadAttributeDefinitions(this.db),
    ]);
    return {
      attributeDefinitions,
      iscedCodes: isced.map((r) => r.code),
      deliveryModes: modes.map((r) => r.code),
      teachingUnitCodes: units.keys(),
      courseCodes: courses.map((r) => r.ext_id),
    };
  }

  /** Current values of the uploaded courses, for columns absent from the header. */
  private async existingCourses(
    trx: Trx,
    organizationId: string,
    codes: readonly string[],
  ): Promise<Map<string, ExistingCourse>> {
    const out = new Map<string, ExistingCourse>();
    if (codes.length === 0) return out;
    const rows = await trx
      .selectFrom('courses as c')
      .leftJoin('organizations as tu', 'tu.id', 'c.teaching_unit_id')
      .select([
        'c.id',
        'c.ext_id',
        'c.kind',
        'c.level',
        'c.levels',
        'c.attributes',
        'c.eqf_level',
        'c.teaching_hours',
        'c.info_url',
        'c.contact_email',
        'c.instructors',
        'tu.ext_id as teaching_unit_ext_id',
      ])
      .where('c.organization_id', '=', organizationId)
      .where('c.ext_id', 'in', [...new Set(codes)])
      .execute();
    if (rows.length === 0) return out;
    const texts = await trx
      .selectFrom('course_texts')
      .select([
        'course_id',
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
      ])
      .where(
        'course_id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    const byCourse = new Map<string, Record<string, CourseText>>();
    for (const t of texts) {
      const map = byCourse.get(t.course_id) ?? {};
      map[t.lang] = {
        title: t.title,
        abstract: t.abstract,
        description: t.description,
        learning_outcomes: t.learning_outcomes,
        prerequisites: t.prerequisites,
        assessment: t.assessment,
        mode_of_repetition: t.mode_of_repetition,
        methods: t.methods,
        literature: t.literature,
        privacy_notice: t.privacy_notice,
        remarks: t.remarks,
        keywords: t.keywords,
        is_machine_translated: t.is_machine_translated,
      };
      byCourse.set(t.course_id, map);
    }
    for (const r of rows) {
      out.set(r.ext_id, {
        kind: r.kind as CourseKind,
        level: r.level as CourseLevel | null,
        levels: r.levels as CourseLevel[],
        attributes: r.attributes as CourseAttributes,
        eqf_level: r.eqf_level,
        teaching_hours: r.teaching_hours === null ? null : Number(r.teaching_hours),
        teaching_unit_ext_id: r.teaching_unit_ext_id ?? null,
        info_url: r.info_url,
        contact_email: r.contact_email,
        instructors: r.instructors,
        texts: byCourse.get(r.id) ?? {},
      });
    }
    return out;
  }

  /** Current values of offerings of the uploaded course codes, keyed by {@link offeringKey}. */
  private async existingOfferings(
    trx: Trx,
    organizationId: string,
    courseCodes: readonly string[],
  ): Promise<Map<string, ExistingOffering>> {
    const out = new Map<string, ExistingOffering>();
    if (courseCodes.length === 0) return out;
    const rows = await trx
      .selectFrom('course_offerings as o')
      .innerJoin('courses as c', 'c.id', 'o.course_id')
      .leftJoin('academic_sessions as s', 's.id', 'o.academic_session_id')
      .select([
        'c.ext_id as course_ext_id',
        'o.ext_offering_id',
        's.ext_id as session_ext_id',
        'o.enrol_start_date',
        'o.application_deadline',
        'o.timezone',
        'o.campus',
        'o.max_students',
        'o.alliance_seats',
        'o.seats_available',
        'o.seats_updated_at',
        'o.application_url',
        'o.application_instructions',
      ])
      .where('c.organization_id', '=', organizationId)
      .where('c.ext_id', 'in', [...new Set(courseCodes)])
      .execute();
    for (const r of rows) {
      out.set(offeringKey(r.course_ext_id, r.ext_offering_id), {
        academic_session_ext_id: r.session_ext_id ?? null,
        enrol_start_date: r.enrol_start_date,
        application_deadline: r.application_deadline,
        timezone: r.timezone,
        campus: r.campus,
        max_students: r.max_students,
        alliance_seats: r.alliance_seats,
        seats_available: r.seats_available,
        seats_updated_at:
          r.seats_updated_at === null ? null : new Date(r.seats_updated_at).toISOString(),
        application_url: r.application_url,
        application_instructions: r.application_instructions,
      });
    }
    return out;
  }

  private failure(
    errors: CsvIssue[],
    warnings: readonly CsvIssue[] = [],
    totals: { errors: number; warnings: number } = {
      errors: errors.length,
      warnings: warnings.length,
    },
  ): Result {
    const rows = new Set(
      errors.filter((e) => e.row !== undefined && e.row > 1).map((e) => `${e.file}:${e.row}`),
    );
    const files = [...new Set(errors.map((e) => `${e.file}.csv`))].join(' and ');
    return {
      ok: false,
      counters: { ...zero(), n_rejected: rows.size },
      errors,
      warnings: [...warnings],
      errorCount: totals.errors,
      warningCount: totals.warnings,
      summary: `${totals.errors} error(s) in ${files}; nothing was written`,
    };
  }
}
