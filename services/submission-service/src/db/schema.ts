import {
  pgTable,
  uuid,
  varchar,
  numeric,
  jsonb,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Owns dedup semantics for F3/GLOBAL-DUP: `UNIQUE(vendor, invoice_number, total)` is the primary
 * defense against paying the same invoice twice (the router's own duplicate check, ADR-011, is
 * defense-in-depth for a direct decision-service invoke that bypasses this table).
 */
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingId: uuid('tracking_id').notNull().defaultRandom(),
    vendor: varchar('vendor', { length: 256 }).notNull(),
    invoiceNumber: varchar('invoice_number', { length: 128 }).notNull(),
    total: numeric('total', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    department: varchar('department', { length: 128 }).notNull(),
    submitter: varchar('submitter', { length: 256 }).notNull(),
    /** Full Invoice JSON (line items, notes, attendees, etc.) — the system of record. */
    payload: jsonb('payload').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dedupUnique: unique('submissions_dedup_unique').on(
      table.vendor,
      table.invoiceNumber,
      table.total,
    ),
    trackingIdIdx: index('submissions_tracking_id_idx').on(table.trackingId),
  }),
);

/**
 * Outbox pattern (N3, M10): written in the same transaction as the entity row it describes, then
 * relayed by a polling loop — never published directly inline with the request (ARCHITECTURE.md
 * §7).
 */
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
