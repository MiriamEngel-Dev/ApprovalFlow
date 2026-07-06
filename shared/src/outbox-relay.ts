import type { Logger } from 'pino';

export interface OutboxRow {
  id: string | number;
  topic: string;
  payload: unknown;
  correlationId: string;
}

export interface OutboxRelayOptions {
  /** Poll interval in ms. Defaults to 1000 per ARCHITECTURE.md §7. */
  intervalMs?: number;
  /** Rows to claim per tick, via `FOR UPDATE SKIP LOCKED` in the caller's implementation. */
  fetchBatch: () => Promise<OutboxRow[]>;
  publish: (row: OutboxRow) => Promise<void>;
  markPublished: (id: OutboxRow['id']) => Promise<void>;
  logger: Logger;
}

export interface OutboxRelayHandle {
  stop: () => void;
}

/**
 * Generic outbox-relay loop, reused by submission/decision/payment services instead of each
 * hand-rolling the same 1s poll (ADR-005). Callers own the `FOR UPDATE SKIP LOCKED` fetch query
 * and the mark-published write — this only owns the timing and per-row error isolation.
 */
export function startOutboxRelay(options: OutboxRelayOptions): OutboxRelayHandle {
  const { intervalMs = 1000, fetchBatch, publish, markPublished, logger } = options;

  let stopped = false;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const rows = await fetchBatch();
      for (const row of rows) {
        try {
          await publish(row);
          await markPublished(row.id);
        } catch (err) {
          logger.error(
            { correlationId: row.correlationId, outboxId: row.id, topic: row.topic, err },
            'outbox relay: failed to publish row, will retry next tick',
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'outbox relay: failed to fetch batch');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
