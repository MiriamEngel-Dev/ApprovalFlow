import type { FastifyInstance } from 'fastify';
import { runPaymentSaga } from '../pipeline.js';

interface CloudEvent<T> {
  id: string;
  data: T;
}

interface DecisionMadePayload {
  correlationId: string;
  submissionId: string;
  route: string;
  department: string;
  amount: number;
}

/**
 * Only `auto_approve` triggers the saga directly here — `human_review` items pay via
 * `ApprovalCompleted` once a human approves (ARCHITECTURE.md §3). Pub/sub-driven per
 * docs/IMPLEMENTATION-PLAN.md's Milestone 8 note (resolving §2's "sync fire-and-forget" prose
 * ambiguity in favor of the twice-stated pub/sub source — §3's diagram and §6's topic table).
 */
export function registerDecisionMadeSubscriber(app: FastifyInstance): void {
  app.post<{ Body: CloudEvent<DecisionMadePayload> }>(
    '/events/decision-made',
    async (request, reply) => {
      const { data } = request.body;
      if (data.route === 'auto_approve') {
        await runPaymentSaga({
          eventId: request.body.id,
          correlationId: data.correlationId,
          submissionId: data.submissionId,
          department: data.department,
          amount: data.amount,
        });
      }
      return reply.status(200).send();
    },
  );
}
