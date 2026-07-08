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

  const [inserted] = await db
    .insert(payments)
    .values({ submissionId, idempotencyKey, amount: amount.toFixed(2), status: 'completed' })
    .returning({ id: payments.id });
  if (!inserted) throw new Error('Insert into payments returned no row');

  return { status: 'charged', paymentId: inserted.id };
}
