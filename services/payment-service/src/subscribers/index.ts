import type { FastifyInstance } from 'fastify';
import { TOPICS } from '@approvalflow/shared';
import { registerDecisionMadeSubscriber } from './decision-made.js';
import { registerApprovalCompletedSubscriber } from './approval-completed.js';

const PUBSUB_NAME = 'pubsub';

/** Dapr pub/sub subscription manifest — Dapr polls `/dapr/subscribe` at startup to learn which
 * topics route to which local endpoints (ARCHITECTURE.md §6). */
export function registerSubscribers(app: FastifyInstance): void {
  app.get('/dapr/subscribe', async () => [
    { pubsubname: PUBSUB_NAME, topic: TOPICS.DecisionMade, route: '/events/decision-made' },
    {
      pubsubname: PUBSUB_NAME,
      topic: TOPICS.ApprovalCompleted,
      route: '/events/approval-completed',
    },
  ]);

  registerDecisionMadeSubscriber(app);
  registerApprovalCompletedSubscriber(app);
}
