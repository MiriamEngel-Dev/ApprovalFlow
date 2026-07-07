import { defineConfig } from 'drizzle-kit';

const {
  POSTGRES_HOST = 'localhost',
  POSTGRES_PORT = '5432',
  POSTGRES_USER = 'approvalflow',
  POSTGRES_PASSWORD = 'changeme',
  DECISION_DB = 'decision_db',
} = process.env;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${DECISION_DB}`,
  },
});
