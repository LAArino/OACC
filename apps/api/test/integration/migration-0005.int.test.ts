// SPDX-License-Identifier: EUPL-1.2
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  describeWithDatabase,
  migrate,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

/** Catalog of the public schema: columns, constraints, indexes, functions, triggers. */
async function snapshot(tdb: TestDatabase): Promise<Record<string, string[]>> {
  const rows = async (query: ReturnType<typeof sql<{ v: string }>>) =>
    (await query.execute(tdb.db)).rows.map((r) => r.v);
  return {
    columns: await rows(sql<{ v: string }>`SELECT concat_ws(' ', table_name, column_name,
        data_type, column_default, is_nullable) AS v
      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`),
    constraints: await rows(sql<{ v: string }>`SELECT c.conrelid::regclass || ' ' || c.conname
        || ' ' || pg_get_constraintdef(c.oid) AS v
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' ORDER BY 1`),
    indexes: await rows(sql<{ v: string }>`SELECT indexdef AS v FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY 1`),
    functions: await rows(sql<{ v: string }>`SELECT p.oid::regprocedure::text AS v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'oecp%' ORDER BY 1`),
    triggers: await rows(sql<{ v: string }>`SELECT tgrelid::regclass || ' ' || tgname
        || ' ' || tgenabled::text AS v
      FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1`),
  };
}

const COURSE_MASTER = '0d000000-0000-4000-8000-000000000001';
const COURSE_NONE = '0d000000-0000-4000-8000-000000000002';

describe.runIf(describeWithDatabase === 'run')('migration 0005_alliance_attributes', () => {
  let tdb: TestDatabase;
  let before: Record<string, string[]>;
  let updatedAt: Date;

  beforeAll(async () => {
    tdb = await createTestDatabase({ migrations: 4 });
    for (const [id, level] of [
      [COURSE_MASTER, 'master'],
      [COURSE_NONE, null],
    ] as const) {
      await sql`INSERT INTO courses (id, organization_id, ext_id, source_channel, ects, level)
        VALUES (${id}, ${ORG.urv}, ${id}, 'csv', 5, ${level})`.execute(tdb.db);
    }
    updatedAt = (
      await sql<{ updated_at: Date }>`SELECT updated_at FROM courses
        WHERE id = ${COURSE_MASTER}`.execute(tdb.db)
    ).rows[0]!.updated_at;
    before = await snapshot(tdb);
    await migrate(tdb.url, 'up');
  }, 60_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  it('adds kind, levels (backfilled from level, updated_at untouched) and attributes', async () => {
    const { rows } = await sql<{
      id: string;
      kind: string;
      level: string | null;
      levels: string[];
      attributes: unknown;
      updated_at: Date;
    }>`SELECT id, kind, level, levels, attributes, updated_at FROM courses ORDER BY id`.execute(
      tdb.db,
    );
    expect(rows.map(({ updated_at: _u, ...r }) => r)).toEqual([
      { id: COURSE_MASTER, kind: 'course', level: 'master', levels: ['master'], attributes: {} },
      { id: COURSE_NONE, kind: 'course', level: null, levels: [], attributes: {} },
    ]);
    expect(rows[0]!.updated_at).toEqual(updatedAt);
  });

  it.each([
    ["kind = 'seminar'"],
    ["levels = '{phd}'"],
    ["levels = '{master,NULL}'"],
    [`attributes = '{"Bad": true}'`],
    [`attributes = '{"sdg": []}'`],
    [`attributes = '{"sdg": [1]}'`],
    [`attributes = '{"sdg": {"x": 1}}'`],
    [`attributes = '[]'`],
  ])('refuses courses with %s', async (assignment) => {
    await expect(
      sql.raw(`UPDATE courses SET ${assignment} WHERE id = '${COURSE_MASTER}'`).execute(tdb.db),
    ).rejects.toThrow(/check constraint/);
  });

  it('accepts valid attribute values and application instructions', async () => {
    await sql`UPDATE courses SET attributes = ${JSON.stringify({
      sdg: ['sdg04'],
      free_course: true,
      competence_framework: 'louis',
    })}::jsonb WHERE id = ${COURSE_MASTER}`.execute(tdb.db);
    await sql`INSERT INTO course_offerings (course_id, ext_offering_id, source_channel, start_date,
        end_date, timezone, teaching_languages, application_instructions)
      VALUES (${COURSE_MASTER}, 'O1', 'csv', '2027-01-01', '2027-02-01', 'Europe/Madrid', '{en}',
        '{"en": "Apply via the Aurora office."}')`.execute(tdb.db);
    for (const bad of ['{"en-GB": "x"}', '{"en": ""}', '{"en": 1}', '[]']) {
      await expect(
        sql`UPDATE course_offerings SET application_instructions = ${bad}::jsonb`.execute(tdb.db),
      ).rejects.toThrow(/check constraint/);
    }
  });

  it('creates attribute_definitions with shape checks', async () => {
    const insert = (key: string, type: string, options: string | null) =>
      sql`INSERT INTO attribute_definitions (key, value_type, label, options)
        VALUES (${key}, ${type}, '{"en": "Label"}', ${options}::jsonb)`.execute(tdb.db);
    await insert('free_course', 'boolean', null);
    await insert('hub', 'multi_enum', '[{"value": "a", "label": {"en": "A"}}]');
    for (const [key, type, options] of [
      ['hub2', 'enum', null],
      ['flag', 'boolean', '[{"value": "a", "label": {"en": "A"}}]'],
      ['hub3', 'enum', '[]'],
      ['hub4', 'enum', '[{"value": "A B", "label": {"en": "A"}}]'],
      ['hub5', 'enum', '[{"value": "a", "label": {"de": "A"}}]'],
      [
        'hub6',
        'enum',
        '[{"value": "a", "label": {"en": "A"}}, {"value": "a", "label": {"en": "B"}}]',
      ],
      ['Bad', 'text', null],
      ['x', 'text', null],
      ['note', 'number', null],
    ] as const) {
      await expect(insert(key, type, options)).rejects.toThrow(/constraint/);
    }
    const first = await sql<{ updated_at: Date }>`UPDATE attribute_definitions
      SET filterable = true WHERE key = 'hub' RETURNING updated_at`.execute(tdb.db);
    expect(first.rows[0]!.updated_at).toBeInstanceOf(Date);
  });

  it('restores the 0004 schema exactly on down, and migrates up again', async () => {
    await sql`UPDATE courses SET overrides = ${JSON.stringify({
      attributes: { value: {}, by: 'x', at: '2026-10-14T00:00:00Z' },
      ects: { value: 6, by: 'x', at: '2026-10-14T00:00:00Z' },
    })}::jsonb WHERE id = ${COURSE_MASTER}`.execute(tdb.db);
    await migrate(tdb.url, 'down', 1);
    expect(await snapshot(tdb)).toEqual(before);
    const { rows } = await sql<{ level: string; overrides: Record<string, unknown> }>`
      SELECT level, overrides FROM courses WHERE id = ${COURSE_MASTER}`.execute(tdb.db);
    expect(rows[0]!.level).toBe('master');
    expect(Object.keys(rows[0]!.overrides)).toEqual(['ects']);

    await migrate(tdb.url, 'up');
    const again = await sql<{ levels: string[] }>`SELECT levels FROM courses
      WHERE id = ${COURSE_MASTER}`.execute(tdb.db);
    expect(again.rows[0]!.levels).toEqual(['master']);
    const tables = await sql<{
      n: string;
    }>`SELECT count(*) AS n FROM attribute_definitions`.execute(tdb.db);
    expect(Number(tables.rows[0]!.n)).toBe(0);
  });
});
