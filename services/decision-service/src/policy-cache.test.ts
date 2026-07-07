// Unit test with mocked Dapr state calls (no live sidecar needed) — mirrors how
// shared/outbox-relay.test.ts mocks its collaborators. Verifies the 5s TTL cache and the
// monotonic `policy_version` bump (ADR-012), independent of any real infrastructure.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = new Map<string, unknown>();

vi.mock('@approvalflow/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@approvalflow/shared')>();
  return {
    ...actual,
    getState: vi.fn(async (_store: string, key: string) => state.get(key)),
    saveState: vi.fn(async (_store: string, entries: { key: string; value: unknown }[]) => {
      for (const entry of entries) state.set(entry.key, entry.value);
    }),
  };
});

describe('policy-cache — TTL cache and version bump (M13, F7, ADR-012)', () => {
  beforeEach(() => {
    state.clear();
    vi.resetModules();
  });

  it('seeds the state store from env defaults on first read', async () => {
    const { getPolicyConfig } = await import('./policy-cache.js');
    const policy = await getPolicyConfig();
    expect(policy.ceiling).toBe(250);
    expect(policy.confidenceThreshold).toBe(0.8);
    expect(policy.policyVersion).toBe(1);
    expect(state.get('policy:latest')).toEqual(policy);
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
    const callsAfterFirst = vi.mocked(shared.getState).mock.calls.length;
    await getPolicyConfig();
    const callsAfterSecond = vi.mocked(shared.getState).mock.calls.length;

    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});
