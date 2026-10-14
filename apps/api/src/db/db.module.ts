// SPDX-License-Identifier: EUPL-1.2
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Env } from '../config/env.js';
import type { Database } from './database.js';

export const KYSELY = Symbol('KYSELY');
export type Db = Kysely<Database>;

// `date` values are calendar dates local to an offering's time zone (spec §5);
// keep them as 'YYYY-MM-DD' strings instead of shifting them into JS Dates.
const PG_DATE_OID = 1082;
pg.types.setTypeParser(PG_DATE_OID, (value) => value);

/** `text[]`; typed as number because pg-types' `TypeId` enum lists scalar built-ins only. */
const PG_TEXT_ARRAY_OID: number = 1009;
/** Array types over domains (e.g. `language_tag[]`) have database-specific OIDs. */
const DOMAIN_ARRAY_TYPES = ['_language_tag'];

/**
 * Makes pg parse arrays of text domains (`teaching_languages`, `ui_languages`)
 * like `text[]` instead of returning the literal `{en,de}`. The OID lookup runs as
 * the first query of every new connection: pg executes a connection's queries in
 * order, so the parser is installed before any result of that connection arrives.
 */
export function installDomainArrayParsers(pool: pg.Pool): void {
  const parseTextArray = pg.types.getTypeParser(PG_TEXT_ARRAY_OID);
  pool.on('connect', (client) => {
    client
      .query<{ oid: number }>('SELECT oid::int AS oid FROM pg_type WHERE typname = ANY($1)', [
        DOMAIN_ARRAY_TYPES,
      ])
      .then(({ rows }) => {
        for (const { oid } of rows) pg.types.setTypeParser(oid, parseTextArray);
      })
      .catch(() => undefined);
  });
}

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Db => {
        const pool = new pg.Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: 10,
        });
        installDomainArrayParsers(pool);
        return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
      },
    },
  ],
  exports: [KYSELY],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
