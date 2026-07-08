import type { FastifyInstance } from 'fastify';
import { forceFailureFor } from '../mock-provider.js';

/**
 * Internal, service-to-service/test-harness only (not part of the public API / docs/openapi.yaml).
 * Journey D (INV-1012, `docs/IMPLEMENTATION-PLAN.md` Milestone 8) needs a deterministic forced
 * payment failure — the `npm run verify` harness (Milestone 14) calls this before submitting the
 * fixture that must exercise compensation, rather than relying on randomness.
 */
export function registerInternalRoutes(app: FastifyInstance): void {
  app.post<{ Body: { submissionId: string } }>(
    '/internal/mock-provider/force-fail',
    async (request, reply) => {
      const { submissionId } = request.body ?? {};
      if (!submissionId) {
        return reply.status(400).send({ error: 'submissionId is required' });
      }
      forceFailureFor(submissionId);
      return reply.status(204).send();
    },
  );
}
