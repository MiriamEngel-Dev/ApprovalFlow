import { eq } from 'drizzle-orm';
import { createLogger, TOPICS } from '@approvalflow/shared';
import { db, type Tx } from './db/client.js';
import { outbox, processedEvents } from './db/schema.js';
import { reserveBudget, type ReserveResult } from './saga/reserve.js';
import { executePayment } from './saga/execute.js';
import { confirmReservation } from './saga/confirm.js';
import { compensateReservation } from './saga/compensate.js';

const logger = createLogger('payment-service');

export interface SagaTrigger {
  eventId: string;
  correlationId: string;
  submissionId: string;
  department: string;
  amount: number;
}

function publishOutbox(
  tx: Tx,
  topic: string,
  payload: Record<string, unknown>,
  correlationId: string,
): Promise<unknown> {
  return tx.insert(outbox).values({ topic, payload, correlationId });
}

/**
 * Phase 1 (M10): dedup + reserve, one atomic transaction. Marking the event processed and
 * reserving budget must succeed or fail together — previously these were two separate statements,
 * so a crash in between could mark an event "processed" while never reserving budget, silently
 * dropping the payment trigger forever (a redelivery would then be swallowed as a duplicate).
 * On `insufficient_budget`, the `PaymentFailed` outbox row is written in this same transaction too.
 */
async function dedupAndReserve(
  trigger: SagaTrigger,
): Promise<{ duplicate: true } | { duplicate: false; reserveResult: ReserveResult }> {
  return db.transaction(async (tx) => {
    const alreadyProcessed = await tx
      .select({ eventId: processedEvents.eventId })
      .from(processedEvents)
      .where(eq(processedEvents.eventId, trigger.eventId))
      .limit(1);
    if (alreadyProcessed.length > 0) {
      return { duplicate: true } as const;
    }
    await tx.insert(processedEvents).values({ eventId: trigger.eventId });

    const reserveResult = await reserveBudget(
      tx,
      trigger.submissionId,
      trigger.department,
      trigger.amount,
      trigger.correlationId,
    );

    if (reserveResult.status === 'insufficient_budget') {
      logger.warn(
        { correlationId: trigger.correlationId, submissionId: trigger.submissionId },
        'saga FAILED — insufficient department budget, no reservation made',
      );
      await publishOutbox(
        tx,
        TOPICS.PaymentFailed,
        {
          correlationId: trigger.correlationId,
          submissionId: trigger.submissionId,
          reason: 'insufficient department budget',
        },
        trigger.correlationId,
      );
    }

    return { duplicate: false, reserveResult } as const;
  });
}

/**
 * Orchestrates the saga (ADR-003) end to end: reserve -> execute -> confirm, or reserve ->
 * execute -> compensate on decline. Dedups via `processed_events` (M10) so a redelivered
 * `DecisionMade`/`ApprovalCompleted` for the same submission doesn't run the saga twice — combined
 * with `reservations.UNIQUE(submission_id)`, this is the exactly-once guarantee behind F3's "no
 * double payment." Each phase (dedup+reserve, confirm-or-compensate) commits its state change and
 * its outbox event(s) in one transaction; `execute` stays outside a transaction since it's an
 * external-provider I/O boundary and has its own idempotency check.
 */
export async function runPaymentSaga(
  trigger: SagaTrigger,
): Promise<{ status: 'processed' | 'duplicate-event' }> {
  const dedupResult = await dedupAndReserve(trigger);
  if (dedupResult.duplicate) {
    return { status: 'duplicate-event' };
  }
  if (dedupResult.reserveResult.status === 'insufficient_budget') {
    return { status: 'processed' };
  }

  const { reservationId } = dedupResult.reserveResult;
  const chargeResult = await executePayment(trigger.submissionId, trigger.amount);

  if (chargeResult.status === 'declined') {
    await db.transaction(async (tx) => {
      await compensateReservation(
        tx,
        reservationId,
        trigger.department,
        trigger.amount,
        trigger.submissionId,
      );
      await publishOutbox(
        tx,
        TOPICS.PaymentCompensated,
        { correlationId: trigger.correlationId, submissionId: trigger.submissionId, reservationId },
        trigger.correlationId,
      );
      await publishOutbox(
        tx,
        TOPICS.PaymentFailed,
        {
          correlationId: trigger.correlationId,
          submissionId: trigger.submissionId,
          reason: 'payment provider declined',
        },
        trigger.correlationId,
      );
    });
    return { status: 'processed' };
  }

  await db.transaction(async (tx) => {
    await confirmReservation(tx, reservationId, trigger.department, trigger.amount);
    await publishOutbox(
      tx,
      TOPICS.PaymentSucceeded,
      {
        correlationId: trigger.correlationId,
        submissionId: trigger.submissionId,
        paymentId: chargeResult.paymentId,
        amount: trigger.amount,
      },
      trigger.correlationId,
    );
  });
  return { status: 'processed' };
}
