import { eq } from 'drizzle-orm';
import { createLogger } from '@approvalflow/shared';
import type { Tx } from '../db/client.js';
import { departmentBudgets, payments, reservations } from '../db/schema.js';

const logger = createLogger('payment-service');

/**
 * Compensation (ADR-003 §"Compensation must be correct"): releases the budget hold and, if a
 * payment was actually charged before the failure, marks it refunded (a mock refund — no real
 * money moves in M15's no-paid-services constraint, but the ledger reflects the reversal so
 * `payments` stays an honest record). Runs whether triggered inline (execute declined) or by the
 * stuck-reservation scanner (timeout recovery) — both call this same function.
 *
 * Takes an existing `tx` so the caller can commit this together with the matching outbox row(s)
 * atomically. Re-locks and re-checks the reservation's own status first (`SELECT ... FOR UPDATE`)
 * and no-ops on anything not `active` — defense in depth against a double-compensate (e.g. a race
 * between the inline decline path and the scanner), on top of the DB-level
 * `CHECK(reserved >= 0)` backstop that would otherwise turn a double-call into a thrown error
 * rather than a clean no-op.
 */
export async function compensateReservation(
  tx: Tx,
  reservationId: string,
  department: string,
  amount: number,
  submissionId: string,
): Promise<void> {
  const [reservation] = await tx
    .select()
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .for('update');
  if (!reservation) throw new Error(`No reservation "${reservationId}" to compensate`);
  if (reservation.status !== 'active') {
    logger.warn(
      { reservationId, status: reservation.status },
      'compensateReservation: reservation is not active — already resolved, no-op',
    );
    return;
  }

  const [payment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.submissionId, submissionId))
    .limit(1);
  if (payment && payment.status === 'completed') {
    await tx.update(payments).set({ status: 'refunded' }).where(eq(payments.id, payment.id));
  }

  await tx
    .update(reservations)
    .set({ status: 'compensated' })
    .where(eq(reservations.id, reservationId));

  const [budget] = await tx
    .select()
    .from(departmentBudgets)
    .where(eq(departmentBudgets.department, department))
    .for('update');
  if (!budget) throw new Error(`No department budget for "${department}"`);

  await tx
    .update(departmentBudgets)
    .set({ reserved: (Number(budget.reserved) - amount).toFixed(2) })
    .where(eq(departmentBudgets.id, budget.id));
}
