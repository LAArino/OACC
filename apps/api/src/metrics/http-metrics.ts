// SPDX-License-Identifier: EUPL-1.2
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram, type Registry } from '@prometheus-io/client';
import type { Env } from '../config/env.js';
import { METRICS_REGISTRY, UNMEASURED_PATHS } from './metrics.registry.js';

/**
 * Seconds. Dense below one second (the catalogue search target is p95 < 300 ms,
 * spec §10, hence 0.3), sparse up to the 10 s of a large inline CSV upload.
 */
export const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 1, 2.5, 5, 10,
] as const;

/** `route` of a request no route matched (404s, body parser errors before routing). */
export const UNMATCHED_ROUTE = 'unmatched';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

type RoutedRequest = IncomingMessage & {
  originalUrl?: string;
  baseUrl?: string;
  route?: { path?: unknown };
};

/**
 * The route template Express matched (`/api/admin/v1/organizations/:id`), never
 * the raw URL, so that the `route` label has one value per Nest handler.
 * Express keeps `req.route` once a route matched, also while an exception
 * filter answers (401 from a guard, 400 from a pipe). Requests no handler
 * matched are `unmatched`: no route, or Nest's catch-all 404 route
 * (`{/*splat}`; no OACC handler has a wildcard path).
 */
export function routeTemplate(req: RoutedRequest): string {
  const path = req.route?.path;
  if (typeof path !== 'string' || path.includes('*')) return UNMATCHED_ROUTE;
  return `${req.baseUrl ?? ''}${path}` || '/';
}

/** HTTP method label; anything unusual is folded into `OTHER`. */
export function methodLabel(method: string | undefined): string {
  const upper = (method ?? '').toUpperCase();
  return METHODS.has(upper) ? upper : 'OTHER';
}

/** `oecp_http_requests_total` and `oecp_http_request_duration_seconds` (api process). */
@Injectable()
export class HttpMetrics {
  readonly requests: Counter<'method' | 'route' | 'status'>;
  readonly duration: Histogram<'method' | 'route'>;

  constructor(@Inject(METRICS_REGISTRY) registry: Registry) {
    this.requests = new Counter({
      name: 'oecp_http_requests_total',
      help: 'HTTP requests answered by the api, by method, route template and status code.',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'oecp_http_request_duration_seconds',
      help: 'Time from receiving an HTTP request to the end of its response, by method and route template.',
      labelNames: ['method', 'route'] as const,
      buckets: [...HTTP_DURATION_BUCKETS],
      registers: [registry],
    });
  }

  observe(method: string, route: string, status: number, seconds: number): void {
    this.requests.inc({ method, route, status: String(status) });
    this.duration.observe({ method, route }, seconds);
  }
}

/**
 * Times every request except `/metrics`, `/health` and `/ready` and records it
 * when the response is finished (responses aborted by the client are not counted).
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  private readonly enabled: boolean;

  constructor(
    private readonly metrics: HttpMetrics,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('OECP_METRICS_ENABLED', { infer: true }) !== false;
  }

  use(req: RoutedRequest, res: ServerResponse, next: () => void): void {
    const path = (req.originalUrl ?? req.url ?? '/').split('?')[0] ?? '/';
    if (!this.enabled || UNMEASURED_PATHS.has(path)) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    res.once('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.observe(methodLabel(req.method), routeTemplate(req), res.statusCode, seconds);
    });
    next();
  }
}
