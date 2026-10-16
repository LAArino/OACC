// SPDX-License-Identifier: EUPL-1.2
import { Controller, Get, Header, Inject, Param, Res } from '@nestjs/common';
import { ProblemException } from '../common/problem.js';
import { OPENAPI_CACHE } from './document.js';
import { type ApiDocs, DOCS_ASSET_CACHE } from './docs.js';
import { API_DOCS } from './openapi.tokens.js';

const HTML_TYPE = 'text/html; charset=utf-8';

/** The part of the Express response the asset handler uses. */
interface AssetResponse {
  setHeader(name: string, value: string): unknown;
  send(body: Buffer): unknown;
}

/**
 * Self-hosted OpenAPI viewer (Redoc, vendored in `static/openapi/`):
 * `GET /api/{public,admin}/v1/docs` (HTML page, cacheable for an hour like the
 * documents) and `GET /api/docs-assets/{version}/{file}` (the bundle, immutable;
 * any other name answers 404, there is no listing). Anonymous like the
 * `openapi.json` routes: keep this controller free of `AdminJwtGuard`. Traefik
 * routes these paths with their own CSP (`security-headers-api-docs`), which
 * allows scripts and styles from the portal origin only.
 */
@Controller()
export class ApiDocsController {
  constructor(@Inject(API_DOCS) private readonly docs: ApiDocs) {}

  @Get('api/public/v1/docs')
  @Header('Content-Type', HTML_TYPE)
  @Header('Cache-Control', OPENAPI_CACHE)
  publicDocs(): string {
    return this.docs.pages.public;
  }

  @Get('api/admin/v1/docs')
  @Header('Content-Type', HTML_TYPE)
  @Header('Cache-Control', OPENAPI_CACHE)
  adminDocs(): string {
    return this.docs.pages.admin;
  }

  /** Express answers `HEAD` and `If-None-Match` (304) from the headers set here. */
  @Get('api/docs-assets/:version/:file')
  asset(
    @Param('version') version: string,
    @Param('file') file: string,
    @Res() response: AssetResponse,
  ): void {
    const asset = this.docs.assets.get(`${version}/${file}`);
    if (!asset) throw new ProblemException(404, 'oecp.request.not_found', 'Asset not found');
    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Cache-Control', DOCS_ASSET_CACHE);
    response.setHeader('ETag', asset.etag);
    response.send(asset.body);
  }
}
