import type { FastifyInstance } from 'fastify';
import { runPaymentSaga } from '../pipeline.js';

interface CloudEvent<T> {
  id: string;
  data: T;
}

interface ApprovalCompletedPayload {
  correlationId: string;
  submissionId: string;
  department: string;
  amount: number;
}

/** Fires the saga for a `human_review` item once a human approves (ARCHITECTURE.md §3). */
export function registerApprovalCompletedSubscriber(app: FastifyInstance): void {
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
