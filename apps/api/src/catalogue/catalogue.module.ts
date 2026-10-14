// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueRepository } from './catalogue.repository.js';
import { CatalogueService } from './catalogue.service.js';
import { READ_API_CLOCK, systemClock } from './clock.js';

@Module({
  controllers: [CatalogueController],
  providers: [
    CatalogueRepository,
    CatalogueService,
    { provide: READ_API_CLOCK, useValue: systemClock },
  ],
})
export class CatalogueModule {}
