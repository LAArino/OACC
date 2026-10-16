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

const COURSE_STALE = '0d000000-0000-4000-8000-000000000011';
const COURSE_LEVEL_ONLY = '0d000000-0000-4000-8000-000000000012';
const COURSE_NONE = '0d000000-0000-4000-8000-000000000013';
const COURSE_NEW = '0d000000-0000-4000-8000-000000000014';

interface LevelRow {
  id: string;
  level: string | null;
  levels: string[];
  updated_at: Date;
}

describe.runIf(describeWithDatabase === 'run')('migration 0009_course_level_trigger', () => {
  let tdb: TestDatabase;
  let updatedAt: Map<string, number>;

  const read = async (id: string) =>
    (
      await sql<LevelRow>`SELECT id, level, levels, updated_at FROM courses
        WHERE id = ${id}`.execute(tdb.db)
    ).rows[0]!;
  const triggers = async () =>
    (
      await sql<{ tgname: string }>`SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'courses'::regclass AND tgname = 'courses_level_from_levels'`.execute(
        tdb.db,
      )
    ).rows.length;

  beforeAll(async () => {
    tdb = await createTestDatabase({ migrations: 8 });
    // States the writer never produces, only manual SQL could.
    for (const [id, level, levels] of [
      [COURSE_STALE, 'bachelor', '{master,doctoral}'],
      [COURSE_LEVEL_ONLY, 'doctoral', '{}'],
      [COURSE_NONE, null, '{}'],
    ] as const) {
      await sql`INSERT INTO courses (id, organization_id, ext_id, source_channel, ects, level, levels)
        VALUES (${id}, ${ORG.urv}, ${id}, 'csv', 5, ${level}, ${levels}::text[])`.execute(tdb.db);
    }
    const { rows } = await sql<LevelRow>`SELECT id, updated_at FROM courses`.execute(tdb.db);
    updatedAt = new Map(rows.map((r) => [r.id, r.updated_at.getTime()]));
    await migrate(tdb.url, 'up', 1);
  }, 60_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  it('backfills level = levels[1] without touching updated_at', async () => {
    expect(await read(COURSE_STALE)).toMatchObject({
      level: 'master',
      levels: ['master', 'doctoral'],
    });
    expect(await read(COURSE_LEVEL_ONLY)).toMatchObject({
      level: 'doctoral',
      levels: ['doctoral'],
    });
    expect(await read(COURSE_NONE)).toMatchObject({ level: null, levels: [] });
    for (const id of [COURSE_STALE, COURSE_LEVEL_ONLY, COURSE_NONE]) {
      expect((await read(id)).updated_at.getTime()).toBe(updatedAt.get(id));
    }
  });

  it('keeps level = levels[1] when levels is updated through SQL', async () => {
    await sql`UPDATE courses SET levels = '{doctoral,master}' WHERE id = ${COURSE_STALE}`.execute(
      tdb.db,
    );
    expect(await read(COURSE_STALE)).toMatchObject({ level: 'doctoral' });
    await sql`UPDATE courses SET levels = '{}' WHERE id = ${COURSE_STALE}`.execute(tdb.db);
    expect(await read(COURSE_STALE)).toMatchObject({ level: null, levels: [] });
  });

  it('derives level on INSERT and replaces a write of level alone', async () => {
    await sql`INSERT INTO courses (id, organization_id, ext_id, source_channel, ects, level, levels)
      VALUES (${COURSE_NEW}, ${ORG.urv}, ${COURSE_NEW}, 'csv', 5, 'other', '{bachelor}')`.execute(
      tdb.db,
    );
    expect(await read(COURSE_NEW)).toMatchObject({ level: 'bachelor' });
    await sql`UPDATE courses SET level = 'master' WHERE id = ${COURSE_NEW}`.execute(tdb.db);
    expect(await read(COURSE_NEW)).toMatchObject({ level: 'bachelor', levels: ['bachelor'] });
    // Other columns do not fire it.
    await sql`UPDATE courses SET ects = 6 WHERE id = ${COURSE_NEW}`.execute(tdb.db);
    expect(await read(COURSE_NEW)).toMatchObject({ level: 'bachelor' });
  });

  it('drops the trigger on down, and migrates up again', async () => {
    expect(await triggers()).toBe(1);
    await migrate(tdb.url, 'down', 1);
    expect(await triggers()).toBe(0);
    await sql`UPDATE courses SET level = 'master' WHERE id = ${COURSE_NEW}`.execute(tdb.db);
    expect(await read(COURSE_NEW)).toMatchObject({ level: 'master', levels: ['bachelor'] });
    await migrate(tdb.url, 'up', 1);
    expect(await triggers()).toBe(1);
    expect(await read(COURSE_NEW)).toMatchObject({ level: 'bachelor' });
  });
});
