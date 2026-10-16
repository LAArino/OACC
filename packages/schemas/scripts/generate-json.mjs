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

const canonical = {
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
    // Single values shared with the CSV template (referenced by oecp-csv-1.3).
    lifecycleStatus: def(s.lifecycleStatus),
    courseKind: def(s.courseKind),
    courseLevel: def(s.courseLevel),
    isoDate: def(s.isoDate),
    deliveryModeCode: def(s.deliveryModeCode),
  },
};
write('json/canonical/oecp-canonical-1.schema.json', canonical);

// CSV cells that hold exactly one canonical value reference the canonical
// definition instead of repeating its pattern. Multi-value cells (`|`-separated:
// isced_codes, levels, teaching_languages, delivery_modes) cannot be split by
// JSON Schema and keep their patterns, built from the same primitives.
const CANONICAL_REF = (name) => `${canonical.$id}#/$defs/${name}`;
const CSV_CANONICAL_CELLS = {
  courseRow: { status: 'lifecycleStatus', kind: 'courseKind', level: 'courseLevel' },
  offeringRow: {
    status: 'lifecycleStatus',
    start_date: 'isoDate',
    end_date: 'isoDate',
    enrol_start_date: 'isoDate',
    application_deadline: 'isoDate',
  },
};

/** Replaces a cell's `pattern` by a `$ref` (or "empty or `$ref`" for optional cells). */
function referenceCanonical(row, cells, required) {
  for (const [column, name] of Object.entries(cells)) {
    const { pattern: _pattern, ...cell } = row.properties[column];
    row.properties[column] = required.includes(column)
      ? { ...cell, $ref: CANONICAL_REF(name) }
      : { ...cell, anyOf: [{ const: '' }, { $ref: CANONICAL_REF(name) }] };
  }
  return row;
}

function csvRow(key, schema) {
  const row = def(schema);
  return referenceCanonical(row, CSV_CANONICAL_CELLS[key], row.required ?? []);
}

// json/csv/oecp-csv-1.0.schema.json, 1.1 and 1.2 are frozen (templates 1.0, 1.1 and
// 1.2); 1.3 accepts 1.0, 1.1 and 1.2 files too. The canonical schema is embedded
// (JSON Schema 2020-12 bundling: an embedded resource with its own `$id`), so the
// document is self-contained: `$ref`s to `urn:oecp:schema:canonical:1#/$defs/…`
// resolve without fetching anything (the API serves this file as is).
const { $schema: _canonicalDialect, ...embeddedCanonical } = canonical;
write('json/csv/oecp-csv-1.3.schema.json', {
  $schema: DRAFT,
  $id: 'urn:oecp:schema:csv:1.3',
  title: 'OECP CSV template 1.3 (accepts 1.0, 1.1 and 1.2)',
  $defs: {
    courseRow: csvRow('courseRow', s.csvCourseRow),
    offeringRow: csvRow('offeringRow', s.csvOfferingRow),
    'oecp-canonical-1': embeddedCanonical,
  },
});

write('json/problem.schema.json', {
  $schema: DRAFT,
  $id: 'urn:oecp:schema:problem:1',
  title: 'RFC 9457 problem details (OECP)',
  ...def(s.problemDetails),
});

write('errors.json', s.ERROR_CODES);
