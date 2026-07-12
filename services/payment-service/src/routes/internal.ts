import type { FastifyInstance } from 'fastify';
import { forceFailureFor } from '../mock-provider.js';

/**
 * Internal, service-to-service/test-harness only (not part of the public API / docs/openapi.yaml).
 * Journey D (INV-1012, `docs/IMPLEMENTATION-PLAN.md` Milestone 8) needs a deterministic forced
 * payment failure — the `npm run verify` harness (Milestone 14) calls this before submitting the
 * fixture that must exercise compensation, rather than relying on randomness.
 *
 * Gated on a shared secret header — this route mutates payment behavior for an arbitrary
 * submissionId. Since Milestone 11, payment-service's port is no longer published to the host at
 * all (`docker-compose.yml` — only nginx is), so this is now defense in depth rather than the
 * only guard; kept as-is since a compose-network-local caller shouldn't be trusted by default
 * either.
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
