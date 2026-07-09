// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to payment_db per db/client.ts's env-var defaults).
import { randomUUID } from 'node:crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { payments } from '../db/schema.js';
import { executePayment } from './execute.js';

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE payments, provider_charges`);
});

describe('executePayment — idempotency_key conflict resolution', () => {
  it('two truly concurrent calls for the same submissionId still produce exactly one payments row', async () => {
    const submissionId = randomUUID();

    const [first, second] = await Promise.all([
      executePayment(submissionId, 42),
      executePayment(submissionId, 42),
    ]);

    expect(first.status).toBe('charged');
    expect(second.status).toBe('charged');
    expect(first.paymentId).toBe(second.paymentId);

    const rows = await db.select().from(payments).where(eq(payments.submissionId, submissionId));
    expect(rows).toHaveLength(1);
  });
});
