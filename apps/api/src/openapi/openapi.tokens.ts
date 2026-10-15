// SPDX-License-Identifier: EUPL-1.2

/** Provider token of the serialized OpenAPI documents. */
export const OPENAPI_JSON = Symbol('OPENAPI_JSON');

/** The documents as served (JSON text). */
export interface OpenApiJson {
  public: string;
  admin: string;
}
