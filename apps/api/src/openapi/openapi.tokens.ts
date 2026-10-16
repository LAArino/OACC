// SPDX-License-Identifier: EUPL-1.2

/** Provider token of the serialized OpenAPI documents. */
export const OPENAPI_JSON = Symbol('OPENAPI_JSON');

/** The documents as served (JSON text). */
export interface OpenApiJson {
  public: string;
  admin: string;
}

/** Provider token of the viewer pages and the vendored bundle. */
export const API_DOCS = Symbol('API_DOCS');
