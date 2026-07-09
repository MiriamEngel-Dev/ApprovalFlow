// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to audit_db per db/client.ts's env-var defaults).
import { randomUUID } from 'node:crypto';
import { sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { getDashboardStats } from './dashboard.js';

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE audit_events`);
});

async function seedDecision(route: string): Promise<string> {
  const submissionId = randomUUID();
  await db.insert(auditEvents).values({
    submissionId,
    eventType: 'DecisionMade',
    payload: { route },
    correlationId: randomUUID(),
  });
  return submissionId;
}

async function seedPaymentSucceeded(submissionId: string, amount: number): Promise<void> {
  await db.insert(auditEvents).values({
    submissionId,
    eventType: 'PaymentSucceeded',
    payload: { amount },
    correlationId: randomUUID(),
  });
}

async function seedApprovalCompleted(submissionId: string): Promise<void> {
  await db.insert(auditEvents).values({
    submissionId,
    eventType: 'ApprovalCompleted',
    payload: {},
    correlationId: randomUUID(),
  });
}

describe('getDashboardStats — F8', () => {
  it('computes throughput, route breakdown, and the auto/human money split', async () => {
    const autoApproved = await seedDecision('auto_approve');
    await seedPaymentSucceeded(autoApproved, 42);

    const humanApproved = await seedDecision('human_review');
    await seedApprovalCompleted(humanApproved);
    await seedPaymentSucceeded(humanApproved, 1820);

    const escalatedNoPayment = await seedDecision('human_review');
    void escalatedNoPayment; // still pending, no PaymentSucceeded yet

    await seedDecision('reject');

    const stats = await getDashboardStats();

    expect(stats.totalDecisions).toBe(4);
    expect(stats.byRoute).toEqual({ auto_approve: 1, human_review: 2, reject: 1 });
    expect(stats.moneyAutoApproved).toBe(42);
    expect(stats.moneyHumanApproved).toBe(1820);
  });

  it('returns zeros on an empty database', async () => {
    const stats = await getDashboardStats();
    expect(stats.totalDecisions).toBe(0);
    expect(stats.byRoute).toEqual({});
    expect(stats.moneyAutoApproved).toBe(0);
    expect(stats.moneyHumanApproved).toBe(0);
  });
});
