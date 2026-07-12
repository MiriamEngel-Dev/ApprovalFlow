import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // idempotency.test.ts and supplement.test.ts both TRUNCATE shared tables in a real Postgres
    // (submission_db) — same rationale as decision-service's/payment-service's vitest.config.ts.
    // Previously this file didn't exist because there was only one test file; adding a second one
    // that touches the same tables makes Vitest's default file-level parallelism actively harmful
    // (two files' TRUNCATEs racing against each other's assertions).
    fileParallelism: false,
  },
});
