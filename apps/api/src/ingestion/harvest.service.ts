// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode, type ProblemError } from '@oecp/schemas';
import { type Db, KYSELY } from '../db/db.module.js';
import { RunMetricsService } from '../metrics/run-metrics.service.js';
import {
  CanonicalContentRejected,
  CanonicalWriter,
  HARVESTER_ACTOR,
  offeringHistoryId,
} from './canonical-writer.service.js';
import type { HarvestJobData } from './harvest.constants.js';
import {
  type MappedCourse,
  type MappingContext,
  OeapiV5Adapter,
} from './oeapi/oeapi-v5.adapter.js';
import { OeapiClientFactory, type PartnerIntegrationRow } from './oeapi/oeapi-client.factory.js';
import { OeapiError, type OeapiV5Client } from './oeapi/oeapi-v5.client.js';
import { offeringKey, type WriteContext } from './ports/canonical-writer.js';
import {
  type FinishRun,
  OEAPI_V5_SCHEMA_VERSION,
  RUN_MAX_DURATION_MS,
  type RunCounters,
  SyncRunsRepository,
} from './sync-runs.repository.js';

/** Spec §6.2.3: offerings are listed from `today − 365 days`. */
export const OFFERINGS_SINCE_DAYS = 365;

export const HARVEST_CLOCK = Symbol('HARVEST_CLOCK');

export interface HarvestOutcome {
  syncRunId: string | null;
  status: FinishRun['status'] | 'skipped';
  isComplete: boolean;
  counters: RunCounters;
  errorSummary: string | null;
}

/** Fatal for the whole run: retrying other entities cannot succeed. */
class AbortRun extends Error {
  constructor(readonly issue: ProblemError) {
    super(issue.message);
  }
}

/** Issue with the catalogue severity of `code` (never overridden, spec §6.6). */
function problem(
  code: ErrorCode,
  detail?: string,
  extra: Omit<Partial<ProblemError>, 'severity' | 'code'> = {},
): ProblemError {
  const message = detail ? `${ERROR_CODES[code].message}: ${detail}` : ERROR_CODES[code].message;
  return { code, severity: ERROR_CODES[code].severity, message, ...extra };
}

