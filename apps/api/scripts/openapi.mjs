// SPDX-License-Identifier: EUPL-1.2
// Writes the OpenAPI documents of /api/public/v1 and /api/admin/v1 to docs/api/
// from the compiled API (run after `tsc`; see the root scripts openapi:generate
// and openapi:check). With --check, validates them and fails when the committed
// files differ from the generated ones instead of writing.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Validator } from '@seriousme/openapi-schema-validator';
import {
  buildOpenApiDocuments,
  OPENAPI_FILE_NAMES,
  rootPackageVersion,
  serializeOpenApiDocument,
} from '../dist/openapi/document.js';

const check = process.argv.includes('--check');
const outDir = join(import.meta.dirname, '..', '..', '..', 'docs', 'api');
const documents = buildOpenApiDocuments(rootPackageVersion());

let failed = false;
for (const [api, document] of Object.entries(documents)) {
  const file = join(outDir, OPENAPI_FILE_NAMES[api]);
  const relative = `docs/api/${OPENAPI_FILE_NAMES[api]}`;
  const result = await new Validator().validate(document);
  if (!result.valid) {
    console.error(`${relative}: not a valid OpenAPI 3.1 document`);
    console.error(JSON.stringify(result.errors, null, 2));
    failed = true;
    continue;
  }
  const text = serializeOpenApiDocument(document);
  const paths = Object.keys(document.paths).length;
  const operations = Object.values(document.paths).reduce(
    (n, item) => n + Object.keys(item).length,
    0,
  );
  if (check) {
    let committed = '';
    try {
      committed = readFileSync(file, 'utf8');
    } catch {
      // Missing file: reported below.
    }
    if (committed !== text) {
      console.error(`${relative} is out of date: run \`pnpm openapi:generate\` and commit it.`);
      failed = true;
    } else {
      console.log(`${relative} is up to date (${paths} paths, ${operations} operations)`);
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, text);
    console.log(`wrote ${relative} (${paths} paths, ${operations} operations)`);
  }
}
if (failed) process.exit(1);
