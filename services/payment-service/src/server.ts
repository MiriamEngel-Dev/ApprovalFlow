import Fastify from 'fastify';
import { correlationIdPlugin, createLogger } from '@approvalflow/shared';
import { registerHealthRoutes } from './routes/health.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerEventRoutes } from './routes/events.js';
import { startPaymentOutboxRelay } from './outbox-relay.js';
import { startStuckReservationScanner } from './scanner/stuck-reservation-scanner.js';
import { seedBudgetsIfEmpty } from './seed.js';

const logger = createLogger('payment-service');
const PORT = Number(process.env.APP_PORT ?? 3002);

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // Same Dapr pub/sub CloudEvents content-type gap found while building decision-service
  // (Fastify's default JSON parser doesn't recognize `application/cloudevents+json`).
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
  registerEventRoutes(app);

  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err, correlationId: request.correlationId }, 'unhandled error');
    reply.status(500).send({ error: 'Internal server error' });
  });

  await seedBudgetsIfEmpty();

  const relay = startPaymentOutboxRelay();
  const scanner = startStuckReservationScanner();

  const shutdown = async (): Promise<void> => {
    relay.stop();
    scanner.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ host: '0.0.0.0', port: PORT });
  logger.info({ port: PORT }, 'payment-service listening');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'payment-service failed to start');
  process.exit(1);
});
