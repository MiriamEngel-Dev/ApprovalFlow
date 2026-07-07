import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { departmentBudgets, payments, reservations } from '../db/schema.js';

/**
 * Compensation (ADR-003 §"Compensation must be correct"): releases the budget hold and, if a
 * payment was actually charged before the failure, marks it refunded (a mock refund — no real
 * money moves in M15's no-paid-services constraint, but the ledger reflects the reversal so
 * `payments` stays an honest record). Runs whether triggered inline (execute declined) or by the
 * stuck-reservation scanner (timeout recovery) — both call this same function.
 */
export async function compensateReservation(
  reservationId: string,
  department: string,
  amount: number,
  submissionId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
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
  });
}
