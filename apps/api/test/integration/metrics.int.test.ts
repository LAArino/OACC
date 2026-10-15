// SPDX-License-Identifier: EUPL-1.2
import { Logger } from '@nestjs/common';
import type { Registry } from '@prometheus-io/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SyncRunStatus } from '@oecp/schemas';
import { MaintenanceRunner } from '../../src/maintenance/maintenance-runner.js';
import { MaintenanceRunsRepository } from '../../src/maintenance/maintenance-runs.repository.js';
import { createMetricsRegistry } from '../../src/metrics/metrics.registry.js';
import { RunMetricsService } from '../../src/metrics/run-metrics.service.js';
import { configStub } from '../support/config-stub.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const GONE = '0a000000-0000-4000-8000-0000000000ff';
const t = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00Z`);
const s = (date: Date) => date.getTime() / 1000;

/** Value of the sample `line` (metric name with labels), undefined when absent. */
async function value(registry: Registry, line: string): Promise<number | undefined> {
  const found = (await registry.metrics()).split('\n').find((l) => l.startsWith(`${line} `));
  return found === undefined ? undefined : Number(found.slice(line.length + 1));
}

describe.runIf(describeWithDatabase === 'run')('Run metrics from the database (PostgreSQL)', () => {
  let tdb: TestDatabase;

  const syncRun = (
    organizationId: string,
    channel: 'oeapi' | 'csv',
    status: SyncRunStatus,
    finishedAt: Date | null,
  ) =>
    tdb.db
      .insertInto('sync_runs')
      .values({
        organization_id: organizationId,
        channel,
        trigger_kind: channel === 'csv' ? 'upload' : 'schedule',
        triggered_by: null,
        schema_version: channel === 'csv' ? 'oecp-csv-1' : 'oeapi-5.0',
        upload_object_key: null,
        status,
        started_at: finishedAt ? new Date(finishedAt.getTime() - 60_000) : t('23:00'),
        finished_at: finishedAt,
        created_at: finishedAt ? new Date(finishedAt.getTime() - 120_000) : t('23:00'),
      })
      .execute();

  const maintenanceRun = (
    job: string,
    status: 'succeeded' | 'failed' | 'skipped',
    finishedAt: Date,
    details: Record<string, unknown> | null = null,
  ) =>
    tdb.db
      .insertInto('maintenance_runs')
      .values({
        job,
        trigger_kind: 'schedule',
        triggered_by: null,
        status,
        started_at: new Date(finishedAt.getTime() - 1_000),
        finished_at: finishedAt,
        counters: {},
        details,
      })
      .execute();

  beforeAll(async () => {
    Logger.overrideLogger(false);
    tdb = await createTestDatabase();
    await tdb.db
      .insertInto('organizations')
      .values({
        id: GONE,
        org_type: 'institution',
        is_partner: true,
        partner_id: GONE,
        slug: 'gone',
        name: { en: 'Gone' },
        keycloak_idp_alias: null,
        deleted_at: t('00:00'),
      })
      .execute();

    // uibk: succeeded, then two failures (a cancelled and a running run do not count).
    await syncRun(ORG.uibk, 'oeapi', 'succeeded', t('01:00'));
    await syncRun(ORG.uibk, 'oeapi', 'failed', t('02:00'));
    await syncRun(ORG.uibk, 'oeapi', 'cancelled', t('02:30'));
    await syncRun(ORG.uibk, 'oeapi', 'failed', t('03:00'));
    await syncRun(ORG.uibk, 'oeapi', 'running', null);
    // urv: only a failed harvest; a succeeded CSV upload.
    await syncRun(ORG.urv, 'oeapi', 'failed', t('04:00'));
    await syncRun(ORG.urv, 'csv', 'succeeded', t('05:00'));
    // faculty: a partial harvest is a success, after a failure.
    await syncRun(ORG.uibkFaculty, 'oeapi', 'failed', t('05:30'));
    await syncRun(ORG.uibkFaculty, 'oeapi', 'partial', t('06:00'));
    // A soft-deleted organization is left out.
    await syncRun(GONE, 'oeapi', 'failed', t('06:30'));

    await maintenanceRun('retention', 'succeeded', t('04:45'));
    await maintenanceRun('retention', 'failed', t('05:45'));
    await maintenanceRun('dormancy', 'skipped', t('05:00'));
    await maintenanceRun('idp-metadata-refresh', 'succeeded', t('04:15'), { status: 'completed' });
    await maintenanceRun('idp-metadata-refresh', 'succeeded', t('07:00'), {
      status: 'not_configured',
    });
    await maintenanceRun('idp-metadata-refresh', 'failed', t('08:00'), { status: 'completed' });
  }, 60_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  it('initialises the gauges from sync_runs and maintenance_runs at start-up', async () => {
    const registry = createMetricsRegistry({ version: '0.0.0', commit: 'test' });
    const service = new RunMetricsService(registry, tdb.db, configStub({}));
    await service.onApplicationBootstrap();
    service.onApplicationShutdown();

    const lastSuccess = 'oecp_sync_run_last_success_timestamp_seconds';
    expect(await value(registry, `${lastSuccess}{organization_slug="uibk",channel="oeapi"}`)).toBe(
      s(t('01:00')),
    );
    expect(await value(registry, `${lastSuccess}{organization_slug="urv",channel="csv"}`)).toBe(
      s(t('05:00')),
    );
    expect(
      await value(registry, `${lastSuccess}{organization_slug="uibk-informatik",channel="oeapi"}`),
    ).toBe(s(t('06:00')));
    expect(
      await value(registry, `${lastSuccess}{organization_slug="urv",channel="oeapi"}`),
    ).toBeUndefined();

    const failures = 'oecp_sync_runs_consecutive_failures';
    expect(await value(registry, `${failures}{organization_slug="uibk"}`)).toBe(2);
    expect(await value(registry, `${failures}{organization_slug="urv"}`)).toBe(1);
    expect(await value(registry, `${failures}{organization_slug="uibk-informatik"}`)).toBe(0);
    expect(await registry.metrics()).not.toContain('organization_slug="gone"');
    expect(await registry.metrics()).not.toContain('organization_slug="aurora"');

    const maintenance = 'oecp_maintenance_run_last_success_timestamp_seconds';
    expect(await value(registry, `${maintenance}{job="retention"}`)).toBe(s(t('04:45')));
    expect(await value(registry, `${maintenance}{job="dormancy"}`)).toBeUndefined();
    expect(await value(registry, 'oecp_idp_metadata_refresh_last_success_timestamp_seconds')).toBe(
      s(t('04:15')),
    );
    // Start-up does not invent counts.
    expect(await registry.metrics()).not.toMatch(/^oecp_sync_runs_total\{/m);
  });

  it('recomputes the failure streak after a run and records maintenance runs', async () => {
    const registry = createMetricsRegistry({ version: '0.0.0', commit: 'test' });
    const service = new RunMetricsService(registry, tdb.db, configStub({}));
    await service.refresh();

    await syncRun(ORG.urv, 'oeapi', 'succeeded', t('09:00'));
    await service.syncRunFinished({
      organizationId: ORG.urv,
      channel: 'oeapi',
      status: 'succeeded',
      finishedAt: t('09:00'),
    });
    expect(
      await value(registry, 'oecp_sync_runs_consecutive_failures{organization_slug="urv"}'),
    ).toBe(0);
    expect(
      await value(
        registry,
        'oecp_sync_run_last_success_timestamp_seconds{organization_slug="urv",channel="oeapi"}',
      ),
    ).toBe(s(t('09:00')));
    expect(await value(registry, 'oecp_sync_runs_total{channel="oeapi",status="succeeded"}')).toBe(
      1,
    );

    const runner = new MaintenanceRunner(tdb.db, new MaintenanceRunsRepository(tdb.db), service);
    await runner.run('history-partitions', 'manual', 'sub-1', async () => ({ counters: {} }));
    expect(
      await value(
        registry,
        'oecp_maintenance_runs_total{job="history-partitions",status="succeeded"}',
      ),
    ).toBe(1);
    const recorded = await tdb.db
      .selectFrom('maintenance_runs')
      .select('finished_at')
      .where('job', '=', 'history-partitions')
      .executeTakeFirstOrThrow();
    await service.refresh();
    expect(
      await value(
        registry,
        'oecp_maintenance_run_last_success_timestamp_seconds{job="history-partitions"}',
      ),
    ).toBe(new Date(recorded.finished_at!).getTime() / 1000);
  });
});
