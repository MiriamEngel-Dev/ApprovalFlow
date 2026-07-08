import {
  pgTable,
  uuid,
  varchar,
  numeric,
  jsonb,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Saga state (ADR-003, ADR-004). `CHECK(reserved+spent<=total)` is a database-level invariant —
 * enforced even if application logic has a bug, not just relied on via row-locking discipline.
 * The non-negativity checks are the same idea applied to the lower bound: normal saga flow
 * (reserve increments `reserved`; confirm moves `reserved`->`spent`; compensate decrements
 * `reserved`) should never drive either column negative, but a double-confirm/double-compensate
 * bug (bypassing the `processed_events`/`UNIQUE(submission_id)` dedup upstream) would — this
 * CHECK makes that impossible regardless of what application code does.
 */
export const departmentBudgets = pgTable(
  'department_budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    department: varchar('department', { length: 128 }).notNull(),
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    reserved: numeric('reserved', { precision: 14, scale: 2 }).notNull().default('0'),
    spent: numeric('spent', { precision: 14, scale: 2 }).notNull().default('0'),
  },
  (table) => ({
    departmentUnique: unique('department_budgets_department_unique').on(table.department),
    budgetCheck: check(
      'department_budgets_no_overspend_check',
      sql`${table.reserved} + ${table.spent} <= ${table.total}`,
    ),
    nonNegativeCheck: check(
      'department_budgets_non_negative_check',
      sql`${table.reserved} >= 0 AND ${table.spent} >= 0`,
    ),
  }),
);

/**
 * One row per submission's saga attempt (ADR-003). `UNIQUE(submission_id)` is the idempotency
 * anchor: a redelivered `DecisionMade`/`ApprovalCompleted` for the same submission can't start a
 * second saga.
 */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull(),
    department: varchar('department', { length: 128 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    sagaId: uuid('saga_id').notNull().defaultRandom(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    submissionUnique: unique('reservations_submission_unique').on(table.submissionId),
    statusIdx: index('reservations_status_idx').on(table.status, table.createdAt),
    statusCheck: check(
      'reservations_status_check',
      sql`${table.status} IN ('active', 'confirmed', 'released', 'compensated')`,
    ),
  }),
);

/** `UNIQUE(idempotency_key)` is what makes a retried payment attempt a no-op at the provider
 * boundary (M10) — the mock provider itself also dedups by this key (mock-provider.ts). */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 256 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyKeyUnique: unique('payments_idempotency_key_unique').on(table.idempotencyKey),
    statusCheck: check('payments_status_check', sql`${table.status} IN ('completed', 'refunded')`),
  }),
);

/** Durable ledger for the mock payment provider (M9, M11). Keyed by `idempotencyKey` so `charge()`
 * is naturally idempotent across retries. Persisted (not an in-memory Map) because the
 * stuck-reservation scanner's whole recovery strategy is "ask the provider by idempotency key
 * whether the charge went through" — that answer has to survive a process restart, the exact
 * scenario the scanner exists to recover from. */
export const providerCharges = pgTable(
  'provider_charges',
  {
    idempotencyKey: varchar('idempotency_key', { length: 256 }).primaryKey(),
    status: varchar('status', { length: 16 }).notNull(),
    providerRef: varchar('provider_ref', { length: 256 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'provider_charges_status_check',
      sql`${table.status} IN ('charged', 'declined')`,
    ),
  }),
);

/** Outbox pattern (N3, M10) — same shape as submission-service's/decision-service's (ADR-005). */
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
