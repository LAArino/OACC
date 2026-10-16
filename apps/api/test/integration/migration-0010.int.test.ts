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

const RUN_BOTH = '0e000000-0000-4000-8000-000000000001';
const RUN_COURSES = '0e000000-0000-4000-8000-000000000002';
const RUN_HARVEST = '0e000000-0000-4000-8000-000000000003';

describe.runIf(describeWithDatabase === 'run')('migration 0010_sync_run_files', () => {
  let tdb: TestDatabase;

  const files = async (id: string) =>
    (await sql<{ files: unknown }>`SELECT files FROM sync_runs WHERE id = ${id}`.execute(tdb.db))
      .rows[0]!.files;

  beforeAll(async () => {
    tdb = await createTestDatabase({ migrations: 9 });
    for (const [id, channel, trigger] of [
      [RUN_BOTH, 'csv', 'upload'],
      [RUN_COURSES, 'csv', 'upload'],
      [RUN_HARVEST, 'oeapi', 'schedule'],
    ] as const) {
      await sql`INSERT INTO sync_runs (id, organization_id, channel, trigger_kind, schema_version)
        VALUES (${id}, ${ORG.urv}, ${channel}::source_channel, ${trigger}, 'csv-1.3')`.execute(
        tdb.db,
      );
    }
    const audit = (id: string, filesChange: object) =>
      sql`INSERT INTO audit_log (actor_sub, action, entity_type, entity_id, changes)
        VALUES ('kc-admin', 'upload.create', 'sync_run', ${id},
                ${JSON.stringify({ files: filesChange })}::jsonb)`.execute(tdb.db);
    await audit(RUN_BOTH, {
      courses: { name: 'cursos ñ.csv', bytes: 10, sha256: 'x' },
      offerings: { name: 'offerings.csv', bytes: 10, sha256: 'y' },
    });
    await audit(RUN_COURSES, { courses: { name: 'courses.csv', bytes: 10, sha256: 'z' } });
    await migrate(tdb.url, 'up', 1);
  }, 60_000);

  afterAll(async () => {
    await tdb?.drop();
  });

  it('backfills the names from the upload.create audit rows', async () => {
    expect(await files(RUN_BOTH)).toEqual({ courses: 'cursos ñ.csv', offerings: 'offerings.csv' });
    expect(await files(RUN_COURSES)).toEqual({ courses: 'courses.csv' });
    expect(await files(RUN_HARVEST)).toBeNull();
  });

  it.each([
    ["'{}'"],
    [`'{"other": "x.csv"}'`],
    [`'{"courses": ""}'`],
    [`'{"courses": 1}'`],
    [`'["courses.csv"]'`],
  ])('refuses files = %s', async (value) => {
    await expect(
      sql.raw(`UPDATE sync_runs SET files = ${value} WHERE id = '${RUN_HARVEST}'`).execute(tdb.db),
    ).rejects.toThrow(/check constraint/);
  });

  it('drops the column on down, and migrates up again', async () => {
    await migrate(tdb.url, 'down', 1);
    const { rows } = await sql<{ n: string }>`SELECT count(*) AS n FROM information_schema.columns
      WHERE table_name = 'sync_runs' AND column_name = 'files'`.execute(tdb.db);
    expect(Number(rows[0]!.n)).toBe(0);
    await migrate(tdb.url, 'up', 1);
    expect(await files(RUN_COURSES)).toEqual({ courses: 'courses.csv' });
  });
});
