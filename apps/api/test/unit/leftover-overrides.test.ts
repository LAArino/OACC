// SPDX-License-Identifier: EUPL-1.2
// Spec §6.5: overrides exist only while the authoritative channel is `oeapi`. A CSV
// (or form) write drops the overrides left from an `oeapi` period, as the form
// does; a harvest keeps them.
import type { Course, CourseOffering, SourceChannel } from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import { CanonicalWriter } from '../../src/ingestion/canonical-writer.service.js';
import { jcsSha256 } from '../../src/ingestion/jcs.js';
import type { WriteContext } from '../../src/ingestion/ports/canonical-writer.js';
import { createFakeDb, insertedValues, type RecordedQuery } from '../support/fake-kysely.js';

const COURSE_ID = '0c000000-0000-4000-8000-0000000000a1';
const OFFERING_ID = '0c000000-0000-4000-8000-0000000000a2';
const ORG_ID = '0a000000-0000-4000-8000-0000000000b1';
const RUN_ID = '0d000000-0000-4000-8000-0000000000c1';
const ENTRY = { by: 'kc-admin', at: '2026-09-01T00:00:00Z' };

const text = {
  title: 'Hydrology',
  abstract: null,
  description: null,
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
};
const course: Course = {
  ext_id: 'C-1',
  source_ref: null,
  status: 'published',
  kind: 'course',
  ects: 5,
  level: 'master',
  levels: ['master'],
  eqf_level: null,
  teaching_hours: null,
  teaching_unit_ext_id: null,
  info_url: null,
  contact_email: null,
  isced_codes: ['0613'],
  instructors: ['Course team'],
  attributes: {},
  texts: { en: text },
};
const offering: CourseOffering = {
  ext_offering_id: 'C-1-2027',
  course_ext_id: 'C-1',
  source_ref: null,
  status: 'published',
  academic_session_ext_id: null,
  start_date: '2027-02-01',
  end_date: '2027-06-30',
  enrol_start_date: null,
  application_deadline: null,
  timezone: 'Europe/Madrid',
  teaching_languages: ['en'],
  delivery_modes: ['online'],
  campus: null,
  max_students: null,
  alliance_seats: null,
  seats_available: null,
  seats_updated_at: null,
  application_url: null,
  application_instructions: {},
} as CourseOffering;

const context = (channel: SourceChannel): WriteContext => ({
  syncRunId: RUN_ID,
  organizationId: ORG_ID,
  channel,
  schemaVersion: channel === 'oeapi' ? 'oeapi-5.0' : 'csv-1.3',
  actor: channel === 'oeapi' ? 'system:harvester' : 'kc-partner-admin',
  now: new Date('2026-10-16T08:00:00Z'),
});

/** The record as last written, unchanged since (same hash), with leftover overrides. */
function fakeDb() {
  const { seats_updated_at: _t, ...hashedOffering } = offering;
  return createFakeDb((q) => {
    if (/^select .* from "courses"/.test(q.sql)) {
      return [
        {
          id: COURSE_ID,
          status: 'published',
          content_hash: jcsSha256(course),
          overrides: { ects: { value: 9, source: 5, ...ENTRY } },
          absent_count: 0,
          deleted_at: null,
        },
      ];
    }
    if (/^select .* from "course_texts" .*<> '\{\}'::jsonb/.test(q.sql)) {
      return [{ lang: 'en', overrides: { abstract: { value: 'Old', source: null, ...ENTRY } } }];
    }
    if (/^select .* from "course_offerings"/.test(q.sql)) {
      return [
        {
          id: OFFERING_ID,
          status: 'published',
          content_hash: jcsSha256(hashedOffering),
          overrides: { campus: { value: 'Tarragona', source: null, ...ENTRY } },
          absent_count: 0,
          deleted_at: null,
        },
      ];
    }
    return [];
  });
}

const writes = (queries: RecordedQuery[], table: string) =>
  queries.filter((q) => q.sql.startsWith(`update "${table}"`));
const audits = (queries: RecordedQuery[]) =>
  queries.filter((q) => q.sql.startsWith('insert into "audit_log"')).map(insertedValues);

describe('overrides left from an oeapi period', () => {
  it('a CSV write drops the course and text overrides, audits them and applies the row', async () => {
    const fake = fakeDb();
    const result = await new CanonicalWriter(fake.db, 'warn').upsertCourse(
      context('csv'),
      course,
      {},
    );
    expect(result.outcome).toBe('updated'); // the hash was reset, so the row is written
    const [drop, write] = writes(fake.queries, 'courses');
    expect(drop!.sql).toBe(
      'update "courses" set "overrides" = $1, "content_hash" = $2 where "id" = $3',
    );
    expect(drop!.parameters).toEqual([{}, null, COURSE_ID]);
    expect(write!.sql).toMatch(/"ects" = /);
    expect(write!.sql).not.toMatch(/"overrides"/);
    expect(write!.parameters).toContain(5);
    expect(writes(fake.queries, 'course_texts')[0]!.sql).toBe(
      'update "course_texts" set "overrides" = $1 where "course_id" = $2',
    );
    expect(audits(fake.queries)).toEqual([
      expect.objectContaining({
        action: 'course.overrides_drop',
        entity_type: 'course',
        entity_id: COURSE_ID,
        changes: {
          ext_id: 'C-1',
          channel: 'csv',
          overrides_dropped: ['ects', 'texts.en.abstract'],
          sync_run_id: RUN_ID,
        },
      }),
    ]);
  });

  it('a CSV write drops the offering overrides the same way', async () => {
    const fake = fakeDb();
    await new CanonicalWriter(fake.db, 'warn').upsertOffering(context('csv'), offering, {});
    const [drop, write] = writes(fake.queries, 'course_offerings');
    expect(drop!.sql).toBe(
      'update "course_offerings" set "overrides" = $1, "content_hash" = $2 where "id" = $3',
    );
    expect(write!.sql).toMatch(/"campus" = /);
    expect(write!.sql).not.toMatch(/"overrides"/);
    expect(audits(fake.queries)).toEqual([
      expect.objectContaining({
        action: 'course_offering.overrides_drop',
        changes: {
          ext_id: 'C-1#C-1-2027',
          channel: 'csv',
          overrides_dropped: ['campus'],
          sync_run_id: RUN_ID,
        },
      }),
    ]);
  });

  it('a harvest keeps them', async () => {
    const fake = fakeDb();
    const writer = new CanonicalWriter(fake.db, 'warn');
    const result = await writer.upsertCourse(context('oeapi'), course, {});
    await writer.upsertOffering(context('oeapi'), offering, {});
    expect(result.outcome).toBe('unchanged');
    for (const q of [
      ...writes(fake.queries, 'courses'),
      ...writes(fake.queries, 'course_offerings'),
    ])
      expect(q.sql).not.toMatch(/"overrides"/);
    expect(audits(fake.queries)).toEqual([]);
  });
});
