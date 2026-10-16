// SPDX-License-Identifier: EUPL-1.2
// Writes JSON Schema 2020-12 documents and errors.json from the compiled Zod schemas.
// Run after `tsc` (see the `build` script); outputs are committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import * as s from '../dist/index.js';

const root = join(import.meta.dirname, '..');
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

function def(schema) {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  });
  return rest;
}

function write(relative, value) {
  const file = join(root, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  console.log(`wrote ${relative}`);
}

write('json/canonical/oecp-canonical-1.schema.json', {
  $schema: DRAFT,
  $id: 'urn:oecp:schema:canonical:1',
  title: 'OECP canonical model 1',
  $defs: {
    organization: def(s.organization),
    deliveryMode: def(s.deliveryMode),
    academicSession: def(s.academicSession),
    course: def(s.course),
    courseText: def(s.courseText),
    courseOffering: def(s.courseOffering),
    attributeDefinition: def(s.attributeDefinition),
    courseAttributes: def(s.courseAttributes),
    languageTag: def(s.languageTag),
    iscedCode: def(s.iscedCode),
  },
});

// json/csv/oecp-csv-1.0.schema.json, 1.1 and 1.2 are frozen (templates 1.0, 1.1 and
// 1.2); 1.3 accepts 1.0, 1.1 and 1.2 files too.
write('json/csv/oecp-csv-1.3.schema.json', {
  $schema: DRAFT,
  $id: 'urn:oecp:schema:csv:1.3',
  title: 'OECP CSV template 1.3 (accepts 1.0, 1.1 and 1.2)',
  $defs: {
    courseRow: def(s.csvCourseRow),
    offeringRow: def(s.csvOfferingRow),
  },
});

write('json/problem.schema.json', {
  $schema: DRAFT,
  $id: 'urn:oecp:schema:problem:1',
  title: 'RFC 9457 problem details (OECP)',
  ...def(s.problemDetails),
});

write('errors.json', s.ERROR_CODES);
