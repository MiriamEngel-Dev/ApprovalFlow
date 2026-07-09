import Fastify from 'fastify';
import { correlationIdPlugin, createLogger, loadJwtSigningKey } from '@approvalflow/shared';
import { registerHealthRoutes } from './routes/health.js';
import { registerSubmissionRoutes } from './routes/submissions.js';
import { registerSupplementRoutes } from './routes/supplement.js';
import { registerInternalRoutes } from './routes/internal.js';
import { startSubmissionOutboxRelay } from './outbox-relay.js';

const logger = createLogger('submission-service');
const PORT = Number(process.env.APP_PORT ?? 3000);

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  const signingKey = await loadJwtSigningKey();

  await app.register(correlationIdPlugin);
  registerHealthRoutes(app);
  registerSubmissionRoutes(app, signingKey);
  registerSupplementRoutes(app, signingKey);
  registerInternalRoutes(app);

  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err, correlationId: request.correlationId }, 'unhandled error');
    reply.status(500).send({ error: 'Internal server error' });
  });

  const relay = startSubmissionOutboxRelay();

  const shutdown = async (): Promise<void> => {
    relay.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ host: '0.0.0.0', port: PORT });
  logger.info({ port: PORT }, 'submission-service listening');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'submission-service failed to start');
  process.exit(1);
});
