import {
  createLogger,
  publishEvent,
  startOutboxRelay,
  type OutboxRelayHandle,
} from '@approvalflow/shared';
import { sql } from './db/client.js';

const logger = createLogger('submission-service');
const PUBSUB_NAME = 'pubsub';
const BATCH_SIZE = 50;

/** Thin wrapper around shared/outbox-relay.ts (ADR-005) — same shape as decision-service's and
 * payment-service's. The candidate read is unlocked (cheap, no protection needed yet); the real
 * lock lives inside `claimAndPublish`'s own transaction, held for the duration of the publish —
 * that's what actually makes this safe across ticks/replicas (ADR-013). */
export function startSubmissionOutboxRelay(): OutboxRelayHandle {
  return startOutboxRelay({
    intervalMs: 1000,
    logger,
    fetchCandidateIds: async (): Promise<string[]> => {
      const rows = await sql<{ id: string }[]>`
        SELECT id
        FROM outbox
        WHERE published_at IS NULL
        ORDER BY created_at
        LIMIT ${BATCH_SIZE}
      `;
      return rows.map((row) => row.id);
    },
    claimAndPublish: async (id): Promise<void> => {
      await sql.begin(async (tx) => {
        const [row] = await tx`
          SELECT id, topic, payload, correlation_id AS "correlationId"
          FROM outbox
          WHERE id = ${id} AND published_at IS NULL
          FOR UPDATE SKIP LOCKED
        `;
        if (!row) return; // already claimed by another tick/replica, or already published

        await publishEvent(
          PUBSUB_NAME,
          row.topic as string,
          row.payload,
          row.correlationId as string,
        );
        await tx`UPDATE outbox SET published_at = NOW() WHERE id = ${id}`;
      });
    },
  });
}
