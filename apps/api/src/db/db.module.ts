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

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Db =>
        new Kysely<Database>({
          dialect: new PostgresDialect({
            pool: new pg.Pool({
              connectionString: config.get('DATABASE_URL', { infer: true }),
              max: 10,
            }),
          }),
        }),
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
