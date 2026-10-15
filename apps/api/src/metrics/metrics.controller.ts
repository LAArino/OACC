// SPDX-License-Identifier: EUPL-1.2
import type { ServerResponse } from 'node:http';
import { Controller, Get, Inject, NotFoundException, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Registry } from '@prometheus-io/client';
import type { Env } from '../config/env.js';
import { METRICS_REGISTRY, renderMetrics } from './metrics.registry.js';

/**
 * `GET /metrics` of the api: Prometheus text format, no authentication. Meant
 * for the internal network only: Traefik routes `/api` and `/oeapi` to the api
 * and everything else on the portal host to `web`, so `/metrics` of the api is
 * not reachable from outside (spec §10). 404 with `OECP_METRICS_ENABLED=false`.
 */
@Controller()
export class MetricsController {
  private readonly enabled: boolean;

  constructor(
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('OECP_METRICS_ENABLED', { infer: true }) !== false;
  }

  @Get('metrics')
  async metrics(@Res() res: ServerResponse): Promise<void> {
    if (!this.enabled) throw new NotFoundException();
    const { contentType, body } = await renderMetrics(this.registry);
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}
