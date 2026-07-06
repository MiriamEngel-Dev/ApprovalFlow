import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const HEADER = 'x-correlation-id';

/** Reads X-Correlation-ID if present, otherwise generates one; echoes it back on the response. */
export const correlationIdPlugin: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done,
) => {
  fastify.decorateRequest('correlationId', '');

  fastify.addHook('onRequest', (request, reply, next) => {
    const incoming = request.headers[HEADER];
    const correlationId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    request.correlationId = correlationId;
    reply.header(HEADER, correlationId);
    next();
  });

  done();
};
