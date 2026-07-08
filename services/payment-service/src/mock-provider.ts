import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { providerCharges } from './db/schema.js';

/**
 * M15 (no paid services): a mock payment provider with its own idempotent ledger — calling
 * `charge` twice with the same `idempotencyKey` returns the same result rather than charging
 * twice, mirroring how a real gateway would behave. The ledger is persisted in Postgres
 * (`provider_charges`), not an in-memory Map: the stuck-reservation scanner's recovery strategy is
 * "ask the provider by idempotency key whether the charge went through," and that answer must
 * survive a process restart — the exact scenario the scanner exists to recover from. Journey D
 * (INV-1012) needs a deterministic forced failure, not randomness (docs/IMPLEMENTATION-PLAN.md,
 * Milestone 8) — the verify harness (Milestone 14) calls `forceFailureFor(submissionId)` before
 * submitting the fixture that should exercise compensation. `forceFailureFor` stays in-memory: it's
 * a test-harness control for a single `npm run verify` run, not real provider state.
 */

export type ChargeStatus = 'charged' | 'declined';

export interface ChargeResult {
  status: ChargeStatus;
  providerRef: string;
}

const forcedFailures = new Set<string>();

/** Registers a submission whose next payment attempt must be declined — deterministic, not
 * random, so Journey D's compensation path is reproducible on every `npm run verify` run. */
export function forceFailureFor(submissionId: string): void {
  forcedFailures.add(submissionId);
}

export async function charge(
  submissionId: string,
  idempotencyKey: string,
  _amount: number,
): Promise<ChargeResult> {
  const existing = await getChargeStatus(idempotencyKey);
  if (existing) return existing;

  const result: ChargeResult = forcedFailures.has(submissionId)
    ? { status: 'declined', providerRef: `mock_${idempotencyKey}` }
    : { status: 'charged', providerRef: `mock_${idempotencyKey}` };

  // Insert-or-return-existing: a concurrent duplicate charge() call for the same idempotencyKey
  // hits the primary key and takes whatever row won the race, rather than erroring.
  const [row] = await db
    .insert(providerCharges)
    .values({ idempotencyKey, status: result.status, providerRef: result.providerRef })
    .onConflictDoNothing({ target: providerCharges.idempotencyKey })
    .returning();
  if (row) return { status: row.status as ChargeStatus, providerRef: row.providerRef };

  const winner = await getChargeStatus(idempotencyKey);
  if (!winner)
    throw new Error(`provider_charges row for "${idempotencyKey}" vanished after conflict`);
  return winner;
}

/** Used by the stuck-reservation scanner to determine whether a stalled saga actually charged
 * before deciding to confirm vs. compensate (ADR-003's timeout-recovery query). Durable — reads
 * from Postgres, so it answers correctly even after a process restart. */
export async function getChargeStatus(idempotencyKey: string): Promise<ChargeResult | undefined> {
  const [row] = await db
    .select()
    .from(providerCharges)
    .where(eq(providerCharges.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!row) return undefined;
  return { status: row.status as ChargeStatus, providerRef: row.providerRef };
}
