import {
  getStateWithETag,
  saveState,
  StateConflictError,
  type PolicyConfig,
} from '@approvalflow/shared';

const STATE_STORE = 'statestore';
const POLICY_KEY = 'policy:latest';
const CACHE_TTL_MS = 5000;
const MAX_UPDATE_ATTEMPTS = 3;

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

  const stored = await getStateWithETag<PolicyConfig>(STATE_STORE, POLICY_KEY);
  const value = stored?.value ?? DEFAULT_POLICY;
  if (!stored) {
    await saveState(STATE_STORE, [{ key: POLICY_KEY, value }]);
  }

  cached = value;
  cachedAt = now;
  return value;
}

/**
 * `policy_version` is a monotonic integer bumped on every successful PUT (ADR-012) — lets two
 * decisions with identical threshold values still be distinguished if a controller made a
 * no-op change.
 *
 * Read-modify-write against Dapr state with optimistic concurrency (etag) — without this, two
 * admins' concurrent PUTs both read the same starting value and the second `saveState` silently
 * clobbers the first's change outright (not just the version bump). On a conflict, re-read the
 * now-current value and reapply this call's patch on top of it, up to `MAX_UPDATE_ATTEMPTS` times
 * — genuinely concurrent PUTs to the same key are rare enough that a few retries resolve it
 * without the caller ever seeing a failure.
 */
export async function updatePolicyConfig(
  patch: Partial<Pick<PolicyConfig, 'ceiling' | 'confidenceThreshold'>>,
): Promise<PolicyConfig> {
  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
    const current = await getStateWithETag<PolicyConfig>(STATE_STORE, POLICY_KEY);
    const currentValue = current?.value ?? DEFAULT_POLICY;
    const updated: PolicyConfig = {
      ceiling: patch.ceiling ?? currentValue.ceiling,
      confidenceThreshold: patch.confidenceThreshold ?? currentValue.confidenceThreshold,
      policyVersion: currentValue.policyVersion + 1,
    };

    try {
      await saveState(STATE_STORE, [
        { key: POLICY_KEY, value: updated, ...(current?.etag ? { etag: current.etag } : {}) },
      ]);
      cached = updated;
      cachedAt = Date.now();
      return updated;
    } catch (err) {
      if (err instanceof StateConflictError && attempt < MAX_UPDATE_ATTEMPTS) continue;
      throw err;
    }
  }
  /* istanbul ignore next -- unreachable: the loop above always returns or throws */
  throw new Error('updatePolicyConfig: exhausted retries without resolving');
}

/** Test-only escape hatch — production code never needs to reset the cache mid-process. */
export function _resetPolicyCacheForTests(): void {
  cached = undefined;
  cachedAt = 0;
}
