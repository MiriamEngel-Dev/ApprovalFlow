import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { TOPICS, type Topic } from '@approvalflow/shared';
import { db, type Tx } from '../db/client.js';
import { auditEvents, notifications, processedEvents } from '../db/schema.js';

const PUBSUB_NAME = 'pubsub';

interface CloudEvent<T> {
  id: string;
  data: T;
}

interface EventPayload {
  correlationId: string;
  submissionId: string;
  [key: string]: unknown;
}

/** Topics the submitter would actually care about (M8's "notification channel") — the other 4
 * (InvoiceSubmitted/Supplemented/Resubmitted are the submitter's own actions; ApprovalTaskCreated
 * is internal, not submitter-facing) still get an audit_events row but no notification. */
const NOTIFIABLE_TOPICS = new Set<Topic>([
  TOPICS.DecisionMade,
  TOPICS.ApprovalCompleted,
  TOPICS.ApprovalRejected,
  TOPICS.InfoRequested,
  TOPICS.PaymentSucceeded,
  TOPICS.PaymentFailed,
  TOPICS.PaymentCompensated,
]);

const ROUTE_MESSAGES: Record<string, string> = {
  auto_approve: 'Your submission was approved automatically.',
  human_review: 'Your submission has been escalated for human review.',
  reject: 'Your submission was rejected by policy.',
  duplicate: 'Your submission was flagged as a duplicate.',
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Deterministic per-topic message — same spirit as shared/reason-template.ts (built only from
 * known payload fields, never echoing arbitrary submitter-supplied text unfiltered). */
function buildMessage(topic: Topic, payload: EventPayload): string {
  switch (topic) {
    case TOPICS.DecisionMade: {
      const route = asString(payload.route);
      return (route && ROUTE_MESSAGES[route]) ?? 'A decision was made on your submission.';
    }
    case TOPICS.ApprovalCompleted:
      return 'Your submission was approved by a reviewer.';
    case TOPICS.ApprovalRejected: {
      const note = asString(payload.note);
      return note
        ? `Your submission was rejected by a reviewer: ${note}`
        : 'Your submission was rejected by a reviewer.';
    }
    case TOPICS.InfoRequested: {
      const note = asString(payload.note);
      return note
        ? `More information was requested: ${note}`
        : 'More information was requested for your submission.';
    }
    case TOPICS.PaymentSucceeded:
      return 'Payment completed.';
    case TOPICS.PaymentFailed: {
      const reason = asString(payload.reason);
      return reason ? `Payment failed: ${reason}` : 'Payment failed.';
    }
    case TOPICS.PaymentCompensated:
      return 'Your payment reservation was released.';
    default:
      return 'An update was recorded for your submission.';
  }
}

/** Looks up the submitter's email from this submission's own InvoiceSubmitted row, already stored
 * in audit_events — no cross-service call, audit-service stays a passive subscriber
 * (ARCHITECTURE.md §8). Returns undefined if that row hasn't arrived yet (redelivery/ordering
 * edge case) rather than blocking the current event's ingestion on it. */
async function resolveRecipient(tx: Tx, submissionId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ payload: auditEvents.payload })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.submissionId, submissionId),
        eq(auditEvents.eventType, TOPICS.InvoiceSubmitted),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  if (!row) return undefined;
  const payload = row.payload as { invoice?: { submitter?: unknown } };
  return asString(payload.invoice?.submitter);
}

/**
 * Shared ingestion logic for all 11 topics (M10, F9). Marking the event processed and inserting
 * the audit_events (+ optional notifications) row happen in one transaction — a crash in between
 * must not be able to silently drop the audit trail, same reasoning as every other service's
 * dedup pattern in this codebase.
 */
async function recordEvent(topic: Topic, envelope: CloudEvent<EventPayload>): Promise<void> {
  await db.transaction(async (tx) => {
    const already = await tx
      .select({ eventId: processedEvents.eventId })
      .from(processedEvents)
      .where(eq(processedEvents.eventId, envelope.id))
      .limit(1);
    if (already.length > 0) return;
    await tx.insert(processedEvents).values({ eventId: envelope.id });

    const { correlationId, submissionId } = envelope.data;
    await tx.insert(auditEvents).values({
      submissionId,
      eventType: topic,
      payload: envelope.data,
      correlationId,
    });

    if (NOTIFIABLE_TOPICS.has(topic)) {
      const recipient = await resolveRecipient(tx, submissionId);
      await tx.insert(notifications).values({
        submissionId,
        recipient: recipient ?? null,
        message: buildMessage(topic, envelope.data),
        eventType: topic,
        correlationId,
      });
    }
  });
}

const TOPIC_ROUTES: Array<{ topic: Topic; route: string }> = [
  { topic: TOPICS.InvoiceSubmitted, route: '/events/invoice-submitted' },
  { topic: TOPICS.InvoiceSupplemented, route: '/events/invoice-supplemented' },
  { topic: TOPICS.InvoiceResubmitted, route: '/events/invoice-resubmitted' },
  { topic: TOPICS.DecisionMade, route: '/events/decision-made' },
  { topic: TOPICS.ApprovalTaskCreated, route: '/events/approval-task-created' },
  { topic: TOPICS.ApprovalCompleted, route: '/events/approval-completed' },
  { topic: TOPICS.ApprovalRejected, route: '/events/approval-rejected' },
  { topic: TOPICS.InfoRequested, route: '/events/info-requested' },
  { topic: TOPICS.PaymentSucceeded, route: '/events/payment-succeeded' },
  { topic: TOPICS.PaymentFailed, route: '/events/payment-failed' },
  { topic: TOPICS.PaymentCompensated, route: '/events/payment-compensated' },
];

/** Dapr pub/sub subscription (ARCHITECTURE.md §3, §6) — all 11 topics, each a thin route into the
 * one shared `recordEvent` above (kept in this one file per docs/IMPLEMENTATION-PLAN.md's
 * Milestone 10 naming, `subscribers/catch-all.ts`). */
export function registerCatchAllSubscriber(app: FastifyInstance): void {
  app.get('/dapr/subscribe', async () =>
    TOPIC_ROUTES.map(({ topic, route }) => ({ pubsubname: PUBSUB_NAME, topic, route })),
  );

  for (const { topic, route } of TOPIC_ROUTES) {
    app.post<{ Body: CloudEvent<EventPayload> }>(route, async (request, reply) => {
      await recordEvent(topic, request.body);
      return reply.status(200).send();
    });
  }
}

// Re-exported for tests only — avoids a second copy of the dedup+insert logic in test setup.
export const __internal = { recordEvent };
