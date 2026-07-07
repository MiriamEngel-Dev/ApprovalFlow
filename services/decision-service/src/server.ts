import Fastify from 'fastify';
import { correlationIdPlugin, createLogger } from '@approvalflow/shared';
import { registerHealthRoutes } from './routes/health.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerPolicyRoutes } from './routes/policy.js';
import { registerQueueRoutes } from './routes/queue.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerEventRoutes } from './routes/events.js';
import { startDecisionOutboxRelay } from './outbox-relay.js';
import { createProvider } from './providers/index.js';

const logger = createLogger('decision-service');
const PORT = Number(process.env.APP_PORT ?? 3001);

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  const provider = await createProvider();

  // Dapr's pub/sub HTTP delivery POSTs each event as `Content-Type: application/cloudevents+json`
  // (CloudEvents 1.0), which Fastify's built-in JSON parser doesn't recognize by default (only
  // `application/json`) — without this, every subscribed event is rejected 415 before reaching
  // any route handler.
  app.addContentTypeParser(
    'application/cloudevents+json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(correlationIdPlugin);
  registerHealthRoutes(app);
  registerInternalRoutes(app);
  registerPolicyRoutes(app);
  registerQueueRoutes(app);
  registerApprovalRoutes(app);
  registerEventRoutes(app, provider);

  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err, correlationId: request.correlationId }, 'unhandled error');
    reply.status(500).send({ error: 'Internal server error' });
  });

  const relay = startDecisionOutboxRelay();

  const shutdown = async (): Promise<void> => {
    relay.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ host: '0.0.0.0', port: PORT });
  logger.info(
    { port: PORT, llmProvider: process.env.LLM_PROVIDER ?? 'stub' },
    'decision-service listening',
  );
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'decision-service failed to start');
  process.exit(1);
});
