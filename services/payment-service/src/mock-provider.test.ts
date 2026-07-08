// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to payment_db per db/client.ts's env-var defaults).
import { randomUUID } from 'node:crypto';
import { sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db/client.js';
import { providerCharges } from './db/schema.js';
import { charge, getChargeStatus } from './mock-provider.js';

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE provider_charges`);
});

describe('mock-provider ledger — durable, not in-memory (M9, M11)', () => {
  it('persists a charge so a fresh getChargeStatus call (simulating a post-restart read) sees it', async () => {
    const submissionId = randomUUID();
    const idempotencyKey = submissionId;

    const result = await charge(submissionId, idempotencyKey, 42);
    expect(result.status).toBe('charged');

    // getChargeStatus reads straight from Postgres — no reliance on any process-local state from
    // the charge() call above, which is exactly what the stuck-reservation scanner needs after a
    // real restart.
    const status = await getChargeStatus(idempotencyKey);
    expect(status?.status).toBe('charged');
    expect(status?.providerRef).toBe(result.providerRef);
  });

  it('is idempotent: a second charge() with the same key returns the first outcome, not a new one', async () => {
    const submissionId = randomUUID();
    const idempotencyKey = submissionId;

    const first = await charge(submissionId, idempotencyKey, 42);
    const second = await charge(submissionId, idempotencyKey, 42);

    expect(second).toEqual(first);
    const rows = await db.select().from(providerCharges);
    expect(rows).toHaveLength(1);
  });
});
