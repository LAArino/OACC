// SPDX-License-Identifier: EUPL-1.2
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkerHealthServer,
  type RepeatableJob,
} from '../../src/maintenance/worker-health.server.js';
import { createMetricsRegistry, renderMetrics } from '../../src/metrics/metrics.registry.js';
import { RunMetrics } from '../../src/metrics/run-metrics.js';

const JOB: RepeatableJob = {
  queue: 'maintenance',
  id: 'maintenance-retention-daily',
  job: 'retention',
  pattern: '45 4 * * *',
  every_ms: null,
  tz: 'UTC',
  next: '2026-10-15T04:45:00.000Z',
};

describe('worker health endpoints', () => {
  let server: Server;
  let base: string;
  const state = { database: true, valkey: true, valkeyHangs: false, jobsFail: false };
  const never = new Promise<never>(() => undefined);

  beforeAll(async () => {
    server = createWorkerHealthServer(
      {
        database: async () => {
          if (!state.database) throw new Error('connection refused');
        },
        valkey: () => {
          if (state.valkeyHangs) return never;
          return state.valkey ? Promise.resolve('PONG') : Promise.reject(new Error('down'));
        },
        jobs: async () => {
          if (state.jobsFail) throw new Error('valkey down');
          return [JOB];
        },
      },
      200,
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /health returns ok with the registered repeatable jobs', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', jobs: [JOB] });
  });

  it('GET /health stays 200 with the last known jobs while Valkey does not answer', async () => {
    state.jobsFail = true;
    try {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', jobs: [JOB] });
    } finally {
      state.jobsFail = false;
    }
  });

  it('GET /ready is 200 only when PostgreSQL and Valkey answer', async () => {
    let response = await fetch(`${base}/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      checks: { database: 'up', valkey: 'up' },
    });

    state.database = false;
    response = await fetch(`${base}/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'unavailable',
      checks: { database: 'down', valkey: 'up' },
    });
    state.database = true;

    state.valkeyHangs = true;
    response = await fetch(`${base}/ready`);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { checks: object }).checks).toEqual({
      database: 'up',
      valkey: 'down',
    });
    state.valkeyHangs = false;
  });

  it('answers 404 for other paths (/metrics without metrics) and 405 for other methods', async () => {
    expect((await fetch(`${base}/metrics`)).status).toBe(404);
    const post = await fetch(`${base}/health`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    expect((await fetch(`${base}/ready?verbose=1`, { method: 'HEAD' })).status).toBe(200);
  });
});

describe('worker GET /metrics', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const registry = createMetricsRegistry({ version: '0.4.0', commit: 'unknown' });
    new RunMetrics(registry).syncRunFinished('oeapi', 'succeeded', new Date(0), 'uibk');
    server = createWorkerHealthServer({
      database: async () => undefined,
      valkey: async () => 'PONG',
      jobs: async () => [],
      metrics: () => renderMetrics(registry),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves the worker registry in the Prometheus text format, never cached', async () => {
    const response = await fetch(`${base}/metrics?x=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toContain('oecp_build_info{version="0.4.0",commit="unknown"} 1');
    expect(text).toContain('oecp_sync_runs_total{channel="oeapi",status="succeeded"} 1');
    expect(text).toContain('# TYPE oecp_harvest_in_progress gauge');
    expect(text).toContain('# TYPE oecp_process_cpu_seconds_total counter');

    const head = await fetch(`${base}/metrics`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(405);
  });
});
