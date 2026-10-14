// SPDX-License-Identifier: EUPL-1.2
/**
 * Kysely instance over a scripted driver: real query building and compilation
 * (PostgreSQL dialect), canned rows instead of a database.
 */
import {
  type DatabaseConnection,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import type { Database } from '../../src/db/database.js';

export interface RecordedQuery {
  sql: string;
  parameters: readonly unknown[];
}

/** Returns the rows for a query (undefined = no rows). */
export type Responder = (query: RecordedQuery) => unknown[] | undefined;

export interface FakeDb {
  db: Kysely<Database>;
  queries: RecordedQuery[];
  /** 'begin' | 'commit' | 'rollback' | 'query', in order. */
  events: string[];
}

export function createFakeDb(responder: Responder = () => undefined): FakeDb {
  const queries: RecordedQuery[] = [];
  const events: string[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiled: { sql: string; parameters: readonly unknown[] }) {
      const query = { sql: compiled.sql, parameters: compiled.parameters };
      queries.push(query);
      events.push('query');
      return { rows: (responder(query) ?? []) as R[] };
    },
    streamQuery: () => {
      throw new Error('streamQuery is not supported by the fake driver');
    },
  };
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => void events.push('begin'),
    commitTransaction: async () => void events.push('commit'),
    rollbackTransaction: async () => void events.push('rollback'),
    releaseConnection: async () => {},
    destroy: async () => {},
  };
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, queries, events };
}

/** Column → value map of a compiled single-row `insert into "t" (...) values (...)`. */
export function insertedValues(query: RecordedQuery): Record<string, unknown> {
  const columns = /^insert into "\w+" \(([^)]*)\)/.exec(query.sql)?.[1];
  if (!columns) throw new Error(`Not an insert: ${query.sql}`);
  const names = columns.split(', ').map((c) => c.replace(/"/g, ''));
  return Object.fromEntries(names.map((name, i) => [name, query.parameters[i]]));
}
