// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to payment_db per db/client.ts's env-var defaults).
import { randomUUID } from 'node:crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { departmentBudgets, outbox, providerCharges, reservations } from '../db/schema.js';
import { scanForStuckReservations } from './stuck-reservation-scanner.js';

const DEPARTMENT = 'engineering-2026Q2';
const STUCK_AGE_MS = 120_000; // well past the 60s threshold

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE department_budgets, reservations, outbox, provider_charges`);
  await db.insert(departmentBudgets).values({
    department: DEPARTMENT,
    total: '1000.00',
    reserved: '250.00',
  });
});

async function seedStuckReservation(submissionId: string, amount: number) {
  const [reservation] = await db
    .insert(reservations)
    .values({
      submissionId,
      department: DEPARTMENT,
      amount: amount.toFixed(2),
      correlationId: randomUUID(),
      createdAt: new Date(Date.now() - STUCK_AGE_MS),
    })
    .returning({ id: reservations.id });
  if (!reservation) throw new Error('seed insert returned no row');
  return reservation.id;
}

describe('scanForStuckReservations — recovers via a real transaction per row (ADR-013)', () => {
  it('confirms a stuck reservation the provider says was charged, and publishes PaymentSucceeded', async () => {
    const submissionId = randomUUID();
    const reservationId = await seedStuckReservation(submissionId, 250);
    await db
      .insert(providerCharges)
      .values({ idempotencyKey: submissionId, status: 'charged', providerRef: 'mock_test' });

    await scanForStuckReservations();

    const [reservation] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    expect(reservation?.status).toBe('confirmed');

    const [budget] = await db
      .select()
      .from(departmentBudgets)
      .where(eq(departmentBudgets.department, DEPARTMENT));
    expect(budget?.reserved).toBe('0.00');
    expect(budget?.spent).toBe('250.00');

    const outboxTopics = (await db.select().from(outbox)).map((r) => r.topic);
    expect(outboxTopics).toEqual(['PaymentSucceeded']);
  });

  it('compensates a stuck reservation the provider never charged, and publishes PaymentCompensated + PaymentFailed', async () => {
    const submissionId = randomUUID();
    const reservationId = await seedStuckReservation(submissionId, 250);
    // No provider_charges row — the provider has no record, treated as never-charged.

    await scanForStuckReservations();

    const [reservation] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    expect(reservation?.status).toBe('compensated');

    const [budget] = await db
      .select()
      .from(departmentBudgets)
      .where(eq(departmentBudgets.department, DEPARTMENT));
    expect(budget?.reserved).toBe('0.00');

    // Sorted: both rows commit in the same transaction, so DB row order between them is not
    // guaranteed without an explicit ORDER BY — only that both topics were published, not which
    // physically landed "first" in an unordered SELECT.
    const outboxTopics = (await db.select().from(outbox)).map((r) => r.topic).sort();
    expect(outboxTopics).toEqual(['PaymentCompensated', 'PaymentFailed']);
  });

  it('leaves reservations younger than 60s alone', async () => {
    const submissionId = randomUUID();
    const [reservation] = await db
      .insert(reservations)
      .values({
        submissionId,
        department: DEPARTMENT,
        amount: '250.00',
        correlationId: randomUUID(),
      })
      .returning({ id: reservations.id });

    await scanForStuckReservations();

    const [row] = await db.select().from(reservations).where(eq(reservations.id, reservation!.id));
    expect(row?.status).toBe('active');
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
});
