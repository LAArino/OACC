// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { buildOpenApiDocuments, rootPackageVersion, serializeOpenApiDocument } from './document.js';
import { OpenApiController } from './openapi.controller.js';
import { OPENAPI_JSON, type OpenApiJson } from './openapi.tokens.js';

/** `GET /api/{public,admin}/v1/openapi.json`; documents built once at start-up. */
@Module({
  controllers: [OpenApiController],
  providers: [
    {
      provide: OPENAPI_JSON,
      useFactory: (): OpenApiJson => {
        const documents = buildOpenApiDocuments(rootPackageVersion());
        return {
          public: serializeOpenApiDocument(documents.public),
          admin: serializeOpenApiDocument(documents.admin),
        };
      },
    },
  ],
})
export class OpenApiModule {}
