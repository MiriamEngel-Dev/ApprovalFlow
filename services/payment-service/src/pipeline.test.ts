// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to payment_db). The saga's concurrency/compensation guarantees are
// inherently database behaviors (row-locking, CHECK constraints) that mocks can't stand in for.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db/client.js';
import { departmentBudgets, outbox, payments, processedEvents, reservations } from './db/schema.js';
import { runPaymentSaga, type SagaTrigger } from './pipeline.js';
import { forceFailureFor } from './mock-provider.js';

const DEPARTMENT = 'engineering-2026Q2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../sample-invoices.json');
const fixturesFile = JSON.parse(readFileSync(fixturesPath, 'utf-8')) as {
  budgets: Record<string, number>;
  fixtures: { id: string; department: string; total: number }[];
};

function getFixture(id: string) {
  const fixture = fixturesFile.fixtures.find((f) => f.id === id);
  if (!fixture) throw new Error(`Fixture ${id} not found in sample-invoices.json`);
  return fixture;
}

async function seedBudget(total: number): Promise<void> {
  await db.insert(departmentBudgets).values({ department: DEPARTMENT, total: total.toFixed(2) });
}

function trigger(overrides: Partial<SagaTrigger> = {}): SagaTrigger {
  return {
    eventId: randomUUID(),
    correlationId: randomUUID(),
    submissionId: randomUUID(),
    department: DEPARTMENT,
    amount: 100,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.execute(
    rawSql`TRUNCATE department_budgets, reservations, payments, outbox, processed_events, provider_charges`,
  );
});

describe('runPaymentSaga — happy path (M9, ADR-003)', () => {
  it('reserves, charges, and confirms — budget moves from reserved to spent', async () => {
    await seedBudget(1000);
    const t = trigger({ amount: 250 });

    const result = await runPaymentSaga(t);
    expect(result.status).toBe('processed');

    const [budget] = await db
      .select()
      .from(departmentBudgets)
      .where(eq(departmentBudgets.department, DEPARTMENT));
    expect(budget?.reserved).toBe('0.00');
    expect(budget?.spent).toBe('250.00');

    const [reservation] = await db.select().from(reservations);
    expect(reservation?.status).toBe('confirmed');

    const [payment] = await db.select().from(payments);
    expect(payment?.status).toBe('completed');

    const outboxTopics = (await db.select().from(outbox)).map((r) => r.topic);
    expect(outboxTopics).toEqual(['PaymentSucceeded']);
  });
});

describe('runPaymentSaga — Journey D: forced payment failure + compensation (M9)', () => {
  it('releases the reservation on a declined charge — nothing was ever spent', async () => {
    await seedBudget(1000);
    const t = trigger({ amount: 400 });
    forceFailureFor(t.submissionId);

    const result = await runPaymentSaga(t);
    expect(result.status).toBe('processed');

    const [budget] = await db
      .select()
      .from(departmentBudgets)
      .where(eq(departmentBudgets.department, DEPARTMENT));
    expect(budget?.reserved).toBe('0.00');
    expect(budget?.spent).toBe('0.00');

    const [reservation] = await db.select().from(reservations);
    expect(reservation?.status).toBe('compensated');

    const paymentRows = await db.select().from(payments);
    expect(paymentRows).toHaveLength(0);

    const outboxTopics = (await db.select().from(outbox)).map((r) => r.topic);
    expect(outboxTopics).toEqual(['PaymentCompensated', 'PaymentFailed']);
  });
});

describe('runPaymentSaga — insufficient budget (M9)', () => {
  it('fails without ever creating a reservation when the budget cannot cover the amount', async () => {
    await seedBudget(100);
    const t = trigger({ amount: 250 });

    const result = await runPaymentSaga(t);
    expect(result.status).toBe('processed');

    expect(await db.select().from(reservations)).toHaveLength(0);

    const outboxTopics = (await db.select().from(outbox)).map((r) => r.topic);
    expect(outboxTopics).toEqual(['PaymentFailed']);
  });
});

describe('runPaymentSaga — event dedup (M10)', () => {
  it('is a no-op on a redelivered eventId', async () => {
    await seedBudget(1000);
    const t = trigger({ amount: 100 });

    const first = await runPaymentSaga(t);
    const second = await runPaymentSaga(t);

    expect(first.status).toBe('processed');
    expect(second.status).toBe('duplicate-event');
    expect(await db.select().from(reservations)).toHaveLength(1);
  });
});

describe('runPaymentSaga — concurrency pair INV-1014A/B (M9, ADR-003)', () => {
  it('reserves exactly one of the two shipped fixtures against their shared budget, never overspending', async () => {
    const fixtureA = getFixture('INV-1014A');
    const fixtureB = getFixture('INV-1014B');
    expect(fixtureA.department).toBe(fixtureB.department);
    const department = fixtureA.department;
    const budgetTotal = fixturesFile.budgets[department];
    if (budgetTotal === undefined) throw new Error(`No budget seeded for ${department}`);

    await db.insert(departmentBudgets).values({ department, total: budgetTotal.toFixed(2) });

    const [resultA, resultB] = await Promise.all([
      runPaymentSaga(trigger({ department, amount: fixtureA.total })),
      runPaymentSaga(trigger({ department, amount: fixtureB.total })),
    ]);

    expect([resultA.status, resultB.status]).toEqual(['processed', 'processed']);

    const confirmedReservations = await db
      .select()
      .from(reservations)
      .where(eq(reservations.status, 'confirmed'));
    expect(confirmedReservations).toHaveLength(1);
    expect(Number(confirmedReservations[0]?.amount)).toBe(fixtureA.total);

    const [budget] = await db
      .select()
      .from(departmentBudgets)
      .where(eq(departmentBudgets.department, department));
    expect(Number(budget?.reserved)).toBe(0);
    expect(Number(budget?.spent)).toBe(fixtureA.total);
    expect(Number(budget?.spent)).toBeLessThanOrEqual(budgetTotal);

    const failedOutbox = (await db.select().from(outbox)).filter(
      (r) => r.topic === 'PaymentFailed',
    );
    expect(failedOutbox).toHaveLength(1);
  });
});

describe('runPaymentSaga — dedup marker is atomic with reserve (M10)', () => {
  it('does not mark the event processed if reserving budget throws mid-transaction', async () => {
    // No budget seeded for this department — reserveBudget throws inside the same transaction
    // that writes the processed_events row. Before the fix, that insert was a separate statement
    // ahead of reserveBudget, so it would have survived this throw and the event would have been
    // permanently (and silently) dropped on any redelivery.
    const t = trigger({ department: 'nonexistent-department' });

    await expect(runPaymentSaga(t)).rejects.toThrow(/No department budget seeded/);

    const processed = await db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.eventId, t.eventId));
    expect(processed).toHaveLength(0);
  });
});
