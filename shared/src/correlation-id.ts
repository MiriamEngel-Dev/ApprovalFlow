import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const HEADER = 'x-correlation-id';

const plugin: FastifyPluginCallback = (fastify: FastifyInstance, _opts, done) => {
  fastify.decorateRequest('correlationId', '');

  fastify.addHook('onRequest', (request, reply, next) => {
    const incoming = request.headers[HEADER];
    const correlationId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    request.correlationId = correlationId;
    reply.header(HEADER, correlationId);
    // Every log line for this request — including Fastify's own request/response logs —
    // carries correlationId (M14), not just logs we write ourselves.
    request.log = request.log.child({ correlationId });
    next();
  });

  done();
};

/**
 * Reads X-Correlation-ID if present, otherwise generates one; echoes it back on the response.
 * Wrapped with `fastify-plugin` so the decorator/hook apply to the *whole* app instance, not just
 * an encapsulated child context — otherwise routes registered directly on `app` (as this project's
 * services do, via plain `registerXRoutes(app)` calls rather than nested `.register()`) would
 * never see `request.correlationId` at all.
 */
export const correlationIdPlugin = fp(plugin, { name: 'correlation-id' });
