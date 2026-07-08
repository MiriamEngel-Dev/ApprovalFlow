import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const {
  POSTGRES_HOST = 'localhost',
  POSTGRES_PORT = '5432',
  POSTGRES_USER = 'approvalflow',
  POSTGRES_PASSWORD = 'changeme',
  AUDIT_DB = 'audit_db',
} = process.env;

const connectionString = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${AUDIT_DB}`;

export const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });

/** Shared transaction-executor type — same interface as `db` for queries, scoped to one
 * `db.transaction()` call. Used to keep the dedup marker and the audit_events/notifications
 * inserts atomic (M10), same pattern as the other services. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
