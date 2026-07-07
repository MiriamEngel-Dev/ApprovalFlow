/**
 * M15 (no paid services): a mock payment provider, in-process, with its own idempotent ledger —
 * calling `charge` twice with the same `idempotencyKey` returns the same result rather than
 * charging twice, mirroring how a real gateway would behave. Journey D (INV-1012) needs a
 * deterministic forced failure, not randomness (docs/IMPLEMENTATION-PLAN.md, Milestone 8) — the
 * verify harness (Milestone 14) calls `forceFailureFor(submissionId)` before submitting the
 * fixture that should exercise compensation.
 */

export type ChargeStatus = 'charged' | 'declined';

export interface ChargeResult {
  status: ChargeStatus;
  providerRef: string;
}

const ledger = new Map<string, ChargeResult>();
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
  const existing = ledger.get(idempotencyKey);
  if (existing) return existing;

  const result: ChargeResult = forcedFailures.has(submissionId)
    ? { status: 'declined', providerRef: `mock_${idempotencyKey}` }
    : { status: 'charged', providerRef: `mock_${idempotencyKey}` };

  ledger.set(idempotencyKey, result);
  return Promise.resolve(result);
}

/** Used by the stuck-reservation scanner to determine whether a stalled saga actually charged
 * before deciding to confirm vs. compensate (ADR-003's timeout-recovery query). */
export function getChargeStatus(idempotencyKey: string): ChargeResult | undefined {
  return ledger.get(idempotencyKey);
}
