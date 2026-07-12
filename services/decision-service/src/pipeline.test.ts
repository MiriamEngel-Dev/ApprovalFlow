// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to decision_db per db/client.ts's env-var defaults). Same convention as
// submission-service's idempotency.test.ts. A fixed `policyOverride` is passed to every call so
// this test never needs a live Dapr sidecar — policy-cache.ts's own caching/version-bump behavior
// is covered separately in policy-cache.test.ts with mocked state calls.
import { randomUUID } from 'node:crypto';
import { and, eq, sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentAssessment, Invoice, PolicyConfig } from '@approvalflow/shared';
import { db } from './db/client.js';
import { decisions, approvalQueue, outbox } from './db/schema.js';
import { processInvoiceEvent, type InboundInvoiceEvent } from './pipeline.js';
import type { AgentProvider } from './providers/index.js';

const POLICY: PolicyConfig = { ceiling: 250, confidenceThreshold: 0.8, policyVersion: 7 };

const AUTO_APPROVE_INVOICE: Invoice = {
  vendor: 'Bistro 19',
  vendorKnown: true,
  invoiceNumber: 'NW-INV-7781',
  currency: 'USD',
  category: 'meals',
  department: 'engineering-2026Q2',
  submitter: 'dana.cohen@northwind.example',
  lineItems: [{ description: 'Team lunch', quantity: 1, unitPrice: 38.89 }],
  taxAmount: 3.11,
  total: 42.0,
  receiptPresent: true,
  date: '2026-05-12',
  attendees: 1,
};

const HUMAN_REVIEW_INVOICE: Invoice = {
  vendor: 'Dell',
  vendorKnown: true,
  invoiceNumber: 'NW-INV-7795',
  currency: 'USD',
  category: 'hardware',
  department: 'engineering-2026Q2',
  submitter: 'dana.cohen@northwind.example',
  lineItems: [{ description: 'Developer laptop', quantity: 1, unitPrice: 1400.0 }],
  taxAmount: 0,
  total: 1400.0,
  receiptPresent: true,
  date: '2026-05-13',
};

function fakeProvider(assessment: AgentAssessment): AgentProvider {
  return { assess: async () => assessment };
}

const APPROVE_ASSESSMENT: AgentAssessment = {
  recommendation: 'approve',
  confidence: 0.94,
  reasoning: 'Solo working lunch, under per-attendee cap, known vendor, receipt present.',
  rulesCited: ['MEAL-01'],
  violations: [],
};

