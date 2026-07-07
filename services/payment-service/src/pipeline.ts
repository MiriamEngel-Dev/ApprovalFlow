import { eq } from 'drizzle-orm';
import { createLogger, TOPICS } from '@approvalflow/shared';
import { db } from './db/client.js';
import { outbox, processedEvents } from './db/schema.js';
import { reserveBudget } from './saga/reserve.js';
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

async function publishOutbox(
  topic: string,
  payload: Record<string, unknown>,
  correlationId: string,
): Promise<void> {
  await db.insert(outbox).values({ topic, payload, correlationId });
}

/**
 * Orchestrates the saga (ADR-003) end to end: reserve -> execute -> confirm, or reserve ->
 * execute -> compensate on decline. Dedups via `processed_events` (M10) so a redelivered
 * `DecisionMade`/`ApprovalCompleted` for the same submission doesn't run the saga twice — combined
 * with `reservations.UNIQUE(submission_id)`, this is the exactly-once guarantee behind F3's "no
 * double payment."
 */
export async function runPaymentSaga(
  trigger: SagaTrigger,
): Promise<{ status: 'processed' | 'duplicate-event' }> {
  const alreadyProcessed = await db
    .select({ eventId: processedEvents.eventId })
    .from(processedEvents)
    .where(eq(processedEvents.eventId, trigger.eventId))
    .limit(1);
  if (alreadyProcessed.length > 0) {
    return { status: 'duplicate-event' };
  }
  await db.insert(processedEvents).values({ eventId: trigger.eventId });

  const reserveResult = await reserveBudget(
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
      TOPICS.PaymentFailed,
      {
        correlationId: trigger.correlationId,
        submissionId: trigger.submissionId,
        reason: 'insufficient department budget',
      },
      trigger.correlationId,
    );
    return { status: 'processed' };
  }

  const { reservationId } = reserveResult;
  const chargeResult = await executePayment(trigger.submissionId, trigger.amount);

  if (chargeResult.status === 'declined') {
    await compensateReservation(
      reservationId,
      trigger.department,
      trigger.amount,
      trigger.submissionId,
    );
    await publishOutbox(
      TOPICS.PaymentCompensated,
      { correlationId: trigger.correlationId, submissionId: trigger.submissionId, reservationId },
      trigger.correlationId,
    );
    await publishOutbox(
      TOPICS.PaymentFailed,
      {
        correlationId: trigger.correlationId,
        submissionId: trigger.submissionId,
        reason: 'payment provider declined',
      },
      trigger.correlationId,
    );
    return { status: 'processed' };
  }

  await confirmReservation(reservationId, trigger.department, trigger.amount);
  await publishOutbox(
    TOPICS.PaymentSucceeded,
    {
      correlationId: trigger.correlationId,
      submissionId: trigger.submissionId,
      paymentId: chargeResult.paymentId,
      amount: trigger.amount,
    },
    trigger.correlationId,
  );
  return { status: 'processed' };
}
