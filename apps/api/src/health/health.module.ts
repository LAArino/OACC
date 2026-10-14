// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { HealthController } from './health.controller.js';
import { ReadinessService } from './readiness.service.js';

@Module({
  imports: [IngestionModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class HealthModule {}
