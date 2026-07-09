// Integration test against a real Postgres (connects to submission_db per db/client.ts's env-var
// defaults) with a mocked `invokeService` — same split as decision-service's policy-cache.test.ts
// (real DB for what's inherently a DB behavior, mocked Dapr service-invocation so this doesn't
// need a live decision-service + sidecar).
import { randomUUID } from 'node:crypto';
import { sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoice } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { outbox, submissions } from '../db/schema.js';
import { applySupplement } from './supplement.js';

const { invokeServiceMock } = vi.hoisted(() => ({ invokeServiceMock: vi.fn() }));

vi.mock('@approvalflow/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@approvalflow/shared')>();
  return { ...actual, invokeService: invokeServiceMock };
});

const BASE_INVOICE: Invoice = {
  vendor: 'Lakeside Venue',
  vendorKnown: true,
  invoiceNumber: 'LV-5512',
  currency: 'USD',
  category: 'other',
  department: 'engineering-2026Q2',
  submitter: 'omar.farouk@northwind.example',
  lineItems: [{ description: 'Team offsite', quantity: 1, unitPrice: 480.0 }],
  taxAmount: 0,
  total: 480.0,
  receiptPresent: true,
  date: '2026-05-15',
};

async function seedSubmission(): Promise<string> {
  const [row] = await db
    .insert(submissions)
    .values({
      trackingId: randomUUID(),
      correlationId: randomUUID(),
      vendor: BASE_INVOICE.vendor,
      invoiceNumber: BASE_INVOICE.invoiceNumber,
      total: BASE_INVOICE.total.toFixed(2),
      currency: BASE_INVOICE.currency,
      category: BASE_INVOICE.category,
      department: BASE_INVOICE.department,
      submitter: BASE_INVOICE.submitter,
      payload: BASE_INVOICE,
    })
    .returning({ id: submissions.id });
  if (!row) throw new Error('seed insert returned no row');
  return row.id;
}

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE submissions, outbox, processed_events`);
  invokeServiceMock.mockReset();
});

describe('applySupplement — F5 guard (only accept while decision-service is awaiting info)', () => {
  it('404s on an unknown submission', async () => {
    const result = await applySupplement(randomUUID(), { attendees: 2 });
    expect(result.status).toBe('not_found');
  });

  it('rejects with not_awaiting_info when decision-service reports no info_requested item', async () => {
    const id = await seedSubmission();
    invokeServiceMock.mockResolvedValue({ route: 'human_review', violations: [] }); // no `approval`

    const result = await applySupplement(id, { attendees: 2 });
    expect(result.status).toBe('not_awaiting_info');

    const [row] = await db.select().from(submissions);
    expect(row?.payload).toEqual(BASE_INVOICE); // untouched
  });

  it('rejects with not_awaiting_info when decision-service is unreachable', async () => {
    const id = await seedSubmission();
    invokeServiceMock.mockRejectedValue(new Error('connection refused'));

    const result = await applySupplement(id, { attendees: 2 });
    expect(result.status).toBe('not_awaiting_info');
  });

  it('rejects an invalid merged payload with 400-equivalent, even while awaiting info', async () => {
    const id = await seedSubmission();
    invokeServiceMock.mockResolvedValue({
      route: 'human_review',
      violations: [],
      approval: { status: 'info_requested' },
    });

    const result = await applySupplement(id, { total: 'not-a-number' });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('merges the patch and publishes InvoiceSupplemented when genuinely awaiting info', async () => {
    const id = await seedSubmission();
    invokeServiceMock.mockResolvedValue({
      route: 'human_review',
      violations: [],
      approval: { status: 'info_requested' },
    });

    const result = await applySupplement(id, { attendees: 2 });
    expect(result.status).toBe('ok');

    const [row] = await db.select().from(submissions);
    expect((row?.payload as Invoice & { attendees?: number }).attendees).toBe(2);

    const outboxRows = await db.select().from(outbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.topic).toBe('InvoiceSupplemented');
  });
});
