// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminModule } from './admin/admin.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { AppConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { AppLoggerModule } from './logging/logger.module.js';
import { OeapiModule } from './oeapi/oeapi.module.js';
import { OpenApiModule } from './openapi/openapi.module.js';

/** HTTP process (`api`). */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DbModule,
    IngestionModule,
    HealthModule,
    CatalogueModule,
    OeapiModule,
    AdminModule,
    OpenApiModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
