import { and, eq } from 'drizzle-orm';
import type { Invoice } from '@approvalflow/shared';
import { TOPICS } from '@approvalflow/shared';
import { db } from './db/client.js';
import { outbox, submissions } from './db/schema.js';

export interface SubmitResult {
  status: 'accepted' | 'duplicate';
  trackingId: string;
  correlationId: string;
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}

async function findExistingSubmission(invoice: Invoice) {
  const rows = await db
    .select({ trackingId: submissions.trackingId, correlationId: submissions.correlationId })
    .from(submissions)
    .where(
      and(
        eq(submissions.vendor, invoice.vendor),
        eq(submissions.invoiceNumber, invoice.invoiceNumber),
        eq(submissions.total, invoice.total.toFixed(2)),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * F1/F3/M8/M10: accepts a new submission atomically (entity + outbox row in one transaction —
 * ARCHITECTURE.md §7), or short-circuits a duplicate via the `submissions_dedup_unique`
 * constraint instead of erroring. Never publishes inline — the outbox relay does that.
 */
export async function submitInvoice(
  invoice: Invoice,
  correlationId: string,
): Promise<SubmitResult> {
  try {
    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(submissions)
        .values({
          vendor: invoice.vendor,
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total.toFixed(2),
          currency: invoice.currency,
          category: invoice.category,
          department: invoice.department,
          submitter: invoice.submitter,
          payload: invoice,
          correlationId,
        })
        .returning({ id: submissions.id, trackingId: submissions.trackingId });

      if (!row) throw new Error('Insert into submissions returned no row');

      await tx.insert(outbox).values({
        topic: TOPICS.InvoiceSubmitted,
        payload: { correlationId, submissionId: row.id, invoice },
        correlationId,
      });

      return row;
    });

    return { status: 'accepted', trackingId: inserted.trackingId, correlationId };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await findExistingSubmission(invoice);
      if (existing) {
        return {
          status: 'duplicate',
          trackingId: existing.trackingId,
          correlationId: existing.correlationId,
        };
      }
    }
    throw err;
  }
}
