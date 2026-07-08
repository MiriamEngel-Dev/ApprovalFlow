import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { departmentBudgets, reservations } from '../db/schema.js';

export type ReserveResult =
  { status: 'reserved'; reservationId: string } | { status: 'insufficient_budget' };

/**
 * Step 1 of the saga (ADR-003, ADR-004): `SELECT ... FOR UPDATE` row-locks the department budget
 * so concurrent sagas serialize on it — this is what makes INV-1014A+B ($600 each vs. $1,000
 * budget) resolve to exactly one reservation with no overspend, proven by the
 * `CHECK(reserved+spent<=total)` constraint as a database-level backstop.
 *
 * Takes an existing `tx` rather than opening its own transaction, so the caller can compose this
 * with the `processed_events` dedup write in one atomic transaction (pipeline.ts) — a crash
 * between marking an event processed and reserving budget must not be possible.
 */
export async function reserveBudget(
  tx: Tx,
  submissionId: string,
  department: string,
  amount: number,
  correlationId: string,
): Promise<ReserveResult> {
  const [budget] = await tx
    .select()
    .from(departmentBudgets)
    .where(eq(departmentBudgets.department, department))
    .for('update');
  if (!budget) throw new Error(`No department budget seeded for "${department}"`);

  const remaining = Number(budget.total) - Number(budget.reserved) - Number(budget.spent);
  if (remaining < amount) {
    return { status: 'insufficient_budget' };
  }

  await tx
    .update(departmentBudgets)
    .set({ reserved: (Number(budget.reserved) + amount).toFixed(2) })
    .where(eq(departmentBudgets.id, budget.id));

  const [reservation] = await tx
    .insert(reservations)
    .values({ submissionId, department, amount: amount.toFixed(2), correlationId })
    .returning({ id: reservations.id });
  if (!reservation) throw new Error('Insert into reservations returned no row');

  return { status: 'reserved', reservationId: reservation.id };
}
