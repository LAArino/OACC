// SPDX-License-Identifier: EUPL-1.2
import { Controller, Get, Header, Inject } from '@nestjs/common';
import { OPENAPI_CACHE } from './document.js';
import { OPENAPI_JSON, type OpenApiJson } from './openapi.tokens.js';

const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * The OpenAPI 3.1 documents of the public and admin APIs, built once at start-up
 * and served as pre-serialized JSON (Express adds a weak `ETag`).
 *
 * Both routes are anonymous, the admin one included: the document describes the
 * admin API, it is not secret and grants nothing (every admin operation still
 * needs a bearer token). Keep this controller free of `AdminJwtGuard`.
 */
@Controller()
export class OpenApiController {
  constructor(@Inject(OPENAPI_JSON) private readonly documents: OpenApiJson) {}

  @Get('api/public/v1/openapi.json')
  @Header('Content-Type', JSON_TYPE)
  @Header('Cache-Control', OPENAPI_CACHE)
  publicDocument(): string {
    return this.documents.public;
  }

  @Get('api/admin/v1/openapi.json')
  @Header('Content-Type', JSON_TYPE)
  @Header('Cache-Control', OPENAPI_CACHE)
  adminDocument(): string {
    return this.documents.admin;
  }
}
