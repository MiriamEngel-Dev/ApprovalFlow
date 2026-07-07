// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to payment_db). The saga's concurrency/compensation guarantees are
// inherently database behaviors (row-locking, CHECK constraints) that mocks can't stand in for.
import { randomUUID } from 'node:crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db/client.js';
import { departmentBudgets, outbox, payments, reservations } from './db/schema.js';
import { runPaymentSaga, type SagaTrigger } from './pipeline.js';
import { forceFailureFor } from './mock-provider.js';

const DEPARTMENT = 'engineering-2026Q2';

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
    rawSql`TRUNCATE department_budgets, reservations, payments, outbox, processed_events`,
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
  it('reserves exactly one of two concurrent $600 requests against a $1,000 budget, never overspending', async () => {
    await seedBudget(1000);
    const submissionA = randomUUID();
    const submissionB = randomUUID();

    const [resultA, resultB] = await Promise.all([
      runPaymentSaga(trigger({ submissionId: submissionA, amount: 600 })),
      runPaymentSaga(trigger({ submissionId: submissionB, amount: 600 })),
    ]);

    expect([resultA.status, resultB.status]).toEqual(['processed', 'processed']);

    const confirmedReservations = await db
      .select()
      .from(reservations)
      .where(eq(reservations.status, 'confirmed'));
    expect(confirmedReservations).toHaveLength(1);

    const [budget] = await db
      .select()
      .from(departmentBudgets)
      .where(eq(departmentBudgets.department, DEPARTMENT));
    expect(Number(budget?.reserved)).toBe(0);
    expect(Number(budget?.spent)).toBeLessThanOrEqual(1000);

    const failedOutbox = (await db.select().from(outbox)).filter(
      (r) => r.topic === 'PaymentFailed',
    );
    expect(failedOutbox).toHaveLength(1);
  });
});
