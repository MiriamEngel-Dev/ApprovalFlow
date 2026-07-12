// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to audit_db per db/client.ts's env-var defaults).
import { randomUUID } from 'node:crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { TOPICS, type Topic } from '@approvalflow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { auditEvents, notifications, processedEvents } from '../db/schema.js';
import { __internal } from './catch-all.js';

const { recordEvent } = __internal;

const ALL_TOPICS: Topic[] = Object.values(TOPICS);
const NOTIFIABLE: Topic[] = [
  TOPICS.DecisionMade,
  TOPICS.ApprovalCompleted,
  TOPICS.ApprovalRejected,
  TOPICS.InfoRequested,
  TOPICS.PaymentSucceeded,
  TOPICS.PaymentFailed,
  TOPICS.PaymentCompensated,
];
const NOT_NOTIFIABLE: Topic[] = [
  TOPICS.InvoiceSubmitted,
  TOPICS.InvoiceSupplemented,
  TOPICS.InvoiceResubmitted,
  TOPICS.ApprovalTaskCreated,
];

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE audit_events, notifications, processed_events`);
});

function envelope(
  submissionId: string,
  correlationId: string,
  extra: Record<string, unknown> = {},
) {
  return { id: randomUUID(), data: { correlationId, submissionId, ...extra } };
}

describe('recordEvent — dedup (M10)', () => {
  it('is a no-op on a redelivered eventId', async () => {
    const submissionId = randomUUID();
    const correlationId = randomUUID();
    const event = envelope(submissionId, correlationId);

    await recordEvent(TOPICS.DecisionMade, event);
    await recordEvent(TOPICS.DecisionMade, event);

    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.submissionId, submissionId));
    expect(rows).toHaveLength(1);
    const processed = await db.select().from(processedEvents);
    expect(processed).toHaveLength(1);
  });
});

describe('recordEvent — every topic produces exactly one audit_events row (F9)', () => {
  it.each(ALL_TOPICS)('%s', async (topic) => {
    const submissionId = randomUUID();
    const correlationId = randomUUID();
    await recordEvent(topic, envelope(submissionId, correlationId));

    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.submissionId, submissionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe(topic);
  });
});

describe('recordEvent — notifications are a curated subset (M8)', () => {
  it.each(NOTIFIABLE)('%s produces a notification', async (topic) => {
    const submissionId = randomUUID();
    const correlationId = randomUUID();
    // Seed the InvoiceSubmitted row first so recipient resolution has something to find.
    await recordEvent(
      TOPICS.InvoiceSubmitted,
      envelope(submissionId, correlationId, { invoice: { submitter: 'dana@northwind.example' } }),
    );

    await recordEvent(topic, envelope(submissionId, correlationId));

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.submissionId, submissionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipient).toBe('dana@northwind.example');
    expect(rows[0]?.message.length).toBeGreaterThan(0);
  });

  it.each(NOT_NOTIFIABLE)('%s does not produce a notification', async (topic) => {
    const submissionId = randomUUID();
    const correlationId = randomUUID();
    await recordEvent(topic, envelope(submissionId, correlationId));

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.submissionId, submissionId));
    expect(rows).toHaveLength(0);
  });
});

describe('recordEvent — DecisionMade message reflects the route', () => {
  it('uses a route-specific message, not a generic fallback', async () => {
    const submissionId = randomUUID();
    const correlationId = randomUUID();
    await recordEvent(
      TOPICS.DecisionMade,
      envelope(submissionId, correlationId, { route: 'auto_approve' }),
    );

    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.submissionId, submissionId));
    expect(row?.message).toBe('Your submission was approved automatically.');
  });
});
