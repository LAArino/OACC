// SPDX-License-Identifier: EUPL-1.2
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { Registry } from '@prometheus-io/client';
import type { Env } from '../config/env.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { IDP_METADATA_REFRESH_JOB } from '../identity/metadata-refresh/idp-metadata-refresh.constants.js';
import { METRICS_REGISTRY } from './metrics.registry.js';
import { type IdpCertificateExpiry, RunMetrics, type RunMetricsSnapshot } from './run-metrics.js';

/** The database-derived gauges are also recomputed this often (runs finished elsewhere). */
export const RUN_METRICS_REFRESH_MS = 5 * 60_000;

/**
 * Reads the database-derived run gauges (spec §10):
 *
 * - last succeeded or partial sync run per organization and channel;
 * - consecutive failed harvests (channel `oeapi`) per organization: the failed
 *   runs finished after its last succeeded or partial one (cancelled, queued and
 *   running rows are ignored);
 * - last succeeded run per maintenance job;
 * - last `idp-metadata-refresh` run that succeeded with status `completed`
 *   (not `not_configured`).
 *
 * Soft-deleted organizations are left out.
 */
export async function loadRunMetricsSnapshot(db: Db): Promise<RunMetricsSnapshot> {
  const [lastSuccess, streaks, maintenance, idp] = await Promise.all([
    sql<{ slug: string; channel: string; finished_at: Date }>`
      SELECT o.slug, r.channel, max(r.finished_at) AS finished_at
      FROM sync_runs r
      JOIN organizations o ON o.id = r.organization_id
      WHERE r.status IN ('succeeded', 'partial')
        AND r.finished_at IS NOT NULL
        AND o.deleted_at IS NULL
      GROUP BY o.slug, r.channel
      ORDER BY o.slug, r.channel`.execute(db),
    sql<{ slug: string; failures: number }>`
      WITH ranked AS (
        SELECT organization_id, status,
               row_number() OVER (
                 PARTITION BY organization_id
                 ORDER BY finished_at DESC, created_at DESC, id DESC
               ) AS rn
        FROM sync_runs
        WHERE channel = 'oeapi'
          AND status IN ('succeeded', 'partial', 'failed')
          AND finished_at IS NOT NULL
      )
      SELECT o.slug,
             coalesce(min(ranked.rn) FILTER (WHERE ranked.status <> 'failed') - 1,
                      count(*))::int AS failures
      FROM ranked
      JOIN organizations o ON o.id = ranked.organization_id
      WHERE o.deleted_at IS NULL
      GROUP BY o.slug
      ORDER BY o.slug`.execute(db),
    sql<{ job: string; finished_at: Date }>`
      SELECT job, max(finished_at) AS finished_at
      FROM maintenance_runs
      WHERE status = 'succeeded' AND finished_at IS NOT NULL
      GROUP BY job
      ORDER BY job`.execute(db),
    sql<{ finished_at: Date | null }>`
      SELECT max(finished_at) AS finished_at
      FROM maintenance_runs
      WHERE job = ${IDP_METADATA_REFRESH_JOB}
        AND status = 'succeeded'
        AND details ->> 'status' = 'completed'`.execute(db),
  ]);
  const idpAt = idp.rows[0]?.finished_at;
  return {
    syncLastSuccess: lastSuccess.rows.map((r) => ({
      organizationSlug: r.slug,
      channel: r.channel,
      finishedAt: new Date(r.finished_at),
    })),
    syncFailureStreaks: streaks.rows.map((r) => ({
      organizationSlug: r.slug,
      failures: Number(r.failures),
    })),
    maintenanceLastSuccess: maintenance.rows.map((r) => ({
      job: r.job,
      finishedAt: new Date(r.finished_at),
    })),
    idpLastSuccess: idpAt ? new Date(idpAt) : null,
  };
}

/**
 * Worker side of the run metrics: the hooks called where runs finish
 * (HarvestService, CsvIngestionService, MaintenanceRunner,
 * IdpMetadataRefreshService) and the database-derived gauges, loaded at start-up
 * (so a restart does not blank them), after every sync run and every
 * {@link RUN_METRICS_REFRESH_MS} (runs finished by the api or another worker).
 * Metrics never fail a run: database errors are logged and skipped.
 */
@Injectable()
export class RunMetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RunMetricsService.name);
  readonly metrics: RunMetrics;
  /** OECP_METRICS_ENABLED (default true). */
  readonly enabled: boolean;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(METRICS_REGISTRY) registry: Registry,
    @Inject(KYSELY) private readonly db: Db,
    config: ConfigService<Env, true>,
  ) {
    this.metrics = new RunMetrics(registry);
    this.enabled = config.get('OECP_METRICS_ENABLED', { infer: true }) !== false;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), RUN_METRICS_REFRESH_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Recomputes the database-derived gauges; false when the database did not answer. */
  async refresh(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      this.metrics.apply(await loadRunMetricsSnapshot(this.db));
      return true;
    } catch (error) {
      this.logger.warn(`Run metrics not refreshed: ${(error as Error).message}`);
      return false;
    }
  }

  harvestStarted(): void {
    this.metrics.harvestInProgress.inc();
  }

  harvestEnded(): void {
    this.metrics.harvestInProgress.dec();
  }

  /** A sync run was finished (`sync_runs.finished_at` written) by this worker. */
  async syncRunFinished(run: {
    organizationId: string;
    channel: string;
    status: string;
    finishedAt: Date;
  }): Promise<void> {
    if (!this.enabled) return;
    let slug: string | undefined;
    try {
      const org = await this.db
        .selectFrom('organizations')
        .select('slug')
        .where('id', '=', run.organizationId)
        .executeTakeFirst();
      slug = org?.slug;
    } catch (error) {
      this.logger.warn(`Organization of a sync run not read: ${(error as Error).message}`);
    }
    this.metrics.syncRunFinished(run.channel, run.status, run.finishedAt, slug);
    // Consecutive failures (and anything the api finished meanwhile) from the database.
    await this.refresh();
  }

  /** A maintenance run was recorded in `maintenance_runs` by this worker. */
  maintenanceRunFinished(job: string, status: string, finishedAt = new Date()): void {
    if (!this.enabled) return;
    this.metrics.maintenanceRunFinished(job, status, finishedAt);
  }

  /** An IdP metadata refresh completed without failures (not a dry run). */
  idpRefreshSucceeded(at = new Date()): void {
    if (!this.enabled) return;
    this.metrics.idpRefreshSucceeded(at);
  }

  /** The signing certificates of the realm's identity providers were read (IdpCertificateMetricsService). */
  idpCertificatesChecked(expiries: readonly IdpCertificateExpiry[], at = new Date()): void {
    if (!this.enabled) return;
    this.metrics.idpCertificatesChecked(expiries, at);
  }
}
