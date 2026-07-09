import type { FastifyInstance } from 'fastify';
import { forceFailureFor } from '../mock-provider.js';

/**
 * Internal, service-to-service/test-harness only (not part of the public API / docs/openapi.yaml).
 * Journey D (INV-1012, `docs/IMPLEMENTATION-PLAN.md` Milestone 8) needs a deterministic forced
 * payment failure — the `npm run verify` harness (Milestone 14) calls this before submitting the
 * fixture that must exercise compensation, rather than relying on randomness.
 *
 * Gated on a shared secret header — this route mutates payment behavior for an arbitrary
 * submissionId, and until nginx/auth (Milestone 11) exist, this service's port is published
 * directly on the host (`docker-compose.yml`), so an unguarded version of this would let anyone
 * who can reach the port force any payment to decline.
 */
export function isAuthorizedTestHarnessRequest(headerValue: unknown): boolean {
  const expected = process.env.TEST_HARNESS_SECRET;
  return Boolean(expected) && headerValue === expected;
}

export function registerInternalRoutes(app: FastifyInstance): void {
  app.post<{ Body: { submissionId: string } }>(
    '/internal/mock-provider/force-fail',
    async (request, reply) => {
      if (!isAuthorizedTestHarnessRequest(request.headers['x-test-harness-secret'])) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { submissionId } = request.body ?? {};
      if (!submissionId) {
        return reply.status(400).send({ error: 'submissionId is required' });
      }
      forceFailureFor(submissionId);
      return reply.status(204).send();
    },
  );
}
