// SPDX-License-Identifier: EUPL-1.2
// Admin API response shapes the shared schemas do not export (they mirror
// apps/api/src/admin/uploads/uploads.controller.ts).
import type { CsvUploadResponse, ProblemDetails, ProblemError, SyncRun } from '@oecp/schemas';

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
