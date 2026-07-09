import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { payments } from '../db/schema.js';
import { charge, type ChargeStatus } from '../mock-provider.js';

export interface ExecuteResult {
  status: ChargeStatus;
  paymentId?: string;
}

/**
 * Step 2 of the saga. `idempotency_key = submissionId` (one payment per submission, matching
 * `reservations`' own `UNIQUE(submission_id)`) — checked before calling the provider, so a
 * redelivered trigger that somehow reaches this step twice (belt-and-suspenders beyond
 * `processed_events` dedup) returns the already-recorded outcome instead of double-charging.
 */
export async function executePayment(submissionId: string, amount: number): Promise<ExecuteResult> {
  const idempotencyKey = submissionId;

  const [existing] = await db
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing) {
    return { status: 'charged', paymentId: existing.id };
  }

  const result = await charge(submissionId, idempotencyKey, amount);
  if (result.status === 'declined') {
    return { status: 'declined' };
  }

  // Insert-or-return-existing: the SELECT above is a cheap pre-check, not authoritative — a
  // concurrent call reaching this same insert for the same idempotencyKey is resolved by the
  // UNIQUE constraint via onConflictDoNothing rather than throwing (same pattern as
  // mock-provider.ts's charge()).
  const [inserted] = await db
    .insert(payments)
    .values({ submissionId, idempotencyKey, amount: amount.toFixed(2), status: 'completed' })
    .onConflictDoNothing({ target: payments.idempotencyKey })
    .returning({ id: payments.id });
  if (inserted) return { status: 'charged', paymentId: inserted.id };

  const [winner] = await db
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!winner) throw new Error(`payments row for "${idempotencyKey}" vanished after conflict`);
  return { status: 'charged', paymentId: winner.id };
}
