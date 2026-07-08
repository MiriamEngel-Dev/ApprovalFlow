import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests TRUNCATE shared tables in a real Postgres (audit_db) — same rationale as the other
    // services' vitest.config.ts.
    fileParallelism: false,
  },
});
