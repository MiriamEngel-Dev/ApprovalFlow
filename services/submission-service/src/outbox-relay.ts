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

interface OutboxRow {
  id: string;
  topic: string;
  payload: unknown;
  correlationId: string;
}

/**
 * Thin wrapper around shared/outbox-relay.ts (ADR-005 — same shape reused by decision-service and
 * payment-service). `FOR UPDATE SKIP LOCKED` is what lets N replicas partition this work safely
 * (ADR-013); with the single replica this service ships with today, the narrow window between
 * this SELECT's transaction committing and the row actually being marked published is not
 * exercised, but the query is written the multi-replica-safe way regardless.
 */
export function startSubmissionOutboxRelay(): OutboxRelayHandle {
  return startOutboxRelay({
    intervalMs: 1000,
    logger,
    fetchBatch: async (): Promise<OutboxRow[]> => {
      const rows = await sql`
        SELECT id, topic, payload, correlation_id AS "correlationId"
        FROM outbox
        WHERE published_at IS NULL
        ORDER BY created_at
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;
      return rows.map((row) => ({
        id: row.id as string,
        topic: row.topic as string,
        payload: row.payload,
        correlationId: row.correlationId as string,
      }));
    },
    publish: async (row) => {
      await publishEvent(PUBSUB_NAME, row.topic, row.payload, row.correlationId);
    },
    markPublished: async (id) => {
      await sql`UPDATE outbox SET published_at = NOW() WHERE id = ${id}`;
    },
  });
}
