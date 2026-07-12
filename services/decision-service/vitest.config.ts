import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // pipeline.test.ts and queue-actions.test.ts both TRUNCATE shared tables in a real Postgres
    // (decision_db) in their beforeEach — running test files in parallel lets one file's
    // TRUNCATE wipe rows another file's test just inserted. router.test.ts/policy-cache.test.ts
    // have no shared external state, so serializing costs little.
    fileParallelism: false,
  },
});
