// SPDX-License-Identifier: EUPL-1.2
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type AdminCsvReference,
  type AttributeDefinition,
  CSV_SCHEMA_VERSION,
  CSV_UPLOADS_PER_HOUR,
  type CsvFileKind,
  decodeCsvBytes,
  parseCsvText,
  type SyncRun,
  type SyncRunFiles,
} from '@oecp/schemas';
import { sql } from 'kysely';
import { ProblemException } from '../../common/problem.js';
import { loadAttributeDefinitions } from '../../attributes/attribute-definitions.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import {
  type CsvRunOutcome,
  CsvIngestionService,
} from '../../ingestion/csv/csv-ingestion.service.js';
import { CSV_INLINE_MAX_ROWS } from '../../ingestion/csv/csv.constants.js';
import { CsvQueue } from '../../ingestion/csv/csv.queue.js';
import { loadCsvReferenceLists } from '../../ingestion/csv/csv-reference-data.js';
import { UploadStorage } from '../../ingestion/csv/upload-storage.js';
import { SyncRunsRepository, toApiSyncRun } from '../../ingestion/sync-runs.repository.js';
import type { AdminPrincipal } from '../auth/claims.js';
import type { UploadedCsvFile } from './csv-upload.interceptor.js';

export const UPLOADS_CLOCK = Symbol('UPLOADS_CLOCK');
const HOUR_MS = 60 * 60 * 1000;

/** Spec §6.3: 10 uploads per hour per organization; carries the Retry-After delay. */
export class UploadRateLimited extends ProblemException {
  constructor(readonly retryAfterSeconds: number) {
    super(429, 'oecp.csv.rate_limited', `Try again in ${retryAfterSeconds} s`);
  }
}

/** `SyncRun.files` entry: the file name as sent, 1–200 characters (`<kind>.csv` if empty). */
export function uploadedFileName(
  file: Pick<UploadedCsvFile, 'originalname'>,
  kind: CsvFileKind,
): string {
  const name = Array.from(file.originalname.trim()).slice(0, 200).join('');
  return name.length > 0 ? name : `${kind}.csv`;
}

export type UploadResult =
  | { processedInline: true; syncRunId: string; outcome: CsvRunOutcome; run: SyncRun }
  | { processedInline: false; syncRunId: string };

/**
 * Channel B entry point (spec §6.3, §6.5): channel and rate checks, raw files to
 * `OECP_UPLOADS_DIR`, one `sync_runs` row (`csv`/`upload`), then processing in
 * the request (≤ 500 rows) or by the worker (job `csv-{syncRunId}`).
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly storage: UploadStorage,
    private readonly ingestion: CsvIngestionService,
    private readonly queue: CsvQueue,
    private readonly runs: SyncRunsRepository,
    @Optional() @Inject(UPLOADS_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  /** `GET /api/admin/v1/reference`: what an upload of the organization is checked against. */
  csvReference(organizationId: string): Promise<AdminCsvReference> {
    return loadCsvReferenceLists(this.db, organizationId);
  }

  /** The alliance's attribute definitions (`attr_<key>` columns of `courses.csv`). */
  attributeDefinitions(): Promise<AttributeDefinition[]> {
    return loadAttributeDefinitions(this.db);
  }

  /**
   * `onRun` is called with the run id as soon as the `sync_runs` row is
   * committed, also when a later step fails (the controller sets `Location`).
   */
  async create(
    admin: AdminPrincipal,
    organizationId: string,
    files: Partial<Record<CsvFileKind, UploadedCsvFile>>,
    onRun: (syncRunId: string) => void = () => undefined,
  ): Promise<UploadResult> {
    const present = (['courses', 'offerings'] as const).flatMap((kind) => {
      const file = files[kind];
      return file ? [{ kind, file }] : [];
    });
    if (present.length === 0) throw new ProblemException(400, 'oecp.csv.no_files');

    // Spec §6.5: one authoritative channel; CSV is refused for OEAPI organizations.
    const integration = await this.db
      .selectFrom('partner_integrations')
      .select('authoritative_channel')
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (integration?.authoritative_channel === 'oeapi') {
      throw new ProblemException(
        409,
        'oecp.sync.channel_disabled',
        'The authoritative channel of this organization is oeapi; CSV uploads are disabled',
      );
    }

    // Row count decides inline vs queued; validation proper happens in the run.
    let rows = 0;
    for (const { kind, file } of present) {
      const decoded = decodeCsvBytes(file.buffer, kind);
      if (decoded.errors.length === 0)
        rows += parseCsvText(decoded.text, { file: kind }).rows.length;
    }
    const inline = rows <= CSV_INLINE_MAX_ROWS;

    const now = this.now();
    const id = randomUUID();
    // Original names as sent by the browser, cut like the audit row's (spec §6.3).
    const names = Object.fromEntries(
      present.map(({ kind, file }) => [kind, uploadedFileName(file, kind)]),
    ) as SyncRunFiles;
    const key = UploadStorage.key(organizationId, id);
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'oecp-csv-upload:' + organizationId}))`.execute(
        trx,
      );
      const recent = await trx
        .selectFrom('sync_runs')
        .select('created_at')
        .where('organization_id', '=', organizationId)
        .where('channel', '=', 'csv')
        .where('trigger_kind', '=', 'upload')
        .where('created_at', '>', new Date(now.getTime() - HOUR_MS))
        .orderBy('created_at', 'asc')
        .execute();
      if (recent.length >= CSV_UPLOADS_PER_HOUR) {
        const oldest = new Date(recent[0]?.created_at ?? now).getTime();
        throw new UploadRateLimited(
          Math.max(1, Math.ceil((oldest + HOUR_MS - now.getTime()) / 1000)),
        );
      }
      await trx
        .insertInto('sync_runs')
        .values({
          id,
          organization_id: organizationId,
          channel: 'csv',
          trigger_kind: 'upload',
          triggered_by: admin.sub,
          schema_version: CSV_SCHEMA_VERSION,
          upload_object_key: key,
          files: names,
          status: 'queued',
          created_at: now,
        })
        .execute();
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: admin.sub,
          actor_org_id: admin.orgId ?? null,
          action: 'upload.create',
          entity_type: 'sync_run',
          entity_id: id,
          changes: {
            organization_id: organizationId,
            upload_object_key: key,
            rows,
            processed_inline: inline,
            files: Object.fromEntries(
              present.map(({ kind, file }) => [
                kind,
                {
                  name: names[kind],
                  bytes: file.size,
                  sha256: createHash('sha256').update(file.buffer).digest('hex'),
                },
              ]),
            ),
          },
        })
        .execute();
      try {
        for (const { kind, file } of present) await this.storage.write(key, kind, file.buffer);
      } catch (error) {
        await this.storage.remove(key).catch(() => undefined);
        throw error;
      }
    });

    onRun(id);

    if (inline) {
      const outcome = await this.ingestion.process(id);
      const run = await this.runs.get(id);
      if (!run) throw new Error(`sync run ${id} vanished`);
      return { processedInline: true, syncRunId: id, outcome, run: toApiSyncRun(run) };
    }
    try {
      await this.queue.enqueue(id);
    } catch (error) {
      this.logger.error(error, `CSV upload ${id} could not be queued`);
      await this.runs.cancelQueued(id, 'The processing queue is unavailable', this.now());
      throw new ProblemException(503, 'oecp.internal', 'The processing queue is unavailable');
    }
    return { processedInline: false, syncRunId: id };
  }
}
