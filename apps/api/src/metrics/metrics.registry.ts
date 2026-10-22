// SPDX-License-Identifier: EUPL-1.2
import { collectDefaultMetrics, Gauge, Registry } from '@prometheus-io/client';

/** Prefix of every OACC metric, the process and Node.js defaults included. */
export const METRICS_PREFIX = 'oecp_';

/** Nest token of the process's {@link Registry} (api or worker). */
export const METRICS_REGISTRY = Symbol('METRICS_REGISTRY');

/** Paths never counted in the request metrics (scrapes and probes). */
export const UNMEASURED_PATHS: ReadonlySet<string> = new Set(['/metrics', '/health', '/ready']);

export interface BuildInfo {
  version: string;
  commit: string;
}

/**
 * Registry of one process: `collectDefaultMetrics` with the `oecp_` prefix
 * (process CPU, memory, file descriptors, event loop lag, GC, Node.js version)
 * and `oecp_build_info{version,commit}` = 1. The process-specific families are
 * registered on it by HttpMetrics (api) and RunMetrics (worker).
 */
export function createMetricsRegistry(build: BuildInfo): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: METRICS_PREFIX });
  const info = new Gauge({
    name: 'oecp_build_info',
    help: 'OACC build: version of the repository package.json and the Git commit (value 1).',
    labelNames: ['version', 'commit'] as const,
    registers: [registry],
  });
  info.set({ version: build.version, commit: build.commit }, 1);
  return registry;
}

/** What `GET /metrics` answers: the Prometheus text exposition format. */
export async function renderMetrics(
  registry: Registry,
): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}
