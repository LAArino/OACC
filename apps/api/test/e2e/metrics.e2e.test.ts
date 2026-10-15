// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import {
  type CanActivate,
  Controller,
  Get,
  Global,
  type INestApplication,
  Module,
  Param,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import type { Env } from '../../src/config/env.js';
import { HealthController } from '../../src/health/health.controller.js';
import { ReadinessService } from '../../src/health/readiness.service.js';
import { MetricsModule } from '../../src/metrics/metrics.module.js';
import { configStub } from '../support/config-stub.js';

class DenyGuard implements CanActivate {
  canActivate(): boolean {
    throw new UnauthorizedException();
  }
}

@Controller('api/test/v1')
class ThingsController {
  @Get('things/:id')
  thing(@Param('id') id: string) {
    return { id };
  }

  @Get('secret')
  @UseGuards(DenyGuard)
  secret() {
    return { secret: true };
  }
}

async function createApp(env: Partial<Env>): Promise<INestApplication> {
  @Global()
  @Module({
    providers: [{ provide: ConfigService, useValue: configStub(env) }],
    exports: [ConfigService],
  })
  class ConfigStubModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigStubModule, MetricsModule.forApi()],
    controllers: [HealthController, ThingsController],
    providers: [
      {
        provide: ReadinessService,
        useValue: {
          check: async () => ({ ready: true, checks: { database: 'up', valkey: 'up' } }),
        },
      },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

/** Value of the sample `line` (metric name with labels) in the exposition, 0 if absent. */
function sample(text: string, line: string): number {
  const found = text.split('\n').find((l) => l.startsWith(`${line} `));
  return found ? Number(found.slice(line.length + 1)) : 0;
}

describe('GET /metrics (api)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ OECP_METRICS_ENABLED: true, OECP_GIT_COMMIT: '4d5da1b' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the Prometheus text format with the api metric families', async () => {
    const response = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(response.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(response.headers['cache-control']).toBe('no-store');
    const families = [...response.text.matchAll(/^# TYPE (\S+) (\S+)$/gm)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    expect(families).toEqual(
      expect.arrayContaining([
        'oecp_http_requests_total counter',
        'oecp_http_request_duration_seconds histogram',
        'oecp_build_info gauge',
        'oecp_process_cpu_seconds_total counter',
        'oecp_nodejs_eventloop_lag_seconds gauge',
      ]),
    );
    expect(families.every((f) => f.startsWith('oecp_'))).toBe(true);
    // Worker families are not exposed by the api.
    expect(response.text).not.toContain('oecp_sync_runs_total');
    expect(response.text).not.toContain('oecp_maintenance_runs_total');
    expect(response.text).toMatch(
      /^oecp_build_info\{version="\d+\.\d+\.\d+[^"]*",commit="4d5da1b"\} 1$/m,
    );
  });

  it('counts a request under its route template, including guard rejections and 404s', async () => {
    const server = app.getHttpServer();
    await request(server).get('/api/test/v1/things/42').expect(200, { id: '42' });
    await request(server).get('/api/test/v1/things/43?x=1').expect(200);
    await request(server).get('/api/test/v1/secret').expect(401);
    await request(server).get('/no/such/path').expect(404);
    await request(server).get('/health').expect(200);
    await request(server).get('/ready').expect(200);

    const text = (await request(server).get('/metrics').expect(200)).text;
    expect(
      sample(
        text,
        'oecp_http_requests_total{method="GET",route="/api/test/v1/things/:id",status="200"}',
      ),
    ).toBe(2);
    expect(
      sample(
        text,
        'oecp_http_requests_total{method="GET",route="/api/test/v1/secret",status="401"}',
      ),
    ).toBe(1);
    expect(
      sample(text, 'oecp_http_requests_total{method="GET",route="unmatched",status="404"}'),
    ).toBe(1);
    expect(
      sample(
        text,
        'oecp_http_request_duration_seconds_count{method="GET",route="/api/test/v1/things/:id"}',
      ),
    ).toBe(2);
    // No raw URLs, and neither probes nor scrapes are measured.
    expect(text).not.toContain('things/42');
    expect(text).not.toMatch(/route="\/(health|ready|metrics)"/);
  });
});

describe('GET /metrics with OECP_METRICS_ENABLED=false', () => {
  it('answers 404 and records nothing', async () => {
    const app = await createApp({ OECP_METRICS_ENABLED: false });
    try {
      await request(app.getHttpServer()).get('/api/test/v1/things/1').expect(200);
      const response = await request(app.getHttpServer()).get('/metrics').expect(404);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    } finally {
      await app.close();
    }
  });
});