function submittedEvent(
  invoice: Invoice,
  overrides: Partial<InboundInvoiceEvent> = {},
): InboundInvoiceEvent {
  return {
    eventId: randomUUID(),
    correlationId: randomUUID(),
    submissionId: randomUUID(),
    kind: 'submitted',
    invoice,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE decisions, approval_queue, outbox, processed_events`);
});

describe('processInvoiceEvent — auto-approve path (M12, ADR-012)', () => {
  it('inserts a decisions row with the injected policy snapshot and no approval_queue row', async () => {
    const event = submittedEvent(AUTO_APPROVE_INVOICE);

    const result = await processInvoiceEvent(event, fakeProvider(APPROVE_ASSESSMENT), POLICY);
    expect(result.status).toBe('processed');

    const [decision] = await db.select().from(decisions);
    expect(decision?.route).toBe('auto_approve');
    expect(decision?.version).toBe(1);
    expect(decision?.policySnapshot).toEqual(POLICY);

    const queueRows = await db.select().from(approvalQueue);
    expect(queueRows).toHaveLength(0);

    const outboxRows = await db.select().from(outbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.topic).toBe('DecisionMade');

    // F4/F9: audit-service (a passive subscriber) can only ever store what this payload carries —
    // without these fields on the wire, the audit trail's "rules applied, the agent's reasoning"
    // is silently incomplete even though `decisions` itself has the data.
    const payload = outboxRows[0]?.payload as Record<string, unknown>;
    expect(payload.agentRecommendation).toBe('approve');
    expect(payload.agentConfidence).toBe(0.94);
    expect(payload.agentReasoning).toBe(APPROVE_ASSESSMENT.reasoning);
    expect(payload.rulesCited).toEqual(['MEAL-01']);
    expect(payload.violations).toEqual([]);
  });
});

describe('processInvoiceEvent — human-review path (M11, F4)', () => {
  it('creates a pending approval_queue row and publishes ApprovalTaskCreated', async () => {
    const event = submittedEvent(HUMAN_REVIEW_INVOICE);

    await processInvoiceEvent(event, fakeProvider(APPROVE_ASSESSMENT), POLICY);

    const [decision] = await db.select().from(decisions);
    expect(decision?.route).toBe('human_review');

    const [queueItem] = await db.select().from(approvalQueue);
    expect(queueItem?.status).toBe('pending');
    expect(queueItem?.submissionId).toBe(event.submissionId);

    const outboxTopics = (await db.select().from(outbox)).map((row) => row.topic);
    expect(outboxTopics).toContain('DecisionMade');
    expect(outboxTopics).toContain('ApprovalTaskCreated');
  });
});

describe('processInvoiceEvent — event dedup (M10)', () => {
  it('is a no-op on a redelivered eventId — no second decision, no second outbox row', async () => {
    const event = submittedEvent(AUTO_APPROVE_INVOICE);

    const first = await processInvoiceEvent(event, fakeProvider(APPROVE_ASSESSMENT), POLICY);
    const second = await processInvoiceEvent(event, fakeProvider(APPROVE_ASSESSMENT), POLICY);

    expect(first.status).toBe('processed');
    expect(second.status).toBe('duplicate-event');

    expect(await db.select().from(decisions)).toHaveLength(1);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it('two truly concurrent redeliveries of the same eventId still produce exactly one decision', async () => {
    const event = submittedEvent(AUTO_APPROVE_INVOICE);

    const [first, second] = await Promise.all([
      processInvoiceEvent(event, fakeProvider(APPROVE_ASSESSMENT), POLICY),
      processInvoiceEvent(event, fakeProvider(APPROVE_ASSESSMENT), POLICY),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(['duplicate-event', 'processed']);
    expect(await db.select().from(decisions)).toHaveLength(1);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });
});

describe('processInvoiceEvent — re-assessment supersedes an in-flight queue item (F5)', () => {
  const LOW_CONFIDENCE_ASSESSMENT: AgentAssessment = {
    recommendation: 'review',
    confidence: 0.5,
    reasoning: 'Ambiguous category.',
    rulesCited: [],
    violations: [],
  };

  it('marks a pending/info_requested queue row superseded when a supplement resolves it to auto_approve', async () => {
    const submissionId = randomUUID();
    const correlationId = randomUUID();

    const firstEvent = submittedEvent(AUTO_APPROVE_INVOICE, {
      submissionId,
      correlationId,
      kind: 'submitted',
    });
    await processInvoiceEvent(firstEvent, fakeProvider(LOW_CONFIDENCE_ASSESSMENT), POLICY);

    const [queueBefore] = await db
      .select()
      .from(approvalQueue)
      .where(eq(approvalQueue.submissionId, submissionId));
    expect(queueBefore?.status).toBe('pending');

    // Simulate an approver's request-info round having already paused it (queue-actions.ts owns
    // this transition in production; setting it directly keeps this test scoped to pipeline.ts).
    await db
      .update(approvalQueue)
      .set({ status: 'info_requested' })
      .where(eq(approvalQueue.id, queueBefore!.id));

    const secondEvent = submittedEvent(AUTO_APPROVE_INVOICE, {
      submissionId,
      correlationId,
      kind: 'supplemented',
      eventId: randomUUID(),
    });
    await processInvoiceEvent(secondEvent, fakeProvider(APPROVE_ASSESSMENT), POLICY);

    const [decisionV2] = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.submissionId, submissionId), eq(decisions.version, 2)));
    expect(decisionV2?.route).toBe('auto_approve');

    const [queueAfter] = await db
      .select()
      .from(approvalQueue)
      .where(eq(approvalQueue.submissionId, submissionId));
    expect(queueAfter?.status).toBe('superseded');
    expect(queueAfter?.resolvedAt).not.toBeNull();
  });

  it('never overwrites a queue item a human already approved or rejected', async () => {
    const submissionId = randomUUID();
    const correlationId = randomUUID();

    const [seeded] = await db
      .insert(approvalQueue)
      .values({
        submissionId,
        correlationId,
        department: AUTO_APPROVE_INVOICE.department,
        amount: '42.00',
        submitter: AUTO_APPROVE_INVOICE.submitter,
        status: 'approved',
        resolvedAt: new Date(),
        approverId: 'manager@northwind.example',
      })
      .returning({ id: approvalQueue.id });

    const event = submittedEvent(AUTO_APPROVE_INVOICE, {
      submissionId,
      correlationId,
      kind: 'supplemented',
    });
    await processInvoiceEvent(event, fakeProvider(APPROVE_ASSESSMENT), POLICY);

    const [queueAfter] = await db
      .select()
      .from(approvalQueue)
      .where(eq(approvalQueue.id, seeded!.id));
    expect(queueAfter?.status).toBe('approved');
  });
});

describe('processInvoiceEvent — LLM provider failure (ADR-008)', () => {
  it('fails open to human_review when the provider throws, never swallowing the error silently', async () => {
    const event = submittedEvent(AUTO_APPROVE_INVOICE);
    const throwingProvider: AgentProvider = {
      assess: async () => {
        throw new Error('simulated provider outage');
      },
    };

    const result = await processInvoiceEvent(event, throwingProvider, POLICY);
    expect(result.status).toBe('processed');

    const [decision] = await db.select().from(decisions);
    expect(decision?.route).toBe('human_review');
    expect(decision?.agentConfidence).toBe('0.000');
  });
});
