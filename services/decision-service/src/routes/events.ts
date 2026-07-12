import type { FastifyInstance } from 'fastify';
import type { Invoice } from '@approvalflow/shared';
import { TOPICS } from '@approvalflow/shared';
import { processInvoiceEvent, type InboundInvoiceEvent } from '../pipeline.js';
import type { AgentProvider } from '../providers/index.js';

const PUBSUB_NAME = 'pubsub';

interface CloudEvent<T> {
  id: string;
  data: T;
}

interface InvoiceEventPayload {
  correlationId: string;
  submissionId: string;
  invoice?: Invoice;
}

function buildInboundEvent(
  envelope: CloudEvent<InvoiceEventPayload>,
  kind: InboundInvoiceEvent['kind'],
): InboundInvoiceEvent {
  const { data } = envelope;
  const base = {
    eventId: envelope.id,
    correlationId: data.correlationId,
    submissionId: data.submissionId,
    kind,
  };
  return data.invoice ? { ...base, invoice: data.invoice } : base;
}

/** Dapr pub/sub subscription (ARCHITECTURE.md §3, §6). `GET /dapr/subscribe` is the contract Dapr
 * polls at startup to learn which topics to route to which local routes; each topic then arrives
 * as an HTTP POST carrying a CloudEvent envelope. */
export function registerEventRoutes(app: FastifyInstance, provider: AgentProvider): void {
  app.get('/dapr/subscribe', async () => [
    { pubsubname: PUBSUB_NAME, topic: TOPICS.InvoiceSubmitted, route: '/events/invoice-submitted' },
    {
      pubsubname: PUBSUB_NAME,
      topic: TOPICS.InvoiceSupplemented,
      route: '/events/invoice-supplemented',
    },
    {
      pubsubname: PUBSUB_NAME,
      topic: TOPICS.InvoiceResubmitted,
      route: '/events/invoice-resubmitted',
    },
  ]);

  app.post<{ Body: CloudEvent<InvoiceEventPayload> }>(
    '/events/invoice-submitted',
    async (request, reply) => {
      await processInvoiceEvent(buildInboundEvent(request.body, 'submitted'), provider);
      return reply.status(200).send();
    },
  );

  app.post<{ Body: CloudEvent<InvoiceEventPayload> }>(
    '/events/invoice-supplemented',
    async (request, reply) => {
      await processInvoiceEvent(buildInboundEvent(request.body, 'supplemented'), provider);
      return reply.status(200).send();
    },
  );

  // Trigger underspecified in the source sequence diagram (the duplicate path short-circuits
  // without an event) — treated defensively with the same handler as InvoiceSubmitted per
  // docs/IMPLEMENTATION-PLAN.md's Milestone 6 flag; none of the 4 required journeys exercise it.
  app.post<{ Body: CloudEvent<InvoiceEventPayload> }>(
    '/events/invoice-resubmitted',
    async (request, reply) => {
      await processInvoiceEvent(buildInboundEvent(request.body, 'resubmitted'), provider);
      return reply.status(200).send();
    },
  );
}
