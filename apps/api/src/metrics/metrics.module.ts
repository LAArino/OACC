// SPDX-License-Identifier: EUPL-1.2
import {
  type DynamicModule,
  Global,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { rootPackageVersion } from '../openapi/document.js';
import { HttpMetrics, HttpMetricsMiddleware } from './http-metrics.js';
import { MetricsController } from './metrics.controller.js';
import { type BuildInfo, createMetricsRegistry, METRICS_REGISTRY } from './metrics.registry.js';
import { RunMetricsService } from './run-metrics.service.js';

const registryProvider = {
  provide: METRICS_REGISTRY,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => {
    const build: BuildInfo = {
      version: rootPackageVersion(),
      commit: config.get('OECP_GIT_COMMIT', { infer: true }) ?? 'unknown',
    };
    return createMetricsRegistry(build);
  },
};

/**
 * api process: `GET /metrics` with the default and build metrics and the HTTP
 * request metrics of every route but `/metrics`, `/health` and `/ready`.
 */
@Global()
@Module({})
export class ApiMetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Same wildcard as nestjs-pino: every path, unmatched ones (404) included.
    consumer
      .apply(HttpMetricsMiddleware)
      .forRoutes({ path: '{/*splat}', method: RequestMethod.ALL });
  }
}

/**
 * worker process: the run metrics (sync, maintenance, IdP refresh) with the
 * default and build metrics, served by the worker's internal HTTP server
 * (WorkerHealthServer, `GET /metrics`). Global, so that the hooks can inject
 * RunMetricsService optionally; the api never provides it.
 */
@Global()
@Module({})
export class WorkerMetricsModule {}

export const MetricsModule = {
  forApi(): DynamicModule {
    return {
      module: ApiMetricsModule,
      controllers: [MetricsController],
      providers: [registryProvider, HttpMetrics, HttpMetricsMiddleware],
      exports: [METRICS_REGISTRY, HttpMetrics],
    };
  },
  forWorker(): DynamicModule {
    return {
      module: WorkerMetricsModule,
      providers: [registryProvider, RunMetricsService],
      exports: [METRICS_REGISTRY, RunMetricsService],
    };
  },
};
