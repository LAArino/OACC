// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type IntegrationUpdateRequest,
  type OeapiV5Service,
  oeapiV5PageEnvelope,
  oeapiV5Service,
  type PartnerIntegration,
  type SyncNowResponse,
  type SyncRunDetail,
  type SyncRunDetailQuery,
  type TestConnectionResult,
} from '@oecp/schemas';
import { ProblemException } from '../../common/problem.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import { HarvestQueue } from '../../ingestion/harvest.queue.js';
import {
  hostOf,
  integrationBlocker,
  OeapiClientFactory,
  type PartnerIntegrationRow,
} from '../../ingestion/oeapi/oeapi-client.factory.js';
import { OeapiError } from '../../ingestion/oeapi/oeapi-v5.client.js';
import { SyncRunsRepository, toApiSyncRun } from '../../ingestion/sync-runs.repository.js';
import { MasterKeyUnavailableError, SecretsService } from '../../secrets/secrets.service.js';
import type { AdminPrincipal } from '../auth/claims.js';

/** Spec §6.2.1: "Sync now" at most once per 15 minutes per organization. */
export const SYNC_NOW_INTERVAL_MS = 15 * 60 * 1000;
export const INTEGRATIONS_CLOCK = Symbol('INTEGRATIONS_CLOCK');

/** Thrown by "Sync now" when rate-limited; carries the Retry-After delay. */
export class SyncNowRateLimited extends ProblemException {
  constructor(readonly retryAfterSeconds: number) {
    super(429, 'oecp.sync.rate_limited', `Try again in ${retryAfterSeconds} s`);
  }
}

