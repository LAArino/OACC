// SPDX-License-Identifier: EUPL-1.2
/** Nest application with the anonymous read APIs (catalogue and OEAPI v5) over a test database. */
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Kysely } from 'kysely';
import { CatalogueController } from '../../src/catalogue/catalogue.controller.js';
import { CatalogueRepository } from '../../src/catalogue/catalogue.repository.js';
import { CatalogueService } from '../../src/catalogue/catalogue.service.js';
import { READ_API_CLOCK } from '../../src/catalogue/clock.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import type { Database } from '../../src/db/database.js';
import { KYSELY } from '../../src/db/db.module.js';
import {
  OeapiAcademicSessionsController,
  OeapiCoursesController,
  OeapiOfferingsController,
  OeapiOrganizationsController,
  OeapiServiceController,
} from '../../src/oeapi/oeapi.controllers.js';
import { OeapiRepository } from '../../src/oeapi/oeapi.repository.js';
import { OeapiService } from '../../src/oeapi/oeapi.service.js';
import { configStub } from './config-stub.js';

export const PUBLIC_BASE_URL = 'https://campus.example.org';
export const SMTP_FROM = 'no-reply@campus.example.org';

export async function createReadApiApp(db: Kysely<Database>, now: Date): Promise<INestApplication> {
  Logger.overrideLogger(['error']);
  const moduleRef = await Test.createTestingModule({
    controllers: [
      CatalogueController,
      OeapiServiceController,
      OeapiOrganizationsController,
      OeapiAcademicSessionsController,
      OeapiCoursesController,
      OeapiOfferingsController,
    ],
    providers: [
      CatalogueRepository,
      CatalogueService,
      OeapiRepository,
      OeapiService,
      { provide: KYSELY, useValue: db },
      {
        provide: ConfigService,
        useValue: configStub({ OECP_PUBLIC_BASE_URL: PUBLIC_BASE_URL, SMTP_FROM }),
      },
      { provide: READ_API_CLOCK, useValue: () => now },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}
