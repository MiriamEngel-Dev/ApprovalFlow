import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/** F9/F10: full decision trail by correlation id. One row per pub/sub event received, across all
 * 11 topics — audit-service never interprets `payload`, just stores it verbatim (ARCHITECTURE.md
 * §8: "passive subscriber"). Indexed on both submission_id and correlation_id since `GET
 * /api/audit/:submissionId` (F9) and cross-service tracing both need to look up by either. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    submissionIdIdx: index('audit_events_submission_id_idx').on(table.submissionId),
    correlationIdIdx: index('audit_events_correlation_id_idx').on(table.correlationId),
  }),
);

/** A curated subset of events the submitter would care about (M8's "notification channel") — not
 * every audit_events row becomes one; see subscribers/catch-all.ts's NOTIFIABLE_TOPICS. `recipient`
 * is resolved from that submission's own InvoiceSubmitted row already stored in audit_events (no
 * cross-service call); nullable for the rare case that row hasn't arrived yet. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull(),
    recipient: varchar('recipient', { length: 256 }),
    message: varchar('message', { length: 1024 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    submissionIdIdx: index('notifications_submission_id_idx').on(table.submissionId),
  }),
);

/** Subscriber-side dedup for at-least-once pub/sub redelivery (M10) — same shape as every other
 * service's. */
export const processedEvents = pgTable('processed_events', {
  eventId: uuid('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
