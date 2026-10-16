// SPDX-License-Identifier: EUPL-1.2
import { Module } from '@nestjs/common';
import { buildOpenApiDocuments, rootPackageVersion, serializeOpenApiDocument } from './document.js';
import { ApiDocsController } from './docs.controller.js';
import { buildApiDocs } from './docs.js';
import { OpenApiController } from './openapi.controller.js';
import { API_DOCS, OPENAPI_JSON, type OpenApiJson } from './openapi.tokens.js';

/**
 * `GET /api/{public,admin}/v1/openapi.json` (documents built once at start-up)
 * and the self-hosted viewer `GET /api/{public,admin}/v1/docs` with its bundle
 * under `/api/docs-assets/` (read and checked once at start-up).
 */
@Module({
  controllers: [OpenApiController, ApiDocsController],
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
    { provide: API_DOCS, useFactory: () => buildApiDocs() },
  ],
})
export class OpenApiModule {}
