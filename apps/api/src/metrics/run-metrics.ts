// SPDX-License-Identifier: EUPL-1.2
import { Counter, Gauge, type Registry } from '@prometheus-io/client';

/** Last successful sync run of an organization on a channel. */
export interface SyncLastSuccess {
  organizationSlug: string;
  channel: string;
  finishedAt: Date;
}

/** Most recent consecutive failed harvest runs of an organization. */
export interface SyncFailureStreak {
  organizationSlug: string;
  failures: number;
}

/** Everything the worker derives from the database (start-up and refreshes). */
export interface RunMetricsSnapshot {
  syncLastSuccess: SyncLastSuccess[];
  syncFailureStreaks: SyncFailureStreak[];
  /** Last successful run per maintenance job. */
  maintenanceLastSuccess: { job: string; finishedAt: Date }[];
  /** Last completed IdP metadata refresh, null when there is none. */
  idpLastSuccess: Date | null;
}

/** Latest signing-certificate expiry of one identity provider of the realm. */
export interface IdpCertificateExpiry {
  alias: string;
  enabled: boolean;
  /** Latest `notAfter` among its parsable signing certificates. */
  notAfter: Date;
}

const seconds = (date: Date) => date.getTime() / 1000;

/**
 * The worker's run metrics (spec §10): sync runs (harvests, queued CSV uploads),
 * maintenance runs, the IdP metadata refresh and the expiry of the identity
 * providers' signing certificates. Plain @prometheus-io/client objects on the
 * given registry; RunMetricsService feeds them from the hooks and the database.
 */
export class RunMetrics {
  readonly syncRuns: Counter<'channel' | 'status'>;
  readonly syncLastSuccess: Gauge<'organization_slug' | 'channel'>;
  readonly syncConsecutiveFailures: Gauge<'organization_slug'>;
  readonly harvestInProgress: Gauge;
  readonly maintenanceRuns: Counter<'job' | 'status'>;
  readonly maintenanceLastSuccess: Gauge<'job'>;
  readonly idpLastSuccess: Gauge;
  readonly idpCertificateExpiry: Gauge<'alias' | 'enabled'>;
  readonly idpCertificateCheckLastSuccess: Gauge;
  /** Seconds; the in-process value wins over an older database row (recorded later). */
  private idpLastSeconds = 0;

  constructor(registry: Registry) {
    const registers = [registry];
    this.syncRuns = new Counter({
      name: 'oecp_sync_runs_total',
      help: 'Sync runs finished by this worker, by channel (oeapi, csv) and status (succeeded, partial, failed).',
      labelNames: ['channel', 'status'] as const,
      registers,
    });
    this.syncLastSuccess = new Gauge({
      name: 'oecp_sync_run_last_success_timestamp_seconds',
      help: 'Unix time at which the last succeeded or partial sync run of the organization on the channel finished (from sync_runs).',
      labelNames: ['organization_slug', 'channel'] as const,
      registers,
    });
    this.syncConsecutiveFailures = new Gauge({
      name: 'oecp_sync_runs_consecutive_failures',
      help: 'Most recent consecutive failed harvest (oeapi) runs of the organization; 0 after a succeeded or partial run (from sync_runs).',
      labelNames: ['organization_slug'] as const,
      registers,
    });
    this.harvestInProgress = new Gauge({
      name: 'oecp_harvest_in_progress',
      help: 'Harvest runs in progress in this worker.',
      registers,
    });
    this.maintenanceRuns = new Counter({
      name: 'oecp_maintenance_runs_total',
      help: 'Maintenance runs finished by this worker, by job and status (succeeded, failed, skipped).',
      labelNames: ['job', 'status'] as const,
      registers,
    });
    this.maintenanceLastSuccess = new Gauge({
      name: 'oecp_maintenance_run_last_success_timestamp_seconds',
      help: 'Unix time at which the last succeeded run of the maintenance job finished (from maintenance_runs).',
      labelNames: ['job'] as const,
      registers,
    });
    this.idpLastSuccess = new Gauge({
      name: 'oecp_idp_metadata_refresh_last_success_timestamp_seconds',
      help: 'Unix time of the last completed IdP metadata refresh without failures; 0 when none (or the job is not configured).',
      registers,
    });
    this.idpCertificateExpiry = new Gauge({
      name: 'oecp_idp_certificate_expiry_timestamp_seconds',
      help: 'Unix time of the latest notAfter among the signing certificates of the identity provider in Keycloak (one series per alias; none without a parsable certificate).',
      labelNames: ['alias', 'enabled'] as const,
      registers,
    });
    this.idpCertificateCheckLastSuccess = new Gauge({
      name: 'oecp_idp_certificate_check_last_success_timestamp_seconds',
      help: 'Unix time of the last successful read of the identity providers signing certificates from Keycloak; 0 when none.',
      registers,
    });
  }

  syncRunFinished(channel: string, status: string, finishedAt: Date, organizationSlug?: string) {
    this.syncRuns.inc({ channel, status });
    if (organizationSlug && (status === 'succeeded' || status === 'partial')) {
      this.syncLastSuccess.set(
        { organization_slug: organizationSlug, channel },
        seconds(finishedAt),
      );
    }
  }

  maintenanceRunFinished(job: string, status: string, finishedAt: Date): void {
    this.maintenanceRuns.inc({ job, status });
    if (status === 'succeeded') this.maintenanceLastSuccess.set({ job }, seconds(finishedAt));
  }

  idpRefreshSucceeded(at: Date): void {
    this.idpLastSeconds = Math.max(this.idpLastSeconds, seconds(at));
    this.idpLastSuccess.set(this.idpLastSeconds);
  }

  /**
   * Replaces the certificate expiry series at once (identity providers removed
   * from the realm disappear) and records the successful check.
   */
  idpCertificatesChecked(expiries: readonly IdpCertificateExpiry[], at: Date): void {
    this.idpCertificateExpiry.reset();
    for (const e of expiries) {
      this.idpCertificateExpiry.set(
        { alias: e.alias, enabled: String(e.enabled) },
        seconds(e.notAfter),
      );
    }
    this.idpCertificateCheckLastSuccess.set(seconds(at));
  }

  /**
   * Replaces every database-derived gauge at once (reset and set run without
   * an await in between, so a scrape never sees them half-filled). Organizations
   * and jobs that disappeared from the database disappear from the metrics.
   */
  apply(snapshot: RunMetricsSnapshot): void {
    this.syncLastSuccess.reset();
    for (const s of snapshot.syncLastSuccess) {
      this.syncLastSuccess.set(
        { organization_slug: s.organizationSlug, channel: s.channel },
        seconds(s.finishedAt),
      );
    }
    this.syncConsecutiveFailures.reset();
    for (const s of snapshot.syncFailureStreaks) {
      this.syncConsecutiveFailures.set({ organization_slug: s.organizationSlug }, s.failures);
    }
    this.maintenanceLastSuccess.reset();
    for (const m of snapshot.maintenanceLastSuccess) {
      this.maintenanceLastSuccess.set({ job: m.job }, seconds(m.finishedAt));
    }
    // The refresh reports success before MaintenanceRunner records the run.
    const idp = snapshot.idpLastSuccess ? seconds(snapshot.idpLastSuccess) : 0;
    this.idpLastSeconds = Math.max(this.idpLastSeconds, idp);
    this.idpLastSuccess.set(this.idpLastSeconds);
  }
}
