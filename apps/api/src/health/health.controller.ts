// SPDX-License-Identifier: EUPL-1.2
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ReadinessService, type ReadinessReport } from './readiness.service.js';

@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  /** Liveness: the process is up; never touches dependencies. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: PostgreSQL and Valkey are reachable. */
  @Get('ready')
  async ready(): Promise<ReadinessReport> {
    const report = await this.readiness.check();
    if (!report.ready) {
      throw new ServiceUnavailableException({
        title: 'Not ready',
        detail: JSON.stringify(report.checks),
      });
    }
    return report;
  }
}
