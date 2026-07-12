import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Shared `setErrorHandler` for all 4 services (M14/M15: fail cleanly, never silently — and never
 * misleadingly). Framework-level client errors (malformed JSON, wrong Content-Type, oversized
 * body, etc.) carry their own correct `statusCode` — collapsing all of those to a flat 500 would
 * make a caller's own mistake look like a server crash. Only genuine 5xx / unrecognized errors
 * get the generic message (never leak internals like a raw exception message to the caller);
 * legitimate 4xx errors are safe to pass through since they describe the client's own request.
 */
export function handleError(err: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  const statusCode = err.statusCode ?? 500;

  if (statusCode >= 400 && statusCode < 500) {
    request.log.warn({ err, correlationId: request.correlationId }, 'client error');
    reply.status(statusCode).send({ error: err.message });
    return;
  }

  request.log.error({ err, correlationId: request.correlationId }, 'unhandled error');
  reply.status(500).send({ error: 'Internal server error' });
}
