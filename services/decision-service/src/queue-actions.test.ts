// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to decision_db). Row-lock resume (M11, F5) is inherently a database
// behavior (SELECT ... FOR UPDATE, unique constraints) that mocks can't meaningfully stand in for.
import { randomUUID } from 'node:crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db/client.js';
import { approvalQueue, outbox } from './db/schema.js';
import { approveQueueItem, rejectQueueItem, requestInfoOnQueueItem } from './queue-actions.js';

async function seedPendingQueueItem(): Promise<string> {
  const [row] = await db
    .insert(approvalQueue)
    .values({
      submissionId: randomUUID(),
      correlationId: randomUUID(),
      department: 'engineering-2026Q2',
      amount: '1400.00',
    })
    .returning({ id: approvalQueue.id });
  if (!row) throw new Error('seed insert returned no row');
  return row.id;
}

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE approval_queue, outbox`);
});

describe('approveQueueItem (F5, M11)', () => {
  it('flips a pending item to approved and publishes ApprovalCompleted', async () => {
    const queueId = await seedPendingQueueItem();

    const result = await approveQueueItem(queueId, 'manager@northwind.example');
    expect(result.status).toBe('ok');

    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, queueId));
    expect(row?.status).toBe('approved');
    expect(row?.resolvedAt).not.toBeNull();

    const outboxRows = await db.select().from(outbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.topic).toBe('ApprovalCompleted');
  });

  it('returns conflict on a second approve attempt — resume is exactly-once', async () => {
    const queueId = await seedPendingQueueItem();

    await approveQueueItem(queueId, 'manager@northwind.example');
    const second = await approveQueueItem(queueId, 'manager@northwind.example');

    expect(second.status).toBe('conflict');
    const outboxRows = await db.select().from(outbox);
    expect(outboxRows).toHaveLength(1);
  });

  it('returns not_found for an unknown queueId', async () => {
    const result = await approveQueueItem(randomUUID(), 'manager@northwind.example');
    expect(result.status).toBe('not_found');
  });
});

describe('rejectQueueItem (F5)', () => {
  it('flips a pending item to rejected and publishes ApprovalRejected', async () => {
    const queueId = await seedPendingQueueItem();

    const result = await rejectQueueItem(
      queueId,
      'manager@northwind.example',
      'Not policy-eligible',
    );
    expect(result.status).toBe('ok');

    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, queueId));
    expect(row?.status).toBe('rejected');

    const outboxRows = await db.select().from(outbox);
    expect(outboxRows[0]?.topic).toBe('ApprovalRejected');
  });
});

describe('requestInfoOnQueueItem (F5)', () => {
  it('flips a pending item to info_requested without resolving it', async () => {
    const queueId = await seedPendingQueueItem();

    const result = await requestInfoOnQueueItem(queueId, 'Please provide a client name');
    expect(result.status).toBe('ok');

    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, queueId));
    expect(row?.status).toBe('info_requested');
    expect(row?.resolvedAt).toBeNull();
    expect(row?.requestInfoNote).toBe('Please provide a client name');

    const outboxRows = await db.select().from(outbox);
    expect(outboxRows[0]?.topic).toBe('InfoRequested');
  });
});
