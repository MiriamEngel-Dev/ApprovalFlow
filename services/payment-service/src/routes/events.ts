import type { FastifyInstance } from 'fastify';
import { TOPICS } from '@approvalflow/shared';
import { runPaymentSaga } from '../pipeline.js';

const PUBSUB_NAME = 'pubsub';

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

interface ApprovalCompletedPayload {
  correlationId: string;
  submissionId: string;
  department: string;
  amount: number;
}

/**
 * Dapr pub/sub subscription. The saga trigger is pub/sub-driven for BOTH `DecisionMade` and
 * `ApprovalCompleted` — ARCHITECTURE.md §2's prose calls the decision->payment hop "sync
 * fire-and-forget," but §3's sequence diagram and §6's topic table both model it as pub/sub; per
 * docs/IMPLEMENTATION-PLAN.md's Milestone 8 note, the twice-stated source (diagram + topic table)
 * wins over the once-stated prose.
 */
export function registerEventRoutes(app: FastifyInstance): void {
  app.get('/dapr/subscribe', async () => [
    { pubsubname: PUBSUB_NAME, topic: TOPICS.DecisionMade, route: '/events/decision-made' },
    {
      pubsubname: PUBSUB_NAME,
      topic: TOPICS.ApprovalCompleted,
      route: '/events/approval-completed',
    },
  ]);

  app.post<{ Body: CloudEvent<DecisionMadePayload> }>(
    '/events/decision-made',
    async (request, reply) => {
      const { data } = request.body;
      // Only `auto_approve` triggers the saga directly here — `human_review` items pay via
      // `ApprovalCompleted` once a human approves (ARCHITECTURE.md §3).
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

  app.post<{ Body: CloudEvent<ApprovalCompletedPayload> }>(
    '/events/approval-completed',
    async (request, reply) => {
      const { data } = request.body;
      await runPaymentSaga({
        eventId: request.body.id,
        correlationId: data.correlationId,
        submissionId: data.submissionId,
        department: data.department,
        amount: data.amount,
      });
      return reply.status(200).send();
    },
  );
}
