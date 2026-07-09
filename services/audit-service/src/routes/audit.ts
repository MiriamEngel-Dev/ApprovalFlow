import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

/** F9: full decision trail by correlation id — extracted data, rules applied, agent reasoning,
 * who made the final call, and the payment outcome are all present across the `audit_events` rows
 * for this submission (each event's own payload carries its own slice; this endpoint returns them
 * in order rather than re-deriving a merged view, so the auditor sees exactly what happened and
 * when). F10 is checked against this same trail: no `PaymentSucceeded`/`ApprovalCompleted` row can
 * exist here for a submission whose `DecisionMade` row shows an amount over the configured
 * ceiling — the deterministic router enforced that upstream (decision-service), this is where it's
 * provable after the fact. */
export function registerAuditRoutes(app: FastifyInstance): void {
  app.get<{ Params: { submissionId: string } }>(
    '/api/audit/:submissionId',
    async (request, reply) => {
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.submissionId, request.params.submissionId))
        .orderBy(asc(auditEvents.createdAt));

      if (events.length === 0) {
        return reply.status(404).send({ error: 'No audit trail for this submission yet' });
      }

      return reply.send({
        submissionId: request.params.submissionId,
        correlationId: events[0]?.correlationId,
        events: events.map((e) => ({
          eventType: e.eventType,
          payload: e.payload,
          createdAt: e.createdAt,
        })),
      });
    },
  );
}
