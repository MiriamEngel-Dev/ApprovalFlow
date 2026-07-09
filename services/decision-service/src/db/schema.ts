import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  jsonb,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Versioned decision trail (F9). `UNIQUE(submission_id, version)` lets a re-assessment (after a
 * request-info -> supplement loop) add a new row instead of overwriting history. `policy_snapshot`
 * is the {ceiling, confidence_threshold, policy_version} in force when THIS row's router ran
 * (ADR-012) — closes the F9/F10 proof gap left by only tracking `policy:latest`.
 */
export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull(),
    version: integer('version').notNull().default(1),
    route: varchar('route', { length: 16 }).notNull(),
    agentRecommendation: varchar('agent_recommendation', { length: 16 }).notNull(),
    agentConfidence: numeric('agent_confidence', { precision: 4, scale: 3 }).notNull(),
    agentReasoning: varchar('agent_reasoning', { length: 2048 }).notNull(),
    rulesCited: jsonb('rules_cited').notNull(),
    violations: jsonb('violations').notNull(),
    policySnapshot: jsonb('policy_snapshot').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    submissionVersionUnique: unique('decisions_submission_version_unique').on(
      table.submissionId,
      table.version,
    ),
    submissionIdIdx: index('decisions_submission_id_idx').on(table.submissionId),
    routeCheck: check(
      'decisions_route_check',
      sql`${table.route} IN ('auto_approve', 'human_review', 'reject', 'duplicate')`,
    ),
  }),
);

/**
 * Current HITL workflow state (M11) — single row per submission (not versioned like `decisions`;
 * this is "where the workflow is now," not history). All state lives here in PostgreSQL, so a
 * service restart between pause and resume is transparent (F5).
 */
export const approvalQueue = pgTable(
  'approval_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    /** Carried on the row (not re-derived at approve-time) so `approveQueueItem` can publish
     * `ApprovalCompleted` with what payment-service's saga trigger needs (ADR-003) without a
     * second lookup — set once, from the normalized invoice already in hand, when the row is
     * created in pipeline.ts. */
    department: varchar('department', { length: 128 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    approverId: varchar('approver_id', { length: 256 }),
    approverNote: varchar('approver_note', { length: 2048 }),
    requestInfoNote: varchar('request_info_note', { length: 2048 }),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    submissionUnique: unique('approval_queue_submission_unique').on(table.submissionId),
    // 'superseded': a re-assessment (after a supplement) resolved this item to a route other than
    // human_review — the router auto-resolved it, not a human, so it doesn't belong in
    // 'approved'/'rejected' (those specifically mean a human acted). Without this, a queue item
    // paused on `info_requested` that a supplement later makes auto_approve-eligible would stay
    // stuck at `info_requested` forever, even though it was already paid (pipeline.ts).
    statusCheck: check(
      'approval_queue_status_check',
      sql`${table.status} IN ('pending', 'approved', 'rejected', 'info_requested', 'superseded')`,
    ),
  }),
);

/** Outbox pattern (N3, M10) — same shape as submission-service's (ADR-005). */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: varchar('topic', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => ({
    unpublishedIdx: index('outbox_unpublished_idx').on(table.publishedAt),
  }),
);

/** Subscriber-side dedup for at-least-once pub/sub redelivery (M10). */
export const processedEvents = pgTable('processed_events', {
  eventId: uuid('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
