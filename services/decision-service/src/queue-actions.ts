import { eq } from 'drizzle-orm';
import { TOPICS } from '@approvalflow/shared';
import { db } from './db/client.js';
import { approvalQueue, outbox } from './db/schema.js';

export type QueueActionResult =
  | { status: 'ok'; queueId: string; submissionId: string }
  | { status: 'not_found' }
  | { status: 'conflict' };

/**
 * F5/M11: row-lock resume. `FOR UPDATE` serializes two approvers acting on the same task at once;
 * `WHERE status='pending'` (checked after the lock, not in the WHERE clause, so a non-pending row
 * still locks and returns a clean 409 instead of a silent no-op) makes the transition safe across
 * a service restart between pause and resume — all state lives in this row, nothing in memory.
 */
async function resolvePendingQueueItem(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  queueId: string,
) {
  const [item] = await tx
    .select()
    .from(approvalQueue)
    .where(eq(approvalQueue.id, queueId))
    .for('update');
  if (!item) return { outcome: 'not_found' as const };
  if (item.status !== 'pending') return { outcome: 'conflict' as const };
  return { outcome: 'ok' as const, item };
}

export async function approveQueueItem(
  queueId: string,
  approverId: string,
): Promise<QueueActionResult> {
  return db.transaction(async (tx) => {
    const resolved = await resolvePendingQueueItem(tx, queueId);
    if (resolved.outcome !== 'ok') return { status: resolved.outcome };
    const { item } = resolved;

    await tx
      .update(approvalQueue)
      .set({ status: 'approved', approverId, resolvedAt: new Date() })
      .where(eq(approvalQueue.id, queueId));

    await tx.insert(outbox).values({
      topic: TOPICS.ApprovalCompleted,
      payload: {
        correlationId: item.correlationId,
        submissionId: item.submissionId,
        queueId,
        approverId,
      },
      correlationId: item.correlationId,
    });

    return { status: 'ok', queueId, submissionId: item.submissionId };
  });
}

export async function rejectQueueItem(
  queueId: string,
  approverId: string,
  note?: string,
): Promise<QueueActionResult> {
  return db.transaction(async (tx) => {
    const resolved = await resolvePendingQueueItem(tx, queueId);
    if (resolved.outcome !== 'ok') return { status: resolved.outcome };
    const { item } = resolved;

    await tx
      .update(approvalQueue)
      .set({ status: 'rejected', approverId, approverNote: note ?? null, resolvedAt: new Date() })
      .where(eq(approvalQueue.id, queueId));

    await tx.insert(outbox).values({
      topic: TOPICS.ApprovalRejected,
      payload: {
        correlationId: item.correlationId,
        submissionId: item.submissionId,
        queueId,
        approverId,
        note,
      },
      correlationId: item.correlationId,
    });

    return { status: 'ok', queueId, submissionId: item.submissionId };
  });
}

export async function requestInfoOnQueueItem(
  queueId: string,
  note: string,
): Promise<QueueActionResult> {
  return db.transaction(async (tx) => {
    const resolved = await resolvePendingQueueItem(tx, queueId);
    if (resolved.outcome !== 'ok') return { status: resolved.outcome };
    const { item } = resolved;

    // No resolvedAt — not resolved yet, just paused pending the submitter's supplement. Resumes
    // when decision-service's InvoiceSupplemented subscriber re-queues this same row (pipeline.ts).
    await tx
      .update(approvalQueue)
      .set({ status: 'info_requested', requestInfoNote: note })
      .where(eq(approvalQueue.id, queueId));

    await tx.insert(outbox).values({
      topic: TOPICS.InfoRequested,
      payload: {
        correlationId: item.correlationId,
        submissionId: item.submissionId,
        queueId,
        note,
      },
      correlationId: item.correlationId,
    });

    return { status: 'ok', queueId, submissionId: item.submissionId };
  });
}
