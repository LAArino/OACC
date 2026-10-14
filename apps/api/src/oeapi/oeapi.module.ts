// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { READ_API_CLOCK, systemClock } from '../catalogue/clock.js';
import {
  OeapiAcademicSessionsController,
  OeapiCoursesController,
  OeapiOfferingsController,
  OeapiOrganizationsController,
  OeapiServiceController,
} from './oeapi.controllers.js';
import { OeapiRepository } from './oeapi.repository.js';
import { OeapiService } from './oeapi.service.js';

@Module({
  controllers: [
    OeapiServiceController,
    OeapiOrganizationsController,
    OeapiAcademicSessionsController,
    OeapiCoursesController,
    OeapiOfferingsController,
  ],
  providers: [OeapiRepository, OeapiService, { provide: READ_API_CLOCK, useValue: systemClock }],
})
export class OeapiModule {}
