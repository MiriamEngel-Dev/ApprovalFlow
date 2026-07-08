import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const {
  POSTGRES_HOST = 'localhost',
  POSTGRES_PORT = '5432',
  POSTGRES_USER = 'approvalflow',
  POSTGRES_PASSWORD = 'changeme',
  PAYMENT_DB = 'payment_db',
} = process.env;

const connectionString = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${PAYMENT_DB}`;

export const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });

/** Shared transaction-executor type — same interface as `db` for queries, scoped to one
 * `db.transaction()` call. Reused by the saga steps and the stuck-reservation scanner so a caller
 * can compose multiple steps into one atomic transaction instead of each step opening its own. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
