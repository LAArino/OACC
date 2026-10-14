// SPDX-License-Identifier: EUPL-1.2
/**
 * Ajv validation of `/oeapi/v5` responses against the vendored OEAPI v5.0
 * OpenAPI document (tools/oeapi-mock/spec/oeapi-v5.0.bundled.json, read-only),
 * as tools/oeapi-mock/scripts/validate.mjs does for the mock.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Ajv as AjvInstance, ErrorObject } from 'ajv';

// ajv and ajv-formats are CommonJS; require() sidesteps default-export interop.
const require = createRequire(import.meta.url);
const Ajv = (require('ajv') as { default: typeof AjvInstance }).default;
const addFormats = (require('ajv-formats') as { default: (ajv: AjvInstance) => AjvInstance })
  .default;

const SPEC_FILE = fileURLToPath(
  new URL('../../../../tools/oeapi-mock/spec/oeapi-v5.0.bundled.json', import.meta.url),
);

/** OpenAPI 3.0 Schema Objects → JSON Schema: translate `nullable`, keep the rest. */
function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = k === 'example' || k === 'examples' ? v : toJsonSchema(v);
  }
  if (out['nullable'] === true && out['type']) out['type'] = [out['type'], 'null'].flat();
  delete out['nullable'];
  return out;
}

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
for (const f of ['int32', 'int64', 'double', 'float', 'url']) ajv.addFormat(f, true);
ajv.addSchema(toJsonSchema(JSON.parse(readFileSync(SPEC_FILE, 'utf8'))) as object, 'oeapi');

const ptr = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

function check(ref: string, body: unknown): string[] {
  const validate = ajv.getSchema(ref);
  if (!validate) throw new Error(`No schema at ${ref}`);
  if (validate(body)) return [];
  return (validate.errors ?? []).map(
    (e: ErrorObject) => `${e.instancePath || '/'} ${e.message ?? ''} ${JSON.stringify(e.params)}`,
  );
}

/** Errors of `body` against the `200` (or other) response schema of `GET path`. */
export function responseErrors(
  path: string,
  body: unknown,
  status = '200',
  type = 'application/json',
): string[] {
  return check(
    `oeapi#/paths/${ptr(path)}/get/responses/${status}/content/${ptr(type)}/schema`,
    body,
  );
}

/** Errors of `body` against `#/components/schemas/{name}`. */
export function schemaErrors(name: string, body: unknown): string[] {
  return check(`oeapi#/components/schemas/${name}`, body);
}