/** Issue of a failed request; the severity is the catalogue's (spec §6.6). */
function fromOeapiError(
  error: OeapiError,
  extra: Omit<Partial<ProblemError>, 'severity'> = {},
): ProblemError {
  return {
    code: error.code,
    severity: ERROR_CODES[error.code].severity,
    message: error.message,
    ...extra,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Per-run state. */
class RunState {
  readonly counters: RunCounters = {
    n_created: 0,
    n_updated: 0,
    n_unchanged: 0,
    n_rejected: 0,
    n_withdrawn: 0,
  };
  readonly seenCourses = new Set<string>();
  readonly seenOfferings = new Set<string>();
  /** Course ids (`courseId`) already processed, to skip duplicates across pages. */
  readonly sourceCourseIds = new Set<string>();
  /** `since` of the offering listings (`today − 365 days`). */
  since = '';
  listingComplete = true;
  coursesReturned = 0;
  processed = 0;
  readonly notes: string[] = [];
  fatal: ProblemError | undefined;

  count(outcome: 'created' | 'updated' | 'unchanged' | 'rejected'): void {
    this.counters[`n_${outcome}`] += 1;
    this.processed += 1;
  }
}

/**
 * One Channel A run for one organization (spec §6.2): root organization →
 * courses → offerings per course (since today − 365 days) → offering details with
 * the academic session expanded; per-entity failures, run status, completeness,
 * withdrawal by absence and counters.
 */
@Injectable()
export class HarvestService {
  private readonly logger = new Logger(HarvestService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly clients: OeapiClientFactory,
    private readonly adapter: OeapiV5Adapter,
    private readonly writer: CanonicalWriter,
    private readonly runs: SyncRunsRepository,
    @Optional() @Inject(HARVEST_CLOCK) clock?: () => Date,
    /** Worker only (spec §10 metrics); absent in the api and the CLI. */
    @Optional() private readonly metrics?: RunMetricsService,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async run(job: HarvestJobData, signal?: AbortSignal): Promise<HarvestOutcome> {
    const skipped = (reason: string): HarvestOutcome => {
      this.logger.warn(`Harvest of ${job.organizationId} skipped: ${reason}`);
      return {
        syncRunId: job.syncRunId ?? null,
        status: 'skipped',
        isComplete: false,
        counters: new RunState().counters,
        errorSummary: reason,
      };
    };

    const integration = await this.db
      .selectFrom('partner_integrations')
      .selectAll()
      .where('organization_id', '=', job.organizationId)
      .executeTakeFirst();
    const organization = await this.db
      .selectFrom('organizations')
      .select(['id', 'ext_id', 'default_timezone', 'contact_email', 'deleted_at'])
      .where('id', '=', job.organizationId)
      .executeTakeFirst();
    const now = this.now();
    if (!integration || !organization || organization.deleted_at) {
      if (job.syncRunId) {
        await this.runs.cancelQueued(job.syncRunId, 'No integration is configured', now);
      }
      return skipped('no integration or organization');
    }
    if (integration.authoritative_channel !== 'oeapi') {
      if (job.syncRunId) {
        await this.runs.cancelQueued(
          job.syncRunId,
          ERROR_CODES['oecp.sync.channel_disabled'].message,
          now,
        );
      }
      return skipped('authoritative channel is not oeapi');
    }
    if (job.trigger === 'schedule' && !integration.enabled) {
      return skipped('integration disabled');
    }

    const run = await this.runs.start({
      organizationId: job.organizationId,
      trigger: job.trigger,
      triggeredBy: job.triggeredBy ?? null,
      syncRunId: job.syncRunId,
      now,
    });
    if (!run) return skipped('another run of the organization is in progress');

    this.metrics?.harvestStarted();
    try {
      const ctx: WriteContext = {
        syncRunId: run.id,
        organizationId: job.organizationId,
        channel: 'oeapi',
        schemaVersion: OEAPI_V5_SCHEMA_VERSION,
        actor: HARVESTER_ACTOR,
        now,
      };
      const state = new RunState();
      const timeout = AbortSignal.timeout(RUN_MAX_DURATION_MS);
      const runSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

      try {
        const mapping: MappingContext = {
          organization: {
            id: organization.id,
            extId: organization.ext_id,
            defaultTimezone: organization.default_timezone,
            contactEmail: organization.contact_email,
          },
          iscedBroadFields: new Set(
            (await this.db.selectFrom('isced_broad_fields').select('code').execute()).map(
              (r) => r.code,
            ),
          ),
          fetchedAt: now,
        };
        await this.harvest(integration, ctx, mapping, state, runSignal);
      } catch (error) {
        if (error instanceof AbortRun) {
          state.fatal = error.issue;
        } else {
          this.logger.error(error);
          state.fatal = problem('oecp.internal', (error as Error).message);
        }
        state.listingComplete = false;
        await this.safeRecord(ctx, [state.fatal]);
      }

      const finished = await this.finish(integration, ctx, state);
      await this.metrics?.syncRunFinished({
        organizationId: job.organizationId,
        channel: 'oeapi',
        status: finished.status,
        finishedAt: this.now(),
      });
      this.logger.log(
        `Harvest ${run.id} of ${job.organizationId}: ${finished.status}` +
          `${finished.is_complete ? '' : ' (incomplete)'}, created ${finished.n_created}, ` +
          `updated ${finished.n_updated}, unchanged ${finished.n_unchanged}, ` +
          `rejected ${finished.n_rejected}, withdrawn ${finished.n_withdrawn}`,
      );
      return {
        syncRunId: run.id,
        status: finished.status,
        isComplete: finished.is_complete,
        counters: {
          n_created: finished.n_created,
          n_updated: finished.n_updated,
          n_unchanged: finished.n_unchanged,
          n_rejected: finished.n_rejected,
          n_withdrawn: finished.n_withdrawn,
        },
        errorSummary: finished.error_summary,
      };
    } finally {
      this.metrics?.harvestEnded();
    }
  }

  private async harvest(
    integration: PartnerIntegrationRow,
    ctx: WriteContext,
    mapping: MappingContext,
    state: RunState,
    signal: AbortSignal,
  ): Promise<void> {
    let client: OeapiV5Client;
    try {
      client = await this.clients.create(integration, { signal });
    } catch (error) {
      if (error instanceof OeapiError) throw new AbortRun(fromOeapiError(error));
      throw error;
    }

    // 1. Root organization: matched to the partner, never created.
    await this.rootOrganization(client, ctx, mapping);

    // 2. Courses, each followed by 3./4. its offerings.
    const since = isoDate(new Date(ctx.now.getTime() - OFFERINGS_SINCE_DAYS * 86_400_000));
    state.since = since;
    try {
      for await (const page of client.pages('/courses')) {
        for (const [index, raw] of page.envelope.items.entries()) {
          this.checkSignal(signal);
          state.coursesReturned += 1;
          await this.course(client, ctx, mapping, state, raw, index, since, signal);
        }
      }
    } catch (error) {
      if (!(error instanceof OeapiError)) throw error;
      state.listingComplete = false;
      const issue = fromOeapiError(error, { pointer: '/courses' });
      if (error.fatal || state.processed === 0) throw new AbortRun(issue);
      state.notes.push(`course listing interrupted: ${error.code}`);
      await this.safeRecord(ctx, [issue]);
    }
    if (state.coursesReturned === 0 && !state.fatal) {
      state.notes.push('no courses returned');
      await this.safeRecord(ctx, [problem('oecp.oeapi.empty_listing')]);
    }
  }

  private async rootOrganization(
    client: OeapiV5Client,
    ctx: WriteContext,
    mapping: MappingContext,
  ): Promise<void> {
    const roots: unknown[] = [];
    try {
      for await (const page of client.pages('/organizations', { organizationType: 'root' })) {
        for (const item of page.envelope.items) {
          if (
            typeof item === 'object' &&
            item !== null &&
            (item as { organizationType?: unknown }).organizationType === 'root'
          ) {
            roots.push(item);
          }
        }
      }
    } catch (error) {
      if (error instanceof OeapiError) {
        throw new AbortRun(fromOeapiError(error, { pointer: '/organizations' }));
      }
      throw error;
    }
    if (roots.length === 0) {
      throw new AbortRun(problem('oecp.oeapi.root_not_matched', 'no root organization returned'));
    }
    const result = this.adapter.mapRootOrganization(roots[0], mapping);
    const extId = result.identity.extId ?? 'root';
    if (!result.ok) {
      await this.writer.reject(
        ctx,
        { entityType: 'organization', extId },
        roots[0],
        result.errors,
        result.warnings,
      );
      throw new AbortRun(result.errors[0] ?? problem('oecp.oeapi.root_not_matched'));
    }
    await this.writer.recordOrganization(ctx, extId, roots[0]);
    if (roots.length > 1) {
      await this.safeRecord(ctx, [
        problem('oecp.oeapi.multiple_roots', `${roots.length} root organizations`),
      ]);
    }
  }

  private async course(
    client: OeapiV5Client,
    ctx: WriteContext,
    mapping: MappingContext,
    state: RunState,
    raw: unknown,
    index: number,
    since: string,
    signal: AbortSignal,
  ): Promise<void> {
    const mapped = this.adapter.mapCourse(raw, mapping);
    const { extId, sourceRef } = mapped.identity;

    if (sourceRef && state.sourceCourseIds.has(sourceRef)) return; // repeated across pages
    if (sourceRef) state.sourceCourseIds.add(sourceRef);
    if (extId && state.seenCourses.has(extId)) {
      // The first item with the code was processed; this one is ignored (a warning,
      // as the catalogue says), not rejected.
      await this.safeRecord(
        ctx,
        [
          problem(
            'oecp.oeapi.duplicate_entity',
            `primaryCode ${extId} (item ${sourceRef ?? index})`,
            {
              ext_id: extId,
              pointer: '/primaryCode/code',
            },
          ),
        ],
        'course',
      );
      return;
    }
    if (extId) state.seenCourses.add(extId);

    if (!mapped.ok) {
      state.count('rejected');
      await this.safeReject(
        ctx,
        {
          entityType: 'course',
          extId: extId ?? sourceRef ?? `item-${index}`,
          ...(extId ? { course: { extId } } : {}),
        },
        raw,
        mapped.errors,
        mapped.warnings,
      );
      // Offerings of a rejected course are rejected too (spec §6.2.6).
      if (sourceRef) {
        await this.offerings(client, ctx, mapping, state, sourceRef, extId, null, since, signal);
      }
      return;
    }

    let accepted = true;
    let requested = mapped.value.course.status;
    try {
      const result = await this.writer.upsertCourse(ctx, mapped.value.course, raw, mapped.warnings);
      requested = result.requestedStatus ?? requested;
      state.count(result.outcome);
    } catch (error) {
      accepted = false;
      state.count('rejected');
      await this.writeFailed(ctx, 'course', mapped.value.course.ext_id, raw, error, {
        course: { extId: mapped.value.course.ext_id },
      });
    }
    await this.offerings(
      client,
      ctx,
      mapping,
      state,
      mapped.value.source.courseId,
      mapped.value.course.ext_id,
      accepted ? mapped.value : null,
      since,
      signal,
    );
    // Decision 21c: the handbook rule needs the course's offerings, so it runs last.
    if (accepted) await this.publishRule(ctx, mapped.value.course.ext_id, requested);
  }

  /** {@link CanonicalWriter.applyPublishRule}; bookkeeping, never aborts the run. */
  private async publishRule(
    ctx: WriteContext,
    extId: string,
    requested: Parameters<CanonicalWriter['applyPublishRule']>[2],
  ): Promise<void> {
    try {
      await this.writer.applyPublishRule(ctx, { extId }, requested);
    } catch (error) {
      this.logger.error(error);
      await this.safeRecord(ctx, [
        problem('oecp.internal', `publication rule: ${(error as Error).message}`, {
          ext_id: extId,
        }),
      ]);
    }
  }

  /** Lists the course's offerings; with `course = null` (rejected course) they are all rejected. */
  private async offerings(
    client: OeapiV5Client,
    ctx: WriteContext,
    mapping: MappingContext,
    state: RunState,
    courseId: string,
    courseExtId: string | null,
    course: MappedCourse | null,
    since: string,
    signal: AbortSignal,
  ): Promise<void> {
    const seenHere = new Set<string>();
    try {
      for await (const page of client.pages(`/courses/${encodeURIComponent(courseId)}/offerings`, {
        since,
      })) {
        for (const item of page.envelope.items) {
          this.checkSignal(signal);
          await this.offering(client, ctx, mapping, state, item, courseExtId, course, seenHere);
        }
      }
    } catch (error) {
      if (!(error instanceof OeapiError)) throw error;
      state.listingComplete = false;
      const issue = fromOeapiError(error, {
        pointer: `/courses/${courseId}/offerings`,
        ...(courseExtId ? { ext_id: courseExtId } : {}),
      });
      if (error.fatal) throw new AbortRun(issue);
      state.notes.push(`offering listing of ${courseExtId ?? courseId} failed: ${error.code}`);
      // The page cap is reported as itself (a warning); any other cause as
      // listing_failed (an error) carrying the cause.
      const recorded =
        error.code === 'oecp.oeapi.page_cap_reached'
          ? issue
          : { ...issue, code: 'oecp.oeapi.listing_failed', severity: 'error' as const };
      await this.safeRecord(ctx, [recorded], 'course');
    }
  }

  private async offering(
    client: OeapiV5Client,
    ctx: WriteContext,
    mapping: MappingContext,
    state: RunState,
    listed: unknown,
    courseExtId: string | null,
    course: MappedCourse | null,
    seenHere: Set<string>,
  ): Promise<void> {
    const offeringId =
      typeof listed === 'object' && listed !== null
        ? (listed as { offeringId?: unknown }).offeringId
        : undefined;

    if (!course) {
      // Parent rejected: no detail request, just bookkeeping.
      const extId = this.offeringExtId(listed);
      state.count('rejected');
      if (courseExtId && extId) state.seenOfferings.add(offeringKey(courseExtId, extId));
      await this.safeReject(
        ctx,
        {
          entityType: 'course_offering',
          extId: offeringHistoryId(courseExtId ?? '?', extId ?? String(offeringId ?? '?')),
          ...(courseExtId && extId ? { offering: { courseExtId, extOfferingId: extId } } : {}),
        },
        listed,
        [problem('oecp.oeapi.parent_rejected', courseExtId ?? undefined)],
      );
      return;
    }

    // 4. Detail with the academic session expanded; the listing item is the fallback.
    let raw = listed;
    const warnings: ProblemError[] = [];
    if (typeof offeringId === 'string' && offeringId.length > 0) {
      try {
        raw = (
          await client.getJson(`/offerings/${encodeURIComponent(offeringId)}`, {
            expand: 'academicSession',
          })
        ).body;
      } catch (error) {
        if (!(error instanceof OeapiError)) throw error;
        if (error.fatal) throw new AbortRun(fromOeapiError(error));
        warnings.push(
          problem('oecp.oeapi.detail_unavailable', `${error.code}: ${error.message}`, {
            pointer: '/offeringId',
          }),
        );
      }
    }

    const mapped = this.adapter.mapOffering(raw, course, mapping);
    const extId = mapped.identity.extId;
    const historyId = offeringHistoryId(course.course.ext_id, extId ?? String(offeringId ?? '?'));
    if (extId) {
      const key = offeringKey(course.course.ext_id, extId);
      if (seenHere.has(key)) {
        await this.safeRecord(
          ctx,
          [problem('oecp.oeapi.duplicate_entity', `offering ${extId}`, { ext_id: historyId })],
          'course_offering',
        );
        return;
      }
      seenHere.add(key);
      state.seenOfferings.add(key);
    }
    if (!mapped.ok) {
      state.count('rejected');
      await this.safeReject(
        ctx,
        {
          entityType: 'course_offering',
          extId: historyId,
          ...(extId
            ? { offering: { courseExtId: course.course.ext_id, extOfferingId: extId } }
            : {}),
        },
        raw,
        mapped.errors,
        [...warnings, ...mapped.warnings],
      );
      return;
    }
    try {
      if (mapped.value.session) {
        await this.writer.upsertAcademicSession(
          ctx,
          mapped.value.session,
          (raw as { academicSession?: unknown }).academicSession,
        );
      }
      const result = await this.writer.upsertOffering(ctx, mapped.value.offering, raw, [
        ...warnings,
        ...mapped.warnings,
      ]);
      state.count(result.outcome);
    } catch (error) {
      state.count('rejected');
      await this.writeFailed(ctx, 'course_offering', historyId, raw, error, {
        offering: {
          courseExtId: course.course.ext_id,
          extOfferingId: mapped.value.offering.ext_offering_id,
        },
      });
    }
  }

  private offeringExtId(raw: unknown): string | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as { primaryCode?: { code?: unknown }; offeringId?: unknown };
    if (typeof r.primaryCode?.code === 'string' && r.primaryCode.code.trim()) {
      return r.primaryCode.code.trim();
    }
    return typeof r.offeringId === 'string' && r.offeringId ? r.offeringId : null;
  }

  private async finish(
    integration: PartnerIntegrationRow,
    ctx: WriteContext,
    state: RunState,
  ): Promise<FinishRun> {
    // Spec §6.2.5: complete = every listing page 200 and at least one course came back.
    const isComplete = state.listingComplete && !state.fatal && state.coursesReturned > 0;
    let status: FinishRun['status'];
    if (state.fatal && state.processed === 0) status = 'failed';
    else if (isComplete && state.counters.n_rejected === 0) status = 'succeeded';
    else status = 'partial';

    if (isComplete) {
      try {
        const since = state.since || isoDate(ctx.now);
        const absence = await this.writer.applyAbsences(
          ctx,
          {
            courseExtIds: state.seenCourses,
            offeringKeys: state.seenOfferings,
            offeringWindowStart: since,
          },
          integration.withdraw_after_absences,
        );
        state.counters.n_withdrawn = absence.withdrawn;
        if (absence.massAbsence) {
          state.notes.push(
            `mass absence: ${absence.missingPublishedCourses} of ${absence.publishedCourses} published courses missing`,
          );
          await this.safeRecord(ctx, [
            problem(
              'oecp.oeapi.mass_absence',
              `${absence.missingPublishedCourses} of ${absence.publishedCourses} published courses missing`,
            ),
          ]);
          this.logger.warn(
            `Harvest ${ctx.syncRunId}: mass absence, ${absence.missingPublishedCourses}/${absence.publishedCourses} published courses missing; nothing withdrawn`,
          );
        }
      } catch (error) {
        this.logger.error(error);
        state.notes.push('absence bookkeeping failed');
        await this.safeRecord(ctx, [problem('oecp.internal', (error as Error).message)]);
      }
    }

    const summary: string[] = [];
    if (state.fatal) summary.push(state.fatal.message);
    if (state.counters.n_rejected > 0) summary.push(`${state.counters.n_rejected} rejected`);
    summary.push(...state.notes);
    const result: FinishRun = {
      ...state.counters,
      status,
      is_complete: isComplete,
      error_summary: summary.length > 0 ? summary.join('; ').slice(0, 2000) : null,
    };
    await this.runs.finish(ctx.syncRunId, result, this.now());
    return result;
  }

  private async writeFailed(
    ctx: WriteContext,
    entityType: 'course' | 'course_offering',
    extId: string,
    raw: unknown,
    error: unknown,
    ref: { course?: { extId: string }; offering?: { courseExtId: string; extOfferingId: string } },
  ): Promise<void> {
    if (error instanceof CanonicalContentRejected) {
      // Content the alliance's definitions refuse (attributes): a rejection, not a failure.
      await this.safeReject(ctx, { entityType, extId, ...ref }, raw, error.errors);
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Harvest ${ctx.syncRunId}: ${entityType} ${extId} not written: ${detail}`);
    await this.safeReject(ctx, { entityType, extId, ...ref }, raw, [
      problem('oecp.oeapi.write_failed', detail, { ext_id: extId }),
    ]);
  }

  /** Bookkeeping must not abort the run. */
  private async safeReject(
    ctx: WriteContext,
    ref: Parameters<CanonicalWriter['reject']>[1],
    raw: unknown,
    errors: ProblemError[],
    warnings: ProblemError[] = [],
  ): Promise<void> {
    try {
      await this.writer.reject(ctx, ref, raw, errors, warnings);
    } catch (error) {
      this.logger.error(error);
    }
  }

  private async safeRecord(
    ctx: WriteContext,
    issues: ProblemError[],
    entityType: string | null = null,
  ): Promise<void> {
    try {
      await this.writer.recordIssues(ctx, issues, entityType);
    } catch (error) {
      this.logger.error(error);
    }
  }

  private checkSignal(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new AbortRun(problem('oecp.oeapi.run_timeout'));
    }
  }
}
