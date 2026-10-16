// SPDX-License-Identifier: EUPL-1.2
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  type AttributeDefinition,
  type CsvFileKind,
  type CsvIssue,
  type CsvUploadResponse,
  csvTemplate,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  type ProblemError,
  type SyncRun,
} from '@oecp/schemas';
import { AdminJwtGuard } from '../auth/admin-jwt.guard.js';
import type { AdminPrincipal } from '../auth/claims.js';
import { CurrentAdmin, RequireRoles } from '../auth/decorators.js';
import { OrganizationAccess } from '../integrations/organization-access.js';
import { CsvUploadInterceptor, type UploadedCsvFiles } from './csv-upload.interceptor.js';
import { UploadRateLimited, UploadsService } from './uploads.service.js';

interface HttpResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

/** Inline upload result (201): the finished run and its warnings. */
export interface CsvUploadInlineResponse extends CsvUploadResponse {
  run: SyncRun;
  warnings: ProblemError[];
}

/** Problem members of a failed inline upload (spec §6.6). */
const MAX_PROBLEM_ERRORS = 1_000;

const uuid = new ParseUUIDPipe();
const CSV_SCHEMA_PATH = createRequire(import.meta.url).resolve(
  '@oecp/schemas/json/csv/oecp-csv-1.3.schema.json',
);
let csvSchema: Promise<unknown> | undefined;

function toProblemError(issue: CsvIssue): ProblemError {
  return { ...issue };
}

/**
 * Channel B (spec §6.3, §8.1 "CSV console"): uploads for partner_admin of the
 * organization (and its sub-units) and alliance_admin; template and JSON Schema
 * downloads for any administrator.
 */
@Controller('api/admin/v1')
@UseGuards(AdminJwtGuard)
@RequireRoles(['partner_admin', 'alliance_admin'])
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly access: OrganizationAccess,
  ) {}

  /**
   * `multipart/form-data` with file fields `courses` and/or `offerings`.
   * 201 processed inline · 202 queued (≤ 500 rows run inline) · 422 inline run
   * failed validation (problem+json, nothing written) · 400 `oecp.csv.no_files` /
   * `oecp.csv.unexpected_file` · 409 `oecp.sync.channel_disabled` · 413
   * `oecp.csv.file_too_large` · 429 `oecp.csv.rate_limited` with Retry-After ·
   * 503 queue unavailable (run cancelled). `Location: /api/admin/v1/sync-runs/{id}`
   * on every response that has a run (201, 202, 422, 503).
   */
  @Post('organizations/:orgId/uploads')
  @UseInterceptors(CsvUploadInterceptor)
  async upload(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('orgId', uuid) orgId: string,
    @UploadedFiles() files: UploadedCsvFiles | undefined,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<CsvUploadResponse | CsvUploadInlineResponse | ProblemDetails> {
    await this.access.assert(admin, orgId);
    let result;
    try {
      // Every response that has a run carries its Location, failures included
      // (503 when the queue is unavailable); 400/409/413/429 create no run.
      result = await this.uploads.create(
        admin,
        orgId,
        { courses: files?.courses?.[0], offerings: files?.offerings?.[0] },
        (id) => response.setHeader('Location', `/api/admin/v1/sync-runs/${id}`),
      );
    } catch (error) {
      if (error instanceof UploadRateLimited) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
    const instance = `/api/admin/v1/sync-runs/${result.syncRunId}`;
    if (!result.processedInline) {
      response.status(202);
      return { sync_run_id: result.syncRunId, status: 'queued', processed_inline: false };
    }
    const { outcome, run } = result;
    if (outcome.status === 'failed') {
      response.status(422);
      response.setHeader('Content-Type', PROBLEM_CONTENT_TYPE);
      const problem: ProblemDetails = {
        type: '/problems/validation-failed',
        title: 'Upload validation failed',
        status: 422,
        instance,
        errors: [...outcome.errors, ...outcome.warnings]
          .slice(0, MAX_PROBLEM_ERRORS)
          .map(toProblemError),
        // Extension members: the run (its full error list: GET {instance}?page=…).
        sync_run_id: result.syncRunId,
        run_status: 'failed',
        processed_inline: true,
        error_count: outcome.errorCount,
        warning_count: outcome.warningCount,
      };
      if (run.error_summary) problem.detail = run.error_summary;
      return problem;
    }
    response.status(201);
    return {
      sync_run_id: result.syncRunId,
      status: run.status,
      processed_inline: true,
      run,
      warnings: outcome.warnings.map(toProblemError),
    };
  }

  /**
   * Template 1.3 (`instructors` and the IT Handbook texts, decision 21; image
   * columns, decision 27) with one
   * `attr_<key>` column per attribute definition of the alliance.
   */
  @Get('csv-template/courses.csv')
  async coursesTemplate(@Res({ passthrough: true }) response: HttpResponse): Promise<string> {
    return this.template('courses', response, await this.uploads.attributeDefinitions());
  }

  @Get('csv-template/offerings.csv')
  offeringsTemplate(@Res({ passthrough: true }) response: HttpResponse): string {
    return this.template('offerings', response);
  }

  /**
   * The generated JSON Schema 2020-12 of template 1.3 (spec §6.3), which also
   * accepts 1.0, 1.1 and 1.2 files; `attr_<key>` cells are checked against the definitions
   * by the validator, not by the schema.
   */
  @Get('csv-template/schema.json')
  async schema(@Res({ passthrough: true }) response: HttpResponse): Promise<unknown> {
    csvSchema ??= readFile(CSV_SCHEMA_PATH, 'utf8').then((text) => JSON.parse(text) as unknown);
    response.setHeader('Content-Type', 'application/schema+json; charset=utf-8');
    response.setHeader('Content-Disposition', 'inline; filename="oecp-csv-1.3.schema.json"');
    return csvSchema;
  }

  private template(
    kind: CsvFileKind,
    response: HttpResponse,
    attributeDefinitions: readonly AttributeDefinition[] = [],
  ): string {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return csvTemplate(kind, { attributeDefinitions });
  }
}
