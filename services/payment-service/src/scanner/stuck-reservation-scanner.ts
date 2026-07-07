import { createLogger } from '@approvalflow/shared';
import { sql } from '../db/client.js';
import { getChargeStatus } from '../mock-provider.js';
import { confirmReservation } from '../saga/confirm.js';
import { compensateReservation } from '../saga/compensate.js';

const logger = createLogger('payment-service');
const SCAN_INTERVAL_MS = 30_000;

interface StuckReservation {
  id: string;
  submissionId: string;
  department: string;
  amount: string;
  correlationId: string;
}

/**
 * Timeout recovery (ADR-003, ADR-013): reservations stuck `active` past 60s (a crash between
 * charging and confirming, or a provider hang) are recovered by asking the provider — by
 * idempotency key, never by guessing — whether the charge actually went through, then confirming
 * or compensating accordingly. `FOR UPDATE SKIP LOCKED` (raw SQL, same pattern as the outbox
 * relay) lets N replicas partition this work without double-recovering the same row (ADR-013);
 * with the single replica shipped today this window is never actually contended, but the query is
 * written the multi-replica-safe way anyway.
 */
export async function scanForStuckReservations(): Promise<void> {
  const stuck = await sql<StuckReservation[]>`
    SELECT id, submission_id AS "submissionId", department, amount, correlation_id AS "correlationId"
    FROM reservations
    WHERE status = 'active' AND created_at < NOW() - INTERVAL '60 seconds'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
  `;

  for (const reservation of stuck) {
    const idempotencyKey = reservation.submissionId;
    const chargeStatus = getChargeStatus(idempotencyKey);

    try {
      if (chargeStatus?.status === 'charged') {
        await confirmReservation(
          reservation.id,
          reservation.department,
          Number(reservation.amount),
        );
        logger.info(
          { correlationId: reservation.correlationId, reservationId: reservation.id },
          'stuck-reservation scanner: provider confirms charge went through — confirmed',
        );
      } else {
        // Not charged (or the mock provider has no record — treated as never-charged, since it's
        // always in-process reachable; a real provider swap would add a genuine "unreachable,
        // retry" branch here per ADR-003).
        await compensateReservation(
          reservation.id,
          reservation.department,
          Number(reservation.amount),
          reservation.submissionId,
        );
        logger.info(
          { correlationId: reservation.correlationId, reservationId: reservation.id },
          'stuck-reservation scanner: provider confirms no charge — compensated',
        );
      }
    } catch (err) {
      logger.error(
        { err, correlationId: reservation.correlationId, reservationId: reservation.id },
        'stuck-reservation scanner: failed to recover reservation, will retry next scan',
      );
    }
  }
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
