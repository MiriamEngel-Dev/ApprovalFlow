// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to decision_db per db/client.ts's env-var defaults). Same convention as
// submission-service's idempotency.test.ts. A fixed `policyOverride` is passed to every call so
// this test never needs a live Dapr sidecar — policy-cache.ts's own caching/version-bump behavior
// is covered separately in policy-cache.test.ts with mocked state calls.
import { randomUUID } from 'node:crypto';
import { sql as rawSql } from 'drizzle-orm';
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
