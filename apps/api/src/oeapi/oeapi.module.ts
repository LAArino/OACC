// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import {
  OeapiAcademicSessionsController,
  OeapiCoursesController,
  OeapiOfferingsController,
  OeapiOrganizationsController,
  OeapiServiceController,
} from './oeapi.controllers.js';

@Module({
  controllers: [
    OeapiServiceController,
    OeapiOrganizationsController,
    OeapiAcademicSessionsController,
    OeapiCoursesController,
    OeapiOfferingsController,
  ],
})
export class OeapiModule {}
