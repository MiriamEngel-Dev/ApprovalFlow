// Integration test against a real Postgres — requires `docker compose up -d postgres` running
// locally first (connects to submission_db per db/client.ts's env-var defaults). Idempotency and
// the outbox pattern are inherently database behaviors (unique constraints, transactions) that
// mocks can't meaningfully stand in for.
import { randomUUID } from 'node:crypto';
import { sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Invoice } from '@approvalflow/shared';
import { db } from './db/client.js';
import { outbox, submissions } from './db/schema.js';
import { submitInvoice } from './idempotency.js';

const BASE_INVOICE: Invoice = {
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

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE submissions, outbox, processed_events`);
});

describe('submitInvoice — idempotency and outbox (F3, M8, M10)', () => {
  it('accepts a new submission and writes the entity + outbox row atomically', async () => {
    const correlationId = randomUUID();
    const result = await submitInvoice(BASE_INVOICE, correlationId);

    expect(result.status).toBe('accepted');
    expect(result.trackingId).toBeTruthy();

    const rows = await db.select().from(submissions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vendor).toBe('Bistro 19');

    const outboxRows = await db.select().from(outbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.topic).toBe('InvoiceSubmitted');
    expect(outboxRows[0]?.publishedAt).toBeNull();
  });

  it('short-circuits an exact re-submission as a duplicate — no second row, no second publish', async () => {
    const first = await submitInvoice(BASE_INVOICE, randomUUID());
    const second = await submitInvoice(BASE_INVOICE, randomUUID());

    expect(second.status).toBe('duplicate');
    expect(second.trackingId).toBe(first.trackingId);

    const rows = await db.select().from(submissions);
    expect(rows).toHaveLength(1);

    const outboxRows = await db.select().from(outbox);
    expect(outboxRows).toHaveLength(1);
  });

  it('treats a different total for the same vendor/invoiceNumber as a distinct submission', async () => {
    await submitInvoice(BASE_INVOICE, randomUUID());
    const second = await submitInvoice({ ...BASE_INVOICE, total: 99.0 }, randomUUID());

    expect(second.status).toBe('accepted');

    const rows = await db.select().from(submissions);
    expect(rows).toHaveLength(2);
  });
});
