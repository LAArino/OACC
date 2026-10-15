// SPDX-License-Identifier: EUPL-1.2
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService } from '@nestjs/core';
import { Queue } from 'bullmq';
import { sql } from 'kysely';
import type { Registry } from '@prometheus-io/client';
import type { Env } from '../config/env.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { METRICS_REGISTRY, renderMetrics } from '../metrics/metrics.registry.js';
import { MAINTENANCE_QUEUE } from './maintenance.constants.js';

/** A repeatable job (BullMQ job scheduler) registered in Valkey. */
export interface RepeatableJob {
  queue: string;
  /** Scheduler id, e.g. `maintenance-retention-daily`, `harvest-schedule-<orgId>`. */
  id: string;
  job: string;
  pattern: string | null;
  every_ms: number | null;
  tz: string | null;
  next: string | null;
}

export interface WorkerHealthProbes {
  database(): Promise<unknown>;
  valkey(): Promise<unknown>;
  jobs(): Promise<RepeatableJob[]>;
  /** Prometheus exposition of `GET /metrics`; absent: `/metrics` is 404 (metrics disabled). */
  metrics?: () => Promise<{ contentType: string; body: string }>;
}

type Check = 'up' | 'down';

export const PROBE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probe(fn: () => Promise<unknown>, ms: number): Promise<Check> {
  try {
    await withTimeout(fn(), ms);
    return 'up';
  } catch {
    return 'down';
  }
}

/**
 * The worker's internal HTTP endpoints (no Traefik route; Compose healthcheck):
 *
 * - `GET /health` → 200 `{status: "ok", jobs: [...]}`: liveness, with the
 *   repeatable jobs registered in Valkey (the last list read if Valkey does not
 *   answer within the probe timeout, so liveness never depends on it);
 * - `GET /ready` → 200 `{status: "ready", checks}` once PostgreSQL and Valkey
 *   answer, else 503 `{status: "unavailable", checks}`;
 * - `GET /metrics` → 200, Prometheus text format (when `probes.metrics` is set).
 *
 * Anything else is 404 (405 for other methods). Responses are JSON, never cached.
 */
export function createWorkerHealthServer(
  probes: WorkerHealthProbes,
  timeoutMs = PROBE_TIMEOUT_MS,
): Server {
  let lastJobs: RepeatableJob[] = [];
  const send = (res: ServerResponse, status: number, body: unknown, head: boolean) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(head ? undefined : payload);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    const head = req.method === 'HEAD';
    const metrics = probes.metrics;
    if (path !== '/health' && path !== '/ready' && !(path === '/metrics' && metrics)) {
      send(res, 404, { status: 'not_found' }, head);
      return;
    }
    if (req.method !== 'GET' && !head) {
      res.setHeader('allow', 'GET, HEAD');
      send(res, 405, { status: 'method_not_allowed' }, head);
      return;
    }
    if (path === '/metrics' && metrics) {
      const { contentType, body } = await metrics();
      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      });
      res.end(head ? undefined : body);
      return;
    }
    if (path === '/health') {
      try {
        lastJobs = await withTimeout(probes.jobs(), timeoutMs);
      } catch {
        // Keep the last list: liveness does not depend on Valkey.
      }
      send(res, 200, { status: 'ok', jobs: lastJobs }, head);
      return;
    }
    const [database, valkey] = await Promise.all([
      probe(() => probes.database(), timeoutMs),
      probe(() => probes.valkey(), timeoutMs),
    ]);
    const ready = database === 'up' && valkey === 'up';
    send(
      res,
      ready ? 200 : 503,
      { status: ready ? 'ready' : 'unavailable', checks: { database, valkey } },
      head,
    );
  };

  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { status: 'error' }, false);
      else res.end();
    });
  });
}

/**
 * Starts {@link createWorkerHealthServer} on `WORKER_HEALTH_PORT` (default 3001)
 * in the worker process. The repeatable jobs are read from every BullMQ queue
 * registered in the worker (found through Nest's discovery service); `/metrics`
 * serves the worker's metrics registry unless `OECP_METRICS_ENABLED=false`.
 */
@Injectable()
export class WorkerHealthServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerHealthServer.name);
  private server: Server | undefined;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(KYSELY) private readonly db: Db,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly discovery: DiscoveryService,
    @Optional() @Inject(METRICS_REGISTRY) private readonly registry?: Registry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const port = this.config.get('WORKER_HEALTH_PORT', { infer: true });
    const registry = this.registry;
    const metricsEnabled = this.config.get('OECP_METRICS_ENABLED', { infer: true }) !== false;
    const server = createWorkerHealthServer({
      database: () => sql`SELECT 1`.execute(this.db),
      valkey: async () => (await this.queue.getBackend().client).runCommand('ping', []),
      jobs: () => this.repeatableJobs(),
      ...(registry && metricsEnabled ? { metrics: () => renderMetrics(registry) } : {}),
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.unref();
    this.server = server;
    this.logger.log(`Worker health endpoints on port ${(server.address() as AddressInfo).port}`);
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private queues(): Queue[] {
    const byName = new Map<string, Queue>();
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (instance instanceof Queue && !byName.has(instance.name)) {
        byName.set(instance.name, instance);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async repeatableJobs(): Promise<RepeatableJob[]> {
    const jobs: RepeatableJob[] = [];
    for (const queue of this.queues()) {
      for (const s of await queue.getJobSchedulers(0, -1, true)) {
        jobs.push({
          queue: queue.name,
          id: s.key,
          job: s.name,
          pattern: s.pattern ?? null,
          every_ms: s.every ?? null,
          tz: s.tz ?? null,
          next: typeof s.next === 'number' ? new Date(s.next).toISOString() : null,
        });
      }
    }
    return jobs;
  }
}
