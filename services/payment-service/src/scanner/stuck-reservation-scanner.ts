import { and, eq } from 'drizzle-orm';
import { createLogger, TOPICS } from '@approvalflow/shared';
import { db, sql, type Tx } from '../db/client.js';
import { outbox, reservations } from '../db/schema.js';
import { getChargeStatus } from '../mock-provider.js';
import { confirmReservation } from '../saga/confirm.js';
import { compensateReservation } from '../saga/compensate.js';

const logger = createLogger('payment-service');
const SCAN_INTERVAL_MS = 30_000;

interface StuckCandidate {
  id: string;
}

/**
 * Timeout recovery (ADR-003, ADR-013): reservations stuck `active` past 60s (a crash between
 * charging and confirming, or a provider hang) are recovered by asking the provider — by
 * idempotency key, never by guessing — whether the charge actually went through, then confirming
 * or compensating accordingly.
 *
 * Two-phase, unlike a single bare `SELECT ... FOR UPDATE SKIP LOCKED`: a lock taken by a lone
 * statement outside an explicit transaction is released the instant that statement returns (the
 * `postgres` client autocommits single statements), so it can't protect the recovery work that
 * follows. Phase 1 is a plain read to build a candidate list; phase 2 re-locks each candidate row
 * *inside* its own transaction — `FOR UPDATE SKIP LOCKED` there actually holds for the duration of
 * the recover-and-publish work, which is what makes this safe for N concurrent replicas (ADR-013)
 * or two overlapping scans on one instance. With the single replica shipped today (M4) this window
 * is never actually contended, but the query is written the multi-replica-safe way regardless.
 */
export async function scanForStuckReservations(): Promise<void> {
  const candidates = await sql<StuckCandidate[]>`
    SELECT id
    FROM reservations
    WHERE status = 'active' AND created_at < NOW() - INTERVAL '60 seconds'
    ORDER BY created_at
  `;

  for (const candidate of candidates) {
    try {
      await recoverOne(candidate.id);
    } catch (err) {
      logger.error(
        { err, reservationId: candidate.id },
        'stuck-reservation scanner: failed to recover reservation, will retry next scan',
      );
    }
  }
}

async function recoverOne(reservationId: string): Promise<void> {
  await db.transaction(async (tx: Tx) => {
    const [reservation] = await tx
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.status, 'active')))
      .for('update', { skipLocked: true });
    if (!reservation) {
      // Already resolved (by the inline saga path or another replica's scan) or another replica
      // holds the lock right now — nothing to do this pass.
      return;
    }

    const chargeStatus = await getChargeStatus(reservation.submissionId);

    if (chargeStatus?.status === 'charged') {
      await confirmReservation(
        tx,
        reservationId,
        reservation.department,
        Number(reservation.amount),
      );
      await tx.insert(outbox).values({
        topic: TOPICS.PaymentSucceeded,
        payload: {
          correlationId: reservation.correlationId,
          submissionId: reservation.submissionId,
          amount: Number(reservation.amount),
          recoveredBy: 'stuck-reservation-scanner',
        },
        correlationId: reservation.correlationId,
      });
      logger.info(
        { correlationId: reservation.correlationId, reservationId },
        'stuck-reservation scanner: provider confirms charge went through — confirmed',
      );
    } else {
      // Not charged (or the mock provider has no record — treated as never-charged, since it's
      // always in-process reachable; a real provider swap would add a genuine "unreachable,
      // retry" branch here per ADR-003).
      await compensateReservation(
        tx,
        reservationId,
        reservation.department,
        Number(reservation.amount),
        reservation.submissionId,
      );
      await tx.insert(outbox).values({
        topic: TOPICS.PaymentCompensated,
        payload: {
          correlationId: reservation.correlationId,
          submissionId: reservation.submissionId,
          reservationId,
          recoveredBy: 'stuck-reservation-scanner',
        },
        correlationId: reservation.correlationId,
      });
      await tx.insert(outbox).values({
        topic: TOPICS.PaymentFailed,
        payload: {
          correlationId: reservation.correlationId,
          submissionId: reservation.submissionId,
          reason: 'stuck reservation recovered as never-charged',
        },
        correlationId: reservation.correlationId,
      });
      logger.info(
        { correlationId: reservation.correlationId, reservationId },
        'stuck-reservation scanner: provider confirms no charge — compensated',
      );
    }
  });
}

export interface ScannerHandle {
  stop: () => void;
}

export function startStuckReservationScanner(): ScannerHandle {
  void scanForStuckReservations();
  const timer = setInterval(() => {
    void scanForStuckReservations();
  }, SCAN_INTERVAL_MS);
  return { stop: () => clearInterval(timer) };
}
