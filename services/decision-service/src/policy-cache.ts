import { getState, saveState, type PolicyConfig } from '@approvalflow/shared';

const STATE_STORE = 'statestore';
const POLICY_KEY = 'policy:latest';
const CACHE_TTL_MS = 5000;

const DEFAULT_POLICY: PolicyConfig = {
  ceiling: Number(process.env.AUTONOMY_CEILING ?? 250),
  confidenceThreshold: Number(process.env.AUTONOMY_CONFIDENCE ?? 0.8),
  policyVersion: 1,
};

let cached: PolicyConfig | undefined;
let cachedAt = 0;

/**
 * Externally configurable ceiling/threshold (M13, F7) — cached for 5s over Dapr state so every
 * decision doesn't round-trip to Redis, but a `PUT /api/policy` change is visible within one
 * cache window without a redeploy. Seeds the state store from env defaults on first read so a
 * fresh `docker compose up` doesn't require a manual `PUT` before anything can auto-approve.
 */
export async function getPolicyConfig(): Promise<PolicyConfig> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  let stored = await getState<PolicyConfig>(STATE_STORE, POLICY_KEY);
  if (!stored) {
    stored = DEFAULT_POLICY;
    await saveState(STATE_STORE, [{ key: POLICY_KEY, value: stored }]);
  }

  cached = stored;
  cachedAt = now;
  return stored;
}

/** `policy_version` is a monotonic integer bumped on every successful PUT (ADR-012) — lets two
 * decisions with identical threshold values still be distinguished if a controller made a
 * no-op change. */
export async function updatePolicyConfig(
  patch: Partial<Pick<PolicyConfig, 'ceiling' | 'confidenceThreshold'>>,
): Promise<PolicyConfig> {
  const current = await getPolicyConfig();
  const updated: PolicyConfig = {
    ceiling: patch.ceiling ?? current.ceiling,
    confidenceThreshold: patch.confidenceThreshold ?? current.confidenceThreshold,
    policyVersion: current.policyVersion + 1,
  };
  await saveState(STATE_STORE, [{ key: POLICY_KEY, value: updated }]);
  cached = updated;
  cachedAt = Date.now();
  return updated;
}

/** Test-only escape hatch — production code never needs to reset the cache mid-process. */
export function _resetPolicyCacheForTests(): void {
  cached = undefined;
  cachedAt = 0;
}
