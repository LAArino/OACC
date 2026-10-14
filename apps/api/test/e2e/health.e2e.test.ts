// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { HealthController } from '../../src/health/health.controller.js';
import { type ReadinessReport, ReadinessService } from '../../src/health/readiness.service.js';

describe('health endpoints', () => {
  let app: INestApplication;
  let report: ReadinessReport;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: ReadinessService, useValue: { check: async () => report } },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok without cookies', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('GET /ready returns 503 problem+json when a dependency is down', async () => {
    report = { ready: false, checks: { database: 'up', valkey: 'down' } };
    const response = await request(app.getHttpServer()).get('/ready').expect(503);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body).toMatchObject({ status: 503, title: 'Not ready', instance: '/ready' });
  });

  it('GET /ready returns 200 when dependencies are up', async () => {
    report = { ready: true, checks: { database: 'up', valkey: 'up' } };
    await request(app.getHttpServer()).get('/ready').expect(200, report);
  });
});
