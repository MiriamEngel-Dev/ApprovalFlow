import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { departmentBudgets, reservations } from '../db/schema.js';

/** Step 3 (happy path): reservation moves from `active` to `confirmed`; the budget's hold
 * (`reserved`) converts into an actual spend (`spent`) — the net budget effect is unchanged, only
 * its classification moves, per ARCHITECTURE.md §4's saga table.
 *
 * Takes an existing `tx` so the caller can commit this together with the `PaymentSucceeded`
 * outbox row in one atomic transaction (pipeline.ts and the stuck-reservation scanner both do
 * this) — a crash between confirming and publishing must not be possible. */
export async function confirmReservation(
  tx: Tx,
  reservationId: string,
  department: string,
  amount: number,
): Promise<void> {
  await tx
    .update(reservations)
    .set({ status: 'confirmed' })
    .where(eq(reservations.id, reservationId));

  const [budget] = await tx
    .select()
    .from(departmentBudgets)
    .where(eq(departmentBudgets.department, department))
    .for('update');
  if (!budget) throw new Error(`No department budget for "${department}"`);

  await tx
    .update(departmentBudgets)
    .set({
      reserved: (Number(budget.reserved) - amount).toFixed(2),
      spent: (Number(budget.spent) + amount).toFixed(2),
    })
    .where(eq(departmentBudgets.id, budget.id));
}
