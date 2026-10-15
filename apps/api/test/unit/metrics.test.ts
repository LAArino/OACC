// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { Registry } from '@prometheus-io/client';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MaintenanceJobError,
  MaintenanceRunner,
} from '../../src/maintenance/maintenance-runner.js';
import { MaintenanceRunsRepository } from '../../src/maintenance/maintenance-runs.repository.js';
import {
  HttpMetrics,
  HttpMetricsMiddleware,
  methodLabel,
  routeTemplate,
  UNMATCHED_ROUTE,
} from '../../src/metrics/http-metrics.js';
import {
  createMetricsRegistry,
  renderMetrics,
  UNMEASURED_PATHS,
} from '../../src/metrics/metrics.registry.js';
import { RunMetrics } from '../../src/metrics/run-metrics.js';
import { RunMetricsService } from '../../src/metrics/run-metrics.service.js';
import { configStub } from '../support/config-stub.js';
import { createFakeDb, type RecordedQuery } from '../support/fake-kysely.js';

const BUILD = { version: '9.9.9', commit: 'abc1234' };

/** Sample lines of the exposition whose metric name is `name` (labels kept). */
async function samples(registry: Registry, name: string): Promise<string[]> {
  const text = await registry.metrics();
  return text
    .split('\n')
    .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `));
}

async function families(registry: Registry): Promise<string[]> {
  const text = await registry.metrics();
  return [...text.matchAll(/^# TYPE (\S+) /gm)].map((m) => m[1]!).sort();
}

beforeAll(() => {
  Logger.overrideLogger(false);
});

describe('metrics registry', () => {
  it('exports oecp_build_info and the prefixed default metrics, nothing unprefixed', async () => {
    const registry = createMetricsRegistry(BUILD);
    expect(await samples(registry, 'oecp_build_info')).toEqual([
      'oecp_build_info{version="9.9.9",commit="abc1234"} 1',
    ]);
    const names = await families(registry);
    expect(names).toEqual(
      expect.arrayContaining([
        'oecp_process_cpu_seconds_total',
        'oecp_process_resident_memory_bytes',
        'oecp_nodejs_eventloop_lag_seconds',
        'oecp_nodejs_heap_size_used_bytes',
        'oecp_nodejs_version_info',
      ]),
    );
    expect(names.filter((n) => !n.startsWith('oecp_'))).toEqual([]);
    // Neither process-specific family is on a bare registry.
    expect(names.some((n) => n.startsWith('oecp_http_') || n.startsWith('oecp_sync_'))).toBe(false);
    const rendered = await renderMetrics(registry);
    expect(rendered.contentType).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(UNMEASURED_PATHS).toEqual(new Set(['/metrics', '/health', '/ready']));
  });
});

describe('HTTP metrics', () => {
  it('labels requests with the route template, never the raw URL', () => {
    expect(
      routeTemplate({
        route: { path: '/api/admin/v1/organizations/:id' },
        baseUrl: '',
      } as never),
    ).toBe('/api/admin/v1/organizations/:id');
    expect(routeTemplate({ route: { path: '/:id' }, baseUrl: '/things' } as never)).toBe(
      '/things/:id',
    );
    expect(routeTemplate({ url: '/nope/123' } as never)).toBe(UNMATCHED_ROUTE);
    expect(routeTemplate({ route: { path: '{/*splat}' }, baseUrl: '' } as never)).toBe(
      UNMATCHED_ROUTE,
    );
    expect(methodLabel('get')).toBe('GET');
    expect(methodLabel('PROPFIND')).toBe('OTHER');
    expect(methodLabel(undefined)).toBe('OTHER');
  });

  it('middleware: observes on finish, skips /metrics, /health, /ready and when disabled', async () => {
    const registry = createMetricsRegistry(BUILD);
    const http = new HttpMetrics(registry);
    const run = (middleware: HttpMetricsMiddleware, url: string, status = 200) => {
      const listeners: Record<string, () => void> = {};
      const req = { method: 'GET', originalUrl: url, url, route: { path: '/things/:id' } };
      const res = {
        statusCode: status,
        once: (event: string, fn: () => void) => void (listeners[event] = fn),
      };
      let nextCalled = false;
      middleware.use(req as never, res as never, () => void (nextCalled = true));
      listeners['finish']?.();
      return nextCalled;
    };
    const enabled = new HttpMetricsMiddleware(http, configStub({ OECP_METRICS_ENABLED: true }));
    expect(run(enabled, '/things/1?x=1', 404)).toBe(true);
    expect(run(enabled, '/things/2')).toBe(true);
    expect(run(enabled, '/metrics')).toBe(true);
    expect(run(enabled, '/health?probe=1')).toBe(true);
    expect(run(enabled, '/ready')).toBe(true);
    const disabled = new HttpMetricsMiddleware(http, configStub({ OECP_METRICS_ENABLED: false }));
    expect(run(disabled, '/things/3')).toBe(true);

    expect(await samples(registry, 'oecp_http_requests_total')).toEqual([
      'oecp_http_requests_total{method="GET",route="/things/:id",status="404"} 1',
      'oecp_http_requests_total{method="GET",route="/things/:id",status="200"} 1',
    ]);
    expect(await samples(registry, 'oecp_http_request_duration_seconds_count')).toEqual([
      'oecp_http_request_duration_seconds_count{method="GET",route="/things/:id"} 2',
    ]);
    const buckets = await samples(registry, 'oecp_http_request_duration_seconds_bucket');
    expect(buckets.map((b) => /le="([^"]+)"/.exec(b)?.[1])).toEqual([
      '0.005',
      '0.01',
      '0.025',
      '0.05',
      '0.1',
      '0.25',
      '0.3',
      '0.5',
      '1',
      '2.5',
      '5',
      '10',
      '+Inf',
    ]);
  });
});

describe('run metrics', () => {
  const at = (iso: string) => new Date(iso);

  it('counts finished runs and sets the last success on succeeded and partial runs', async () => {
    const registry = createMetricsRegistry(BUILD);
    const m = new RunMetrics(registry);
    m.syncRunFinished('oeapi', 'failed', at('2026-10-15T10:00:00Z'), 'uibk');
    m.syncRunFinished('oeapi', 'partial', at('2026-10-15T11:00:00Z'), 'uibk');
    m.syncRunFinished('csv', 'succeeded', at('2026-10-15T12:00:00Z'), 'urv');
    m.syncRunFinished('csv', 'succeeded', at('2026-10-15T12:30:00Z'));
    expect(await samples(registry, 'oecp_sync_runs_total')).toEqual([
      'oecp_sync_runs_total{channel="oeapi",status="failed"} 1',
      'oecp_sync_runs_total{channel="oeapi",status="partial"} 1',
      'oecp_sync_runs_total{channel="csv",status="succeeded"} 2',
    ]);
    expect(await samples(registry, 'oecp_sync_run_last_success_timestamp_seconds')).toEqual([
      `oecp_sync_run_last_success_timestamp_seconds{organization_slug="uibk",channel="oeapi"} ${Date.parse('2026-10-15T11:00:00Z') / 1000}`,
      `oecp_sync_run_last_success_timestamp_seconds{organization_slug="urv",channel="csv"} ${Date.parse('2026-10-15T12:00:00Z') / 1000}`,
    ]);

    m.maintenanceRunFinished('retention', 'succeeded', at('2026-10-15T04:45:10Z'));
    m.maintenanceRunFinished('retention', 'failed', at('2026-10-16T04:45:10Z'));
    m.maintenanceRunFinished('dormancy', 'skipped', at('2026-10-15T05:00:00Z'));
    expect(await samples(registry, 'oecp_maintenance_runs_total')).toEqual([
      'oecp_maintenance_runs_total{job="retention",status="succeeded"} 1',
      'oecp_maintenance_runs_total{job="retention",status="failed"} 1',
      'oecp_maintenance_runs_total{job="dormancy",status="skipped"} 1',
    ]);
    expect(await samples(registry, 'oecp_maintenance_run_last_success_timestamp_seconds')).toEqual([
      `oecp_maintenance_run_last_success_timestamp_seconds{job="retention"} ${Date.parse('2026-10-15T04:45:10Z') / 1000}`,
    ]);

    expect(await samples(registry, 'oecp_harvest_in_progress')).toEqual([
      'oecp_harvest_in_progress 0',
    ]);
    expect(
      await samples(registry, 'oecp_idp_metadata_refresh_last_success_timestamp_seconds'),
    ).toEqual(['oecp_idp_metadata_refresh_last_success_timestamp_seconds 0']);
  });

  it('apply() replaces the database-derived gauges; the IdP gauge never goes back', async () => {
    const registry = createMetricsRegistry(BUILD);
    const m = new RunMetrics(registry);
    m.syncRunFinished('oeapi', 'succeeded', at('2026-10-01T00:00:00Z'), 'gone');
    m.idpRefreshSucceeded(at('2026-10-15T04:15:00Z'));
    m.apply({
      syncLastSuccess: [
        { organizationSlug: 'uibk', channel: 'oeapi', finishedAt: at('2026-10-15T03:00:00Z') },
      ],
      syncFailureStreaks: [
        { organizationSlug: 'uibk', failures: 0 },
        { organizationSlug: 'urv', failures: 3 },
      ],
      maintenanceLastSuccess: [{ job: 'retention', finishedAt: at('2026-10-15T04:45:00Z') }],
      idpLastSuccess: at('2026-10-14T04:15:00Z'),
    });
    expect(await samples(registry, 'oecp_sync_run_last_success_timestamp_seconds')).toEqual([
      `oecp_sync_run_last_success_timestamp_seconds{organization_slug="uibk",channel="oeapi"} ${Date.parse('2026-10-15T03:00:00Z') / 1000}`,
    ]);
    expect(await samples(registry, 'oecp_sync_runs_consecutive_failures')).toEqual([
      'oecp_sync_runs_consecutive_failures{organization_slug="uibk"} 0',
      'oecp_sync_runs_consecutive_failures{organization_slug="urv"} 3',
    ]);
    expect(
      await samples(registry, 'oecp_idp_metadata_refresh_last_success_timestamp_seconds'),
    ).toEqual([
      `oecp_idp_metadata_refresh_last_success_timestamp_seconds ${Date.parse('2026-10-15T04:15:00Z') / 1000}`,
    ]);
  });
});

describe('RunMetricsService', () => {
  /** Rows of the four snapshot queries, recognised by their SQL. */
  const responder = (query: RecordedQuery): unknown[] | undefined => {
    if (query.sql.includes('row_number()')) return [{ slug: 'uibk', failures: 2 }];
    if (query.sql.includes('FROM sync_runs r')) {
      return [{ slug: 'uibk', channel: 'oeapi', finished_at: new Date('2026-10-10T00:00:00Z') }];
    }
    if (query.sql.includes("details ->> 'status'")) {
      return [{ finished_at: new Date('2026-10-15T04:16:00Z') }];
    }
    if (query.sql.includes('FROM maintenance_runs')) {
      return [{ job: 'dormancy', finished_at: new Date('2026-10-15T05:00:01Z') }];
    }
    if (query.sql.includes('from "organizations"')) return [{ slug: 'uibk' }];
    return undefined;
  };

  it('initialises the gauges from the database at start-up', async () => {
    const registry = createMetricsRegistry(BUILD);
    const fake = createFakeDb(responder);
    const service = new RunMetricsService(
      registry,
      fake.db,
      configStub({ OECP_METRICS_ENABLED: true }),
    );
    await service.onApplicationBootstrap();
    service.onApplicationShutdown();
    expect(await samples(registry, 'oecp_sync_runs_consecutive_failures')).toEqual([
      'oecp_sync_runs_consecutive_failures{organization_slug="uibk"} 2',
    ]);
    expect(await samples(registry, 'oecp_maintenance_run_last_success_timestamp_seconds')).toEqual([
      `oecp_maintenance_run_last_success_timestamp_seconds{job="dormancy"} ${Date.parse('2026-10-15T05:00:01Z') / 1000}`,
    ]);
    expect(
      await samples(registry, 'oecp_idp_metadata_refresh_last_success_timestamp_seconds'),
    ).toEqual([
      `oecp_idp_metadata_refresh_last_success_timestamp_seconds ${Date.parse('2026-10-15T04:16:00Z') / 1000}`,
    ]);

    // A finished run counts, then the gauges are recomputed from the database.
    const before = fake.queries.length;
    await service.syncRunFinished({
      organizationId: '0a000000-0000-4000-8000-000000000002',
      channel: 'oeapi',
      status: 'failed',
      finishedAt: new Date('2026-10-15T12:00:00Z'),
    });
    expect(fake.queries.length).toBe(before + 5);
    expect(await samples(registry, 'oecp_sync_runs_total')).toEqual([
      'oecp_sync_runs_total{channel="oeapi",status="failed"} 1',
    ]);
  });

  it('never fails a run when the database does not answer; does nothing when disabled', async () => {
    const registry = createMetricsRegistry(BUILD);
    const failing = createFakeDb(() => {
      throw new Error('connection refused');
    });
    const service = new RunMetricsService(registry, failing.db, configStub({}));
    await expect(service.refresh()).resolves.toBe(false);
    await expect(
      service.syncRunFinished({
        organizationId: 'x',
        channel: 'csv',
        status: 'succeeded',
        finishedAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    expect(await samples(registry, 'oecp_sync_runs_total')).toEqual([
      'oecp_sync_runs_total{channel="csv",status="succeeded"} 1',
    ]);

    const off = createFakeDb(responder);
    const disabledRegistry = createMetricsRegistry(BUILD);
    const disabled = new RunMetricsService(
      disabledRegistry,
      off.db,
      configStub({ OECP_METRICS_ENABLED: false }),
    );
    await disabled.onApplicationBootstrap();
    disabled.maintenanceRunFinished('retention', 'succeeded');
    disabled.idpRefreshSucceeded();
    expect(off.queries).toEqual([]);
    expect(await samples(disabledRegistry, 'oecp_maintenance_runs_total')).toEqual([]);
  });
});

describe('MaintenanceRunner hook', () => {
  const runnerWith = (locked: boolean) => {
    const fake = createFakeDb((q) => {
      if (q.sql.includes('pg_try_advisory_lock')) return [{ locked }];
      if (q.sql.startsWith('insert into "maintenance_runs"')) return [{ id: 'run-1' }];
      return undefined;
    });
    const registry = createMetricsRegistry(BUILD);
    const metrics = new RunMetricsService(registry, fake.db, configStub({}));
    const runner = new MaintenanceRunner(fake.db, new MaintenanceRunsRepository(fake.db), metrics);
    return { runner, registry };
  };

  it('counts succeeded, failed and skipped runs and sets the last success', async () => {
    const { runner, registry } = runnerWith(true);
    await runner.run('retention', 'schedule', undefined, async () => ({ counters: { a: 1 } }));
    await expect(
      runner.run('dormancy', 'manual', 'sub-1', async () => {
        throw new MaintenanceJobError('partly done', { counters: { revoked: 1 } });
      }),
    ).rejects.toThrow('partly done');
    expect(await samples(registry, 'oecp_maintenance_runs_total')).toEqual([
      'oecp_maintenance_runs_total{job="retention",status="succeeded"} 1',
      'oecp_maintenance_runs_total{job="dormancy",status="failed"} 1',
    ]);
    const last = await samples(registry, 'oecp_maintenance_run_last_success_timestamp_seconds');
    expect(last).toHaveLength(1);
    expect(last[0]).toMatch(
      /^oecp_maintenance_run_last_success_timestamp_seconds\{job="retention"\} \d/,
    );

    const skipped = runnerWith(false);
    await skipped.runner.run('retention', 'schedule', undefined, async () => ({ counters: {} }));
    expect(await samples(skipped.registry, 'oecp_maintenance_runs_total')).toEqual([
      'oecp_maintenance_runs_total{job="retention",status="skipped"} 1',
    ]);
  });
});
