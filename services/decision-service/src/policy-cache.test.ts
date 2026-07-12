// Unit test with mocked Dapr state calls (no live sidecar needed) — mirrors how
// shared/outbox-relay.test.ts mocks its collaborators. Verifies the 5s TTL cache, the monotonic
// `policy_version` bump (ADR-012), and the etag-based optimistic-concurrency retry on
// `updatePolicyConfig` (two concurrent admin PUTs must not silently clobber each other).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = new Map<string, { value: unknown; etag: string }>();
let etagCounter = 0;

vi.mock('@approvalflow/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@approvalflow/shared')>();
  return {
    ...actual,
    getStateWithETag: vi.fn(async (_store: string, key: string) => {
      const entry = state.get(key);
      return entry ? { value: entry.value, etag: entry.etag } : undefined;
    }),
    saveState: vi.fn(
      async (_store: string, entries: { key: string; value: unknown; etag?: string }[]) => {
        for (const entry of entries) {
          const existing = state.get(entry.key);
          if (entry.etag !== undefined && existing?.etag !== entry.etag) {
            throw new actual.StateConflictError('statestore', entry.key);
          }
          etagCounter += 1;
          state.set(entry.key, { value: entry.value, etag: String(etagCounter) });
        }
      },
    ),
  };
});

describe('policy-cache — TTL cache, version bump, and concurrent-update retry (M13, F7, ADR-012)', () => {
  beforeEach(() => {
    state.clear();
    etagCounter = 0;
    vi.resetModules();
  });

  it('seeds the state store from env defaults on first read', async () => {
    const { getPolicyConfig } = await import('./policy-cache.js');
    const policy = await getPolicyConfig();
    expect(policy.ceiling).toBe(250);
    expect(policy.confidenceThreshold).toBe(0.8);
    expect(policy.policyVersion).toBe(1);
    expect(state.get('policy:latest')?.value).toEqual(policy);
  });

  it('bumps policyVersion on every successful update, even a no-op value change', async () => {
    const { getPolicyConfig, updatePolicyConfig } = await import('./policy-cache.js');
    await getPolicyConfig();

    const updated = await updatePolicyConfig({ ceiling: 250 });
    expect(updated.ceiling).toBe(250);
    expect(updated.policyVersion).toBe(2);

    const updatedAgain = await updatePolicyConfig({ confidenceThreshold: 0.9 });
    expect(updatedAgain.confidenceThreshold).toBe(0.9);
    expect(updatedAgain.ceiling).toBe(250);
    expect(updatedAgain.policyVersion).toBe(3);
  });

  it('serves cached reads within the TTL window without re-hitting the state store', async () => {
    const shared = await import('@approvalflow/shared');
    const { getPolicyConfig } = await import('./policy-cache.js');

    await getPolicyConfig();
    const callsAfterFirst = vi.mocked(shared.getStateWithETag).mock.calls.length;
    await getPolicyConfig();
    const callsAfterSecond = vi.mocked(shared.getStateWithETag).mock.calls.length;

    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it("retries once on a stale-etag conflict and applies this call's patch on the fresher value", async () => {
    const shared = await import('@approvalflow/shared');
    const { getPolicyConfig, updatePolicyConfig } = await import('./policy-cache.js');
    await getPolicyConfig(); // seeds policyVersion 1

    const saveStateMock = vi.mocked(shared.saveState);
    const realSaveState = saveStateMock.getMockImplementation()!;
    let attempts = 0;
    saveStateMock.mockImplementation(async (storeName, entries) => {
      attempts += 1;
      if (attempts === 1) {
        // Simulate another writer's update landing between this call's read and its save.
        throw new shared.StateConflictError(storeName, entries[0]!.key);
      }
      return realSaveState(storeName, entries);
    });

    const updated = await updatePolicyConfig({ ceiling: 999 });
    expect(updated.ceiling).toBe(999);
    expect(attempts).toBe(2);
  });

  it('surfaces StateConflictError to the caller after exhausting retries', async () => {
    const shared = await import('@approvalflow/shared');
    const { getPolicyConfig, updatePolicyConfig } = await import('./policy-cache.js');
    await getPolicyConfig();

    vi.mocked(shared.saveState).mockImplementation(async (storeName, entries) => {
      throw new shared.StateConflictError(storeName, entries[0]!.key);
    });

    await expect(updatePolicyConfig({ ceiling: 999 })).rejects.toThrow(shared.StateConflictError);
  });
});
