// SPDX-License-Identifier: EUPL-1.2
// Admin API response shapes: those the shared schemas do not export (CSV
// uploads, mirroring apps/api/src/admin/uploads/uploads.controller.ts) and the
// course wizard contracts of `@oecp/schemas` under the admin pages' names.
import type {
  AdminCourseHistory,
  AdminHistoryEntry,
  AdminReference,
  CsvUploadResponse,
  LifecycleStatus,
  ProblemDetails,
  ProblemError,
  SourceChannel,
  SyncRun,
} from '@oecp/schemas';

/** `POST …/uploads` 201: processed inline, with the finished run and its warnings. */
export interface CsvUploadInlineResponse extends CsvUploadResponse {
  run: SyncRun;
  warnings: ProblemError[];
}

/** `POST …/uploads` 422 problem+json extension members (spec §6.6). */
export interface CsvUploadProblem extends ProblemDetails {
  sync_run_id?: string;
  run_status?: string;
  processed_inline?: boolean;
  error_count?: number;
  warning_count?: number;
}

// ---------------------------------------------------------------------------
// Course wizard (spec §6.4, §8.1): the admin course and offering API contracts
// of `@oecp/schemas` (admin-courses.ts), under the names the admin pages use.
export type {
  AdminCourse,
  AdminCourseList,
  AdminCourseListItem,
  AdminCourseText,
  AdminOffering,
  CourseInput,
  OfferingInput,
  OverridesPatch,
} from '@oecp/schemas';

/** `GET /api/admin/v1/organizations/{orgId}/reference`. */
export type AdminCourseReference = AdminReference;
export type AdminAttributeDefinitionRef = AdminReference['attribute_definitions'][number];
export type AdminHistoryItem = AdminHistoryEntry;
export type AdminHistory = AdminCourseHistory;
export type AdminLifecycleStatus = LifecycleStatus;
export type AdminSourceChannel = SourceChannel;
export type AdminAttributeValue = string | string[] | boolean;

/** A label as the API sends it: a `{bcp47: text}` map with `en` (or a plain string). */
export type AdminLabel = string | Readonly<Record<string, string>>;

/** Filters of `GET …/courses` as the list page sends them (arrays as repeated keys). */
export interface AdminCourseListQuery {
  q?: string;
  status?: string[];
  kind?: string[];
  source_channel?: string[];
  page?: number;
  page_size?: number;
}
