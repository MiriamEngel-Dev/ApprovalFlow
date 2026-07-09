import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { TOPICS } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

export type PaymentStatusSummary =
  { found: false } | { found: true; status: 'succeeded' | 'failed' | 'compensated' };

const PAYMENT_TOPICS = [TOPICS.PaymentSucceeded, TOPICS.PaymentFailed, TOPICS.PaymentCompensated];

const STATUS_BY_TOPIC: Record<(typeof PAYMENT_TOPICS)[number], PaymentStatusSummary> = {
  [TOPICS.PaymentSucceeded]: { found: true, status: 'succeeded' },
  [TOPICS.PaymentFailed]: { found: true, status: 'failed' },
  [TOPICS.PaymentCompensated]: { found: true, status: 'compensated' },
};

/**
 * Internal, service-to-service only — submission-service's `GET /api/submissions/:id` (F2) calls
 * this so a submitter can see the true terminal outcome ("payment succeeded"), not just the
 * router's route or a human's approval, neither of which submission-service or decision-service
 * has visibility into (payment-service is a separate service, and `GET /api/audit/:submissionId`,
 * which does have this, is role-gated to approver/admin only). Not part of the public API /
 * docs/openapi.yaml. Always 200s — no payment event yet is a normal, expected state for most of a
 * submission's life (nothing to do with payment until auto_approve/approved), never a 404 (same
 * reasoning as decision-service's internal endpoint, ARCHITECTURE.md §10 circuit-breaker note).
 */
export async function getPaymentStatus(submissionId: string): Promise<PaymentStatusSummary> {
  const [latest] = await db
    .select({ eventType: auditEvents.eventType })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.submissionId, submissionId),
        inArray(auditEvents.eventType, PAYMENT_TOPICS),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);

  if (!latest) return { found: false };
  return STATUS_BY_TOPIC[latest.eventType as (typeof PAYMENT_TOPICS)[number]] ?? { found: false };
}

export function registerInternalRoutes(app: FastifyInstance): void {
  app.get<{ Params: { submissionId: string } }>(
    '/internal/payment-status/:submissionId',
    async (request, reply) => {
      return reply.send(await getPaymentStatus(request.params.submissionId));
    },
  );
}
