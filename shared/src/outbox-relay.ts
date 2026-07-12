import type { Logger } from 'pino';

export interface OutboxRelayOptions {
  /** Poll interval in ms. Defaults to 1000 per ARCHITECTURE.md §7. */
  intervalMs?: number;
  /** Cheap, unlocked read of candidate row ids that look ready to publish. Not authoritative —
   * `claimAndPublish` re-checks each one under a real lock. */
  fetchCandidateIds: () => Promise<(string | number)[]>;
  /**
   * Re-locks this specific row (`SELECT ... WHERE id = $1 FOR UPDATE SKIP LOCKED`) inside one
   * transaction, publishes it, and marks it published — all atomically, so the lock actually
   * covers the work it's meant to protect. A no-op is expected and fine when the row was already
   * claimed by a concurrent tick or replica, or already published between the candidate read and
   * this call.
   */
  claimAndPublish: (id: string | number) => Promise<void>;
  logger: Logger;
}

export interface OutboxRelayHandle {
  stop: () => void;
}

/**
 * Generic outbox-relay loop, reused by submission/decision/payment services instead of each
 * hand-rolling the same 1s poll (ADR-005). Split into an unlocked candidate read + a per-row
 * claim-and-publish that owns its own transaction (ADR-013) — a single bare `SELECT ... FOR
 * UPDATE SKIP LOCKED` outside a transaction autocommits immediately with the `postgres` client,
 * releasing the lock before the row is actually published, so two overlapping ticks (or two
 * replicas) could both publish the same row. This two-phase shape is what the stuck-reservation
 * scanner in payment-service already does for the same reason — mirrored here.
 */
export function startOutboxRelay(options: OutboxRelayOptions): OutboxRelayHandle {
  const { intervalMs = 1000, fetchCandidateIds, claimAndPublish, logger } = options;

  let stopped = false;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const ids = await fetchCandidateIds();
      for (const id of ids) {
        try {
          await claimAndPublish(id);
        } catch (err) {
          logger.error(
            { outboxId: id, err },
            'outbox relay: failed to publish row, will retry next tick',
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'outbox relay: failed to fetch candidates');
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
