import { describe, expect, it, vi } from 'vitest';
import { startOutboxRelay, type OutboxRow } from './outbox-relay.js';

const silentLogger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as import('pino').Logger;

describe('startOutboxRelay', () => {
  it('publishes each fetched row and marks it published', async () => {
    const rows: OutboxRow[] = [
      { id: 1, topic: 'InvoiceSubmitted', payload: { a: 1 }, correlationId: 'c-1' },
    ];
    const publish = vi.fn().mockResolvedValue(undefined);
    const markPublished = vi.fn().mockResolvedValue(undefined);
    let fetched = false;

    const handle = startOutboxRelay({
      intervalMs: 5,
      fetchBatch: async () => {
        if (fetched) return [];
        fetched = true;
        return rows;
      },
      publish,
      markPublished,
      logger: silentLogger,
    });

    await vi.waitFor(() => {
      expect(publish).toHaveBeenCalledWith(rows[0]);
      expect(markPublished).toHaveBeenCalledWith(1);
    });

    handle.stop();
  });

  it('logs and does not mark published when publish fails, so the row is retried', async () => {
    const row: OutboxRow = { id: 2, topic: 'DecisionMade', payload: {}, correlationId: 'c-2' };
    const markPublished = vi.fn().mockResolvedValue(undefined);
    const error = vi.fn();

    const handle = startOutboxRelay({
      intervalMs: 5,
      fetchBatch: async () => [row],
      publish: async () => {
        throw new Error('publish failed');
      },
      markPublished,
      logger: { error, info: vi.fn(), warn: vi.fn() } as unknown as import('pino').Logger,
    });

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled();
    });
    expect(markPublished).not.toHaveBeenCalled();

    handle.stop();
  });
});
