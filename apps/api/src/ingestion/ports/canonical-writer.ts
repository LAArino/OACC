// SPDX-License-Identifier: EUPL-1.2
import type {
  AcademicSession,
  Course,
  CourseOffering,
  ProblemError,
  SourceChannel,
} from '@oecp/schemas';

/** Shared by every channel; one per `sync_runs` row. */
export interface WriteContext {
  syncRunId: string;
  organizationId: string;
  channel: SourceChannel;
  /** `oeapi-5.0`, `csv-1.0` or `form-1` (sync_runs.schema_version). */
  schemaVersion: string;
  /** JWT `sub`, or `system:<job>` such as `system:harvester`. */
  actor: string;
}

export type CanonicalEntity =
  | { entityType: 'academic_session'; data: AcademicSession }
  | { entityType: 'course'; data: Course }
  | { entityType: 'course_offering'; data: CourseOffering };

export interface UpsertResult {
  outcome: 'created' | 'updated' | 'unchanged';
  entityId: string;
  /** SHA-256 of the RFC 8785 serialisation, computed before overrides. */
  contentHash: Uint8Array;
}

export interface EntityRef {
  entityType: CanonicalEntity['entityType'];
  extId: string;
}

/** Natural keys seen in a complete harvest; drives absence counting (spec §6.2.5). */
export interface SeenSet {
  courseExtIds: ReadonlySet<string>;
  /** `${course_ext_id}\u0000${ext_offering_id}` */
  offeringKeys: ReadonlySet<string>;
  /** Offerings starting before this date never count as absent. */
  offeringWindowStart: string;
}

export interface AbsenceResult {
  incremented: number;
  withdrawn: number;
  republished: number;
  /** True when ≥ 30% of published courses were missing and nothing was counted. */
  massAbsence: boolean;
}

/**
 * Single write path into the canonical model (spec §6.1): natural-key upsert,
 * override merge, status rules, audit, `ext_metadata_history` and `sync_errors`.
 * An unchanged `content_hash` writes nothing.
 */
export interface CanonicalWriter {
  upsert(
    ctx: WriteContext,
    entity: CanonicalEntity,
    rawPayload: unknown,
    warnings?: ProblemError[],
  ): Promise<UpsertResult>;
  /** Records a rejected source entity; still resets its absence counter. */
  reject(
    ctx: WriteContext,
    ref: EntityRef,
    rawPayload: unknown,
    errors: ProblemError[],
  ): Promise<void>;
  /** Only for complete `succeeded`/`partial` harvests. */
  applyAbsences(
    ctx: WriteContext,
    seen: SeenSet,
    withdrawAfterAbsences: number,
  ): Promise<AbsenceResult>;
}

export const CANONICAL_WRITER = Symbol('CANONICAL_WRITER');
export const OEAPI_V5_ADAPTER = Symbol('OEAPI_V5_ADAPTER');
