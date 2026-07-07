import {
  createLogger,
  publishEvent,
  startOutboxRelay,
  type OutboxRelayHandle,
} from '@approvalflow/shared';
import { sql } from './db/client.js';

const logger = createLogger('decision-service');
const PUBSUB_NAME = 'pubsub';
const BATCH_SIZE = 50;

interface OutboxRow {
  id: string;
  topic: string;
  payload: unknown;
  correlationId: string;
}

/** Thin wrapper around shared/outbox-relay.ts (ADR-005) — same shape as submission-service's. */
export function startDecisionOutboxRelay(): OutboxRelayHandle {
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
