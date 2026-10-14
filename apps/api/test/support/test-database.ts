// SPDX-License-Identifier: EUPL-1.2
/**
 * Throwaway PostgreSQL databases for integration tests. `DATABASE_URL_TEST` points
 * at a server where the user may CREATE DATABASE (e.g. a `postgres:16` container);
 * each test file gets its own database, migrated with db/migrations, and drops it
 * afterwards. Without `DATABASE_URL_TEST` the integration suites are skipped.
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import type { Database } from '../../src/db/database.js';
import { installDomainArrayParsers } from '../../src/db/db.module.js';

export const TEST_DATABASE_URL = process.env['DATABASE_URL_TEST'];
export const describeWithDatabase = TEST_DATABASE_URL ? 'run' : 'skip';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export const ORG = {
  aurora: '0a000000-0000-4000-8000-000000000001',
  uibk: '0a000000-0000-4000-8000-000000000002',
  uibkFaculty: '0a000000-0000-4000-8000-000000000003',
  urv: '0a000000-0000-4000-8000-000000000004',
} as const;

export interface TestDatabase {
  url: string;
  db: Kysely<Database>;
  drop(): Promise<void>;
}

/** Runs `count` migrations of db/migrations up or down on `databaseUrl`. */
export async function migrate(
  databaseUrl: string,
  direction: 'up' | 'down',
  count = Number.POSITIVE_INFINITY,
): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    count,
    log: () => undefined,
  });
}

/**
 * A fresh database, migrated (all migrations by default, or the first
 * `options.migrations`) and seeded with the organizations of {@link ORG}.
 */
export async function createTestDatabase(
  options: { migrations?: number } = {},
): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error('DATABASE_URL_TEST is not set');
  const name = `oecp_it_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  await migrate(url.href, 'up', options.migrations ?? Number.POSITIVE_INFINITY);
  const pool = new pg.Pool({ connectionString: url.href, max: 5 });
  installDomainArrayParsers(pool);
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  await seedOrganizations(db);
  return {
    url: url.href,
    db,
    async drop() {
      await db.destroy();
      const cleanup = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

async function seedOrganizations(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('organizations')
    .values([
      {
        id: ORG.aurora,
        org_type: 'alliance',
        slug: 'aurora',
        name: { en: 'Aurora' },
        keycloak_idp_alias: null,
      },
      {
        id: ORG.uibk,
        org_type: 'institution',
        is_partner: true,
        partner_id: ORG.uibk,
        slug: 'uibk',
        name: { en: 'University of Innsbruck', de: 'Universität Innsbruck' },
        default_timezone: 'Europe/Vienna',
        contact_email: 'aurora@uibk.example',
        keycloak_idp_alias: 'uibk',
      },
      {
        id: ORG.urv,
        org_type: 'institution',
        is_partner: true,
        partner_id: ORG.urv,
        slug: 'urv',
        name: { en: 'Rovira i Virgili University' },
        default_timezone: 'Europe/Madrid',
        keycloak_idp_alias: 'urv',
      },
    ])
    .execute();
  await db
    .insertInto('organizations')
    .values({
      id: ORG.uibkFaculty,
      parent_id: ORG.uibk,
      partner_id: ORG.uibk,
      org_type: 'faculty',
      slug: 'uibk-informatik',
      name: { en: 'Faculty of Computer Science' },
      keycloak_idp_alias: null,
    })
    .execute();
}
