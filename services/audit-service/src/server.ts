import Fastify from 'fastify';
import { correlationIdPlugin, createLogger } from '@approvalflow/shared';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerCatchAllSubscriber } from './subscribers/catch-all.js';

const logger = createLogger('audit-service');
const PORT = Number(process.env.APP_PORT ?? 3003);

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // Dapr's pub/sub HTTP delivery POSTs each event as `Content-Type: application/cloudevents+json`
  // (CloudEvents 1.0), which Fastify's built-in JSON parser doesn't recognize by default — without
  // this, every subscribed event is rejected 415 before reaching any route handler.
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
  registerAuditRoutes(app);
  registerDashboardRoutes(app);
  registerNotificationRoutes(app);
  registerCatchAllSubscriber(app);

  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err, correlationId: request.correlationId }, 'unhandled error');
    reply.status(500).send({ error: 'Internal server error' });
  });

  // Passive subscriber only (ARCHITECTURE.md §8) — never publishes, so no outbox relay to start,
  // unlike the other three services.
  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ host: '0.0.0.0', port: PORT });
  logger.info({ port: PORT }, 'audit-service listening');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'audit-service failed to start');
  process.exit(1);
});