/** Members compared and audited on PUT (the credential is audited as an action only). */
const AUDITED = [
  'authoritative_channel',
  'access_mode',
  'oeapi_version',
  'consumer_profile',
  'base_url',
  'auth_scheme',
  'api_key_header_name',
  'surfeduhub_endpoint_id',
  'approved_host',
  'schedule_cron',
  'schedule_timezone',
  'page_size',
  'max_requests_per_second',
  'withdraw_after_absences',
  'enabled',
] as const;

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/** Partner integration settings, test connection and "Sync now" (spec §6.2, §8.1.1). */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly secrets: SecretsService,
    private readonly clients: OeapiClientFactory,
    private readonly runs: SyncRunsRepository,
    private readonly harvests: HarvestQueue,
    @Optional() @Inject(INTEGRATIONS_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async get(organizationId: string): Promise<PartnerIntegration> {
    return this.toApi(await this.require(organizationId));
  }

  async update(
    organizationId: string,
    body: IntegrationUpdateRequest,
    admin: AdminPrincipal,
  ): Promise<PartnerIntegration> {
    const allowInsecure = this.clients.settings.allowInsecure;
    if (body.base_url !== null) {
      const url = new URL(body.base_url);
      const secure = url.protocol === 'https:' && (url.port === '' || url.port === '443');
      if (!secure && !allowInsecure) {
        throw new ProblemException(422, 'oecp.integration.insecure_url', body.base_url);
      }
    }
    if (body.access_mode === 'surfeduhub' && !this.clients.settings.surfeduhubSecretRef) {
      throw new ProblemException(422, 'oecp.integration.surfeduhub_unavailable');
    }
    // A credential to store needs the master key: refuse before writing anything.
    if (typeof body.secret === 'string' && body.auth_scheme !== 'none') this.requireSecrets();

    const row = await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('partner_integrations')
        .selectAll()
        .where('organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();

      // Write-only credential: omitted keeps, null deletes, a string replaces.
      let secretRef = before?.secret_ref ?? null;
      let secretAction: 'unchanged' | 'set' | 'replaced' | 'deleted' = 'unchanged';
      const dropSecret = body.secret === null || body.auth_scheme === 'none';
      if (dropSecret && secretRef) {
        if (secretRef.startsWith('db:')) await this.secrets.delete(secretRef, trx);
        secretRef = null;
        secretAction = 'deleted';
      } else if (typeof body.secret === 'string') {
        if (secretRef?.startsWith('db:')) {
          await this.secrets.replace(secretRef, body.secret, trx);
          secretAction = 'replaced';
        } else {
          secretRef = await this.secrets.store(
            `partner-integration:${organizationId}`,
            body.secret,
            trx,
          );
          secretAction = 'set';
        }
      }
      if (body.auth_scheme !== 'none' && !secretRef) {
        throw new ProblemException(422, 'oecp.integration.secret_required');
      }

      // A new host needs a new approval (spec §6.2.6).
      const newHost = body.access_mode === 'direct' ? hostOf(body.base_url) : null;
      const keepApproval =
        before?.approved_host != null &&
        newHost !== null &&
        before.approved_host.toLowerCase() === newHost;
      const values = {
        authoritative_channel: body.authoritative_channel,
        access_mode: body.access_mode,
        oeapi_version: body.oeapi_version,
        consumer_profile: body.consumer_profile,
        base_url: body.base_url,
        auth_scheme: body.auth_scheme,
        api_key_header_name:
          body.auth_scheme === 'api_key_header' ? body.api_key_header_name : null,
        secret_ref: secretRef,
        surfeduhub_endpoint_id: body.surfeduhub_endpoint_id,
        approved_host: keepApproval ? (before?.approved_host ?? null) : null,
        approved_by: keepApproval ? (before?.approved_by ?? null) : null,
        approved_at: keepApproval ? (before?.approved_at ?? null) : null,
        schedule_cron: body.schedule_cron,
        schedule_timezone: body.schedule_timezone,
        page_size: body.page_size,
        max_requests_per_second: body.max_requests_per_second,
        withdraw_after_absences: body.withdraw_after_absences,
        enabled: body.enabled,
      };
      const after = before
        ? await trx
            .updateTable('partner_integrations')
            .set(values)
            .where('id', '=', before.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('partner_integrations')
            .values({ organization_id: organizationId, ...values })
            .returningAll()
            .executeTakeFirstOrThrow();

      const changes: Record<string, unknown> = {};
      for (const key of AUDITED) {
        const from = before ? normalise(before[key]) : null;
        const to = normalise(after[key]);
        if (!before || from !== to) changes[key] = { from, to };
      }
      if (secretAction !== 'unchanged') changes['secret'] = secretAction;
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: admin.sub,
          actor_org_id: admin.orgId ?? null,
          action: before ? 'integration.update' : 'integration.create',
          entity_type: 'partner_integration',
          entity_id: after.id,
          changes: { organization_id: organizationId, ...changes },
        })
        .execute();
      return after;
    });
    return this.toApi(row);
  }

  /** alliance_admin approves the current `base_url` host for direct harvesting. */
  async approveHost(organizationId: string, admin: AdminPrincipal): Promise<PartnerIntegration> {
    const row = await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('partner_integrations')
        .selectAll()
        .where('organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new ProblemException(404, 'oecp.integration.not_configured');
      if (current.access_mode !== 'direct' || !current.base_url) {
        throw new ProblemException(
          409,
          'oecp.integration.base_url_required',
          'Host approval applies to direct access with a base_url',
        );
      }
      const url = new URL(current.base_url);
      const secure = url.protocol === 'https:' && (url.port === '' || url.port === '443');
      if (!secure && !this.clients.settings.allowInsecure) {
        throw new ProblemException(422, 'oecp.integration.insecure_url', current.base_url);
      }
      const host = hostOf(current.base_url);
      const now = this.now();
      const updated = await trx
        .updateTable('partner_integrations')
        .set({ approved_host: host, approved_by: admin.sub, approved_at: now })
        .where('id', '=', current.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: admin.sub,
          actor_org_id: admin.orgId ?? null,
          action: 'integration.approve_host',
          entity_type: 'partner_integration',
          entity_id: current.id,
          changes: {
            organization_id: organizationId,
            approved_host: { from: current.approved_host, to: host },
          },
        })
        .execute();
      return updated;
    });
    return this.toApi(row);
  }

  /**
   * "Test connection" (spec §8.1.1): `GET /` and `GET /courses?pageSize=1` with the
   * stored settings. Remote failures are reported in the body (`ok: false`).
   */
  async testConnection(organizationId: string): Promise<TestConnectionResult> {
    const row = await this.require(organizationId);
    const blocker = integrationBlocker(row, this.clients.settings);
    if (blocker) throw new ProblemException(409, blocker.code, blocker.detail);
    // A stored credential cannot be read without the master key: a deployment
    // problem (503), not a failure of the partner endpoint.
    if (row.access_mode === 'surfeduhub' || row.auth_scheme !== 'none') this.requireSecrets();

    const started = Date.now();
    const result: TestConnectionResult = {
      ok: false,
      target:
        row.access_mode === 'surfeduhub'
          ? `${this.clients.settings.gatewayUrl} (X-Route: endpoint=${row.surfeduhub_endpoint_id})`
          : (row.base_url ?? ''),
      duration_ms: 0,
      service: null,
      first_course_primary_code: null,
      courses_available: null,
      error: null,
    };
    try {
      const client = await this.clients.create(row, { signal: AbortSignal.timeout(90_000) });
      const service = oeapiV5Service.safeParse((await client.getJson('/')).body);
      const doc: OeapiV5Service = service.success ? service.data : {};
      result.service = {
        contact_email: doc.contactEmail ?? null,
        specification: doc.specification ?? null,
        documentation: doc.documentation ?? null,
      };
      const page = oeapiV5PageEnvelope.safeParse(
        (await client.getJson('/courses', { pageSize: 1, pageNumber: 1 })).body,
      );
      if (!page.success) {
        throw new OeapiError('oecp.oeapi.invalid_payload', 'GET /courses is not an OEAPI v5 page');
      }
      const first = page.data.items[0] as { primaryCode?: { code?: unknown } } | undefined;
      result.courses_available = page.data.items.length > 0;
      result.first_course_primary_code =
        typeof first?.primaryCode?.code === 'string' ? first.primaryCode.code : null;
      result.ok = true;
    } catch (error) {
      if (!(error instanceof OeapiError)) throw error;
      result.error = {
        code: error.code,
        message: error.message,
        ...(error.status !== undefined ? { status: error.status } : {}),
      };
    }
    result.duration_ms = Date.now() - started;
    this.logger.log(
      `Test connection for ${organizationId}: ${result.ok ? 'ok' : result.error?.code}`,
    );
    return result;
  }

  /** 503 `oecp.secrets.unavailable` when the master key is missing or invalid. */
  private requireSecrets(): void {
    try {
      this.secrets.assertAvailable();
    } catch (error) {
      if (!(error instanceof MasterKeyUnavailableError)) throw error;
      this.logger.error(`Secret storage unavailable: ${error.message}`);
      throw new ProblemException(
        503,
        'oecp.secrets.unavailable',
        'The master key (OECP_MASTER_KEY_FILE) is missing or invalid; ask the operator',
      );
    }
  }

  /** "Sync now": a queued manual run, at most once per 15 minutes (spec §6.2.1). */
  async syncNow(organizationId: string, admin: AdminPrincipal): Promise<SyncNowResponse> {
    const row = await this.require(organizationId);
    if (row.authoritative_channel !== 'oeapi') {
      throw new ProblemException(409, 'oecp.sync.channel_disabled');
    }
    const blocker = integrationBlocker(row, this.clients.settings);
    if (blocker) throw new ProblemException(409, blocker.code, blocker.detail);

    const now = this.now();
    if (
      (await this.runs.findActive(organizationId, now)) ||
      (await this.harvests.isActive(organizationId))
    ) {
      throw new ProblemException(409, 'oecp.sync.already_running');
    }
    const recent = await this.runs.latestManualSince(
      organizationId,
      new Date(now.getTime() - SYNC_NOW_INTERVAL_MS),
    );
    if (recent) {
      const wait = new Date(recent.created_at).getTime() + SYNC_NOW_INTERVAL_MS - now.getTime();
      throw new SyncNowRateLimited(Math.max(1, Math.ceil(wait / 1000)));
    }

    const run = await this.runs.createQueued({
      organizationId,
      trigger: 'manual',
      triggeredBy: admin.sub,
    });
    let queued: 'queued' | 'already_queued';
    try {
      queued = await this.harvests.request({
        organizationId,
        trigger: 'manual',
        triggeredBy: admin.sub,
        syncRunId: run.id,
      });
    } catch (error) {
      await this.runs.cancelQueued(run.id, 'The job queue is unavailable', now);
      throw error;
    }
    if (queued === 'already_queued') {
      await this.runs.cancelQueued(run.id, 'A run was already queued', now);
      throw new ProblemException(409, 'oecp.sync.already_running');
    }
    await this.db
      .insertInto('audit_log')
      .values({
        actor_sub: admin.sub,
        actor_org_id: admin.orgId ?? null,
        action: 'integration.sync_now',
        entity_type: 'sync_run',
        entity_id: run.id,
        changes: { organization_id: organizationId },
      })
      .execute();
    return { sync_run_id: run.id, status: 'queued' };
  }

  async listRuns(organizationId: string, limit: number) {
    return { items: (await this.runs.list(organizationId, limit)).map(toApiSyncRun) };
  }

  /** Run plus a page of its errors; returns the organization for the scope check. */
  async getRun(
    id: string,
    query: SyncRunDetailQuery,
  ): Promise<{ organizationId: string; detail: SyncRunDetail }> {
    const run = await this.runs.get(id);
    if (!run) throw new ProblemException(404, 'oecp.request.not_found', 'Sync run not found');
    const [{ items, total }, handbookIncomplete] = await Promise.all([
      this.runs.errors(id, {
        page: query.page,
        pageSize: query.page_size,
        severity: query.severity,
      }),
      this.runs.handbookIncomplete(id),
    ]);
    return {
      organizationId: run.organization_id,
      detail: {
        ...toApiSyncRun(run),
        handbook_incomplete: handbookIncomplete,
        errors: {
          items: items.map((e) => ({
            id: String(e.id),
            severity: e.severity,
            code: e.code,
            message: e.message,
            entity_type: e.entity_type,
            ext_id: e.ext_id,
            file: e.file,
            row_number: e.row_number,
            column_name: e.column_name,
            json_pointer: e.json_pointer,
            created_at: new Date(e.created_at).toISOString(),
          })),
          page: query.page,
          page_size: query.page_size,
          total,
        },
      },
    };
  }

  /** Organization of a run (scope check before loading its errors). */
  async runOrganization(id: string): Promise<string> {
    const run = await this.runs.get(id);
    if (!run) throw new ProblemException(404, 'oecp.request.not_found', 'Sync run not found');
    return run.organization_id;
  }

  private async require(organizationId: string): Promise<PartnerIntegrationRow> {
    const row = await this.db
      .selectFrom('partner_integrations')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!row) throw new ProblemException(404, 'oecp.integration.not_configured');
    return row;
  }

  private async toApi(row: PartnerIntegrationRow): Promise<PartnerIntegration> {
    const [last] = await this.runs.list(row.organization_id, 1);
    return {
      organization_id: row.organization_id,
      authoritative_channel: row.authoritative_channel,
      access_mode: row.access_mode,
      oeapi_version: row.oeapi_version,
      consumer_profile: row.consumer_profile,
      base_url: row.base_url,
      auth_scheme: row.auth_scheme,
      api_key_header_name: row.api_key_header_name,
      secret_configured: row.secret_ref !== null,
      surfeduhub_endpoint_id: row.surfeduhub_endpoint_id,
      approved_host: row.approved_host,
      approved_by: row.approved_by,
      approved_at: iso(row.approved_at),
      host_approved: hostApproved(row),
      schedule_cron: row.schedule_cron,
      schedule_timezone: row.schedule_timezone,
      page_size: row.page_size,
      max_requests_per_second: Number(row.max_requests_per_second),
      withdraw_after_absences: row.withdraw_after_absences,
      enabled: row.enabled,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
      last_run: last ? toApiSyncRun(last) : null,
    };
  }
}

/** `access_mode = direct` and `approved_host` equals the host of `base_url`. */
export function hostApproved(
  row: Pick<PartnerIntegrationRow, 'access_mode' | 'base_url' | 'approved_host'>,
): boolean {
  const host = hostOf(row.base_url);
  return (
    row.access_mode === 'direct' &&
    host !== null &&
    row.approved_host !== null &&
    row.approved_host.toLowerCase() === host
  );
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
