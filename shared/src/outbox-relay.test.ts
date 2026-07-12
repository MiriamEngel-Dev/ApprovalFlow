import { describe, expect, it, vi } from 'vitest';
import { startOutboxRelay } from './outbox-relay.js';

const silentLogger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as import('pino').Logger;

describe('startOutboxRelay', () => {
  it('claims and publishes each fetched candidate id', async () => {
    const claimAndPublish = vi.fn().mockResolvedValue(undefined);
    let fetched = false;

    const handle = startOutboxRelay({
      intervalMs: 5,
      fetchCandidateIds: async () => {
        if (fetched) return [];
        fetched = true;
        return [1];
      },
      claimAndPublish,
      logger: silentLogger,
    });

    await vi.waitFor(() => {
      expect(claimAndPublish).toHaveBeenCalledWith(1);
    });

    handle.stop();
  });

  it('logs and continues to the next id when claimAndPublish throws (row retried next tick)', async () => {
    const error = vi.fn();
    const claimAndPublish = vi.fn().mockRejectedValue(new Error('publish failed'));

    const handle = startOutboxRelay({
      intervalMs: 5,
      fetchCandidateIds: async () => [2],
      claimAndPublish,
      logger: { error, info: vi.fn(), warn: vi.fn() } as unknown as import('pino').Logger,
    });

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled();
    });
    // The relay itself never marks anything published — that's claimAndPublish's job, and it
    // rejected, so this just proves the loop didn't crash and will retry the same id next tick.
    expect(claimAndPublish).toHaveBeenCalledWith(2);

    handle.stop();
  });

  it('a no-op claimAndPublish (row already claimed elsewhere) does not error', async () => {
    const error = vi.fn();
    const claimAndPublish = vi.fn().mockResolvedValue(undefined); // simulates SKIP LOCKED miss

    const handle = startOutboxRelay({
      intervalMs: 5,
      fetchCandidateIds: async () => [3],
      claimAndPublish,
      logger: { error, info: vi.fn(), warn: vi.fn() } as unknown as import('pino').Logger,
    });

    await vi.waitFor(() => {
      expect(claimAndPublish).toHaveBeenCalledWith(3);
    });
    expect(error).not.toHaveBeenCalled();

    handle.stop();
  });
});
