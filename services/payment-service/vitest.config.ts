import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // seed.test.ts and pipeline.test.ts both TRUNCATE shared tables in a real Postgres
    // (payment_db) — same rationale as decision-service's vitest.config.ts.
    fileParallelism: false,
  },
});
