// SPDX-License-Identifier: EUPL-1.2
// Decision 27: the harvester never writes the image columns of a course (OEAPI v5
// has no course image); an image set by the form or CSV survives every harvest.
import { readFileSync } from 'node:fs';
import type { Course } from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import { CanonicalWriter, HARVESTER_ACTOR } from '../../src/ingestion/canonical-writer.service.js';
import { jcsSha256 } from '../../src/ingestion/jcs.js';
import type { WriteContext } from '../../src/ingestion/ports/canonical-writer.js';
import { createFakeDb, type RecordedQuery } from '../support/fake-kysely.js';

const COURSE_ID = '0c000000-0000-4000-8000-0000000000aa';
const ORG_ID = '0a000000-0000-4000-8000-0000000000bb';

const harvested: Course = {
  ext_id: 'H-1',
  source_ref: 'h-1',
  status: 'published',
  kind: 'course',
  ects: 5,
  level: 'master',
  levels: ['master'],
  eqf_level: 7,
  teaching_hours: null,
  teaching_unit_ext_id: null,
  info_url: null,
  contact_email: 'h1@uibk.example',
  isced_codes: ['0613'],
  instructors: ['Course team, University of Innsbruck'],
  attributes: {},
  texts: {
    en: {
      title: 'Hydrology',
      abstract: null,
      description: 'Water.',
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      mode_of_repetition: null,
      methods: null,
      literature: null,
      privacy_notice: null,
      remarks: null,
      keywords: [],
      is_machine_translated: false,
    },
  },
};

const ctx: WriteContext = {
  syncRunId: '0d000000-0000-4000-8000-0000000000cc',
  organizationId: ORG_ID,
  channel: 'oeapi',
  schemaVersion: 'oeapi-5.0',
  actor: HARVESTER_ACTOR,
  now: new Date('2026-10-16T08:00:00Z'),
};

/** A course that has an image (set by the form) and was harvested before. */
function existing(contentHash: Buffer, deleted = false) {
  return {
    id: COURSE_ID,
    status: 'published',
    content_hash: contentHash,
    overrides: {},
    absent_count: 0,
    deleted_at: deleted ? new Date('2026-01-01T00:00:00Z') : null,
    image_key: '0123456789abcdef',
    image_alt: { en: 'Students in a lab' },
  };
}

async function harvest(contentHash: Buffer, deleted = false): Promise<RecordedQuery[]> {
  const fake = createFakeDb((q) => {
    if (/^select .* from "courses"/.test(q.sql)) return [existing(contentHash, deleted)];
    if (/^insert into "courses"/.test(q.sql)) return [{ id: COURSE_ID }];
    return [];
  });
  const writer = new CanonicalWriter(fake.db, 'warn');
  const result = await writer.upsertCourse(ctx, harvested, { courseId: 'h-1' });
  expect(result.entityId).toBe(COURSE_ID);
  return fake.queries;
}

const courseWrites = (queries: RecordedQuery[]) =>
  queries.filter((q) => /^(update|insert into) "courses"/.test(q.sql));

describe('harvest and course images', () => {
  it('a changed course is rewritten without touching the image columns', async () => {
    const queries = await harvest(Buffer.alloc(32));
    const writes = courseWrites(queries);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write.sql).not.toMatch(/image_/);
  });

  it('an unchanged course only gets last_seen_at and absent_count', async () => {
    const queries = await harvest(jcsSha256(harvested));
    const writes = courseWrites(queries);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toMatch(
      /^update "courses" set "last_seen_at" = \$1, "absent_count" = \$2/,
    );
    expect(writes[0]!.sql).not.toMatch(/image_/);
  });

  it('a course revived by the harvest keeps its image columns', async () => {
    const queries = await harvest(Buffer.alloc(32), true);
    for (const write of courseWrites(queries)) expect(write.sql).not.toMatch(/image_/);
  });

  it('neither the writer nor the OEAPI adapter know the image columns', () => {
    for (const file of [
      '../../src/ingestion/canonical-writer.service.ts',
      '../../src/ingestion/oeapi/oeapi-v5.adapter.ts',
      '../../src/ingestion/harvest.service.ts',
    ]) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).not.toMatch(/image/i);
    }
  });
});
