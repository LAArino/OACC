// SPDX-License-Identifier: EUPL-1.2
import type { SourceChannel } from '@oecp/schemas';

/** Shared by every channel; one per `sync_runs` row. */
export interface WriteContext {
  syncRunId: string;
  organizationId: string;
  channel: SourceChannel;
  /** `oeapi-5.0`, `csv-1.0` or `form-1` (sync_runs.schema_version). */
  schemaVersion: string;
  /** JWT `sub`, or `system:<job>` such as `system:harvester`. */
  actor: string;
  /** Time of the run's fetch; `last_seen_at` and history timestamps. */
  now: Date;
}

export interface UpsertResult {
  outcome: 'created' | 'updated' | 'unchanged';
  entityId: string;
  /** SHA-256 of the RFC 8785 serialisation, computed before overrides. */
  contentHash: Buffer;
}

/** Natural keys seen in a complete harvest; drives absence counting (spec §6.2.5). */
export interface SeenSet {
  courseExtIds: ReadonlySet<string>;
  /** {@link offeringKey}(course_ext_id, ext_offering_id) */
  offeringKeys: ReadonlySet<string>;
  /** Offerings starting before this date (`since`) never count as absent. */
  offeringWindowStart: string;
}

export interface AbsenceResult {
  /** Courses and offerings whose `absent_count` was incremented. */
  incremented: number;
  /** Courses and offerings withdrawn by absence in this run. */
  withdrawn: number;
  /** True when ≥ 30% of published courses were missing and nothing was counted. */
  massAbsence: boolean;
  publishedCourses: number;
  missingPublishedCourses: number;
}

export const offeringKey = (courseExtId: string, extOfferingId: string): string =>
  `${courseExtId}\u0000${extOfferingId}`;
