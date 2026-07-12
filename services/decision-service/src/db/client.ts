import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const {
  POSTGRES_HOST = 'localhost',
  POSTGRES_PORT = '5432',
  POSTGRES_USER = 'approvalflow',
  POSTGRES_PASSWORD = 'changeme',
  DECISION_DB = 'decision_db',
} = process.env;

const connectionString = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${DECISION_DB}`;

export const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });
