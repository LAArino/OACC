// SPDX-License-Identifier: EUPL-1.2
/**
 * The CSV JSON Schema served at `GET /api/admin/v1/csv-template/schema.json`
 * (`@oecp/schemas/json/csv/oecp-csv-1.3.schema.json`, spec §6.3): single-value
 * cells reference the canonical definitions and the document is self-contained
 * (the canonical schema is embedded as a 2020-12 bundled resource).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Ajv as AjvInstance } from 'ajv';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const Ajv2020 = (require('ajv/dist/2020') as { default: typeof AjvInstance }).default;
const addFormats = (require('ajv-formats') as { default: (ajv: AjvInstance) => AjvInstance })
  .default;

type Json = Record<string, unknown>;
const load = (file: string) =>
  JSON.parse(readFileSync(require.resolve(`@oecp/schemas/json/${file}`), 'utf8')) as Json;
const csv = load('csv/oecp-csv-1.3.schema.json');
const canonical = load('canonical/oecp-canonical-1.schema.json');
const CANONICAL_ID = 'urn:oecp:schema:canonical:1';

function refs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => refs(n, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') out.push(value);
      else refs(value, out);
    }
  }
  return out;
}

describe('CSV JSON Schema 1.3', () => {
  // Strict mode, no network: every $ref must resolve inside the document. `title_en`
  // is both a fixed property and a language column by pattern (allowed).
  const ajv = new Ajv2020({ strict: true, allowMatchingProperties: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(csv);
  const course = ajv.getSchema('urn:oecp:schema:csv:1.3#/$defs/courseRow')!;
  const offering = ajv.getSchema('urn:oecp:schema:csv:1.3#/$defs/offeringRow')!;

  it('embeds the canonical schema unchanged and references it', () => {
    const defs = csv['$defs'] as Record<string, Json>;
    const { $schema: _dialect, ...embedded } = canonical;
    expect(defs['oecp-canonical-1']).toEqual(embedded);
    const rowRefs = refs([defs['courseRow'], defs['offeringRow']]);
    expect(new Set(rowRefs)).toEqual(
      new Set(
        ['lifecycleStatus', 'courseKind', 'courseLevel', 'isoDate'].map(
          (name) => `${CANONICAL_ID}#/$defs/${name}`,
        ),
      ),
    );
    const canonicalDefs = canonical['$defs'] as Json;
    for (const ref of rowRefs) expect(canonicalDefs).toHaveProperty(ref.split('/').at(-1)!);
  });

  const courseRow = {
    template_version: '1.3',
    course_code: 'C-1',
    status: 'published',
    ects: '6',
    isced_codes: '0613',
    title_en: 'Data science',
  };
  const offeringRow = {
    template_version: '1.3',
    course_code: 'C-1',
    offering_code: 'C-1-2027',
    status: 'draft',
    start_date: '2027-02-01',
    end_date: '2027-06-30',
    teaching_languages: 'en|ca',
    delivery_modes: 'online',
  };

  it('validates single-value cells through the canonical definitions', () => {
    expect(course(courseRow)).toBe(true);
    expect(course({ ...courseRow, kind: '', level: '' })).toBe(true);
    expect(course({ ...courseRow, kind: 'bip', level: 'master' })).toBe(true);
    expect(course({ ...courseRow, status: 'archived' })).toBe(false);
    expect(course({ ...courseRow, kind: 'seminar' })).toBe(false);
    expect(course({ ...courseRow, level: 'phd' })).toBe(false);

    expect(offering(offeringRow)).toBe(true);
    expect(offering({ ...offeringRow, application_deadline: '' })).toBe(true);
    expect(offering({ ...offeringRow, application_deadline: '2027-01-15' })).toBe(true);
    expect(offering({ ...offeringRow, start_date: '2027-02-30' })).toBe(false);
    expect(offering({ ...offeringRow, enrol_start_date: '15/01/2027' })).toBe(false);
    expect(offering({ ...offeringRow, status: '' })).toBe(false);
  });
});
