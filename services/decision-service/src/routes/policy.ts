import type { FastifyInstance } from 'fastify';
import { requireRole, StateConflictError } from '@approvalflow/shared';
import { getPolicyConfig, updatePolicyConfig } from '../policy-cache.js';

interface UpdatePolicyBody {
  ceiling?: number;
  confidenceThreshold?: number;
}

/** F7/M13: controller-configurable thresholds, no redeploy. GET and PUT get different role
 * requirements (any approver/admin can view; only admin can change) — separate preHandlers on
 * the same path, not shared. */
export function registerPolicyRoutes(app: FastifyInstance, signingKey: string): void {
  app.get(
    '/api/policy',
    { preHandler: requireRole(signingKey, 'approver', 'admin') },
    async (_request, reply) => {
      return reply.send(await getPolicyConfig());
    },
  );

  app.put<{ Body: UpdatePolicyBody }>(
    '/api/policy',
    { preHandler: requireRole(signingKey, 'admin') },
    async (request, reply) => {
      const { ceiling, confidenceThreshold } = request.body ?? {};
      if (ceiling !== undefined && (typeof ceiling !== 'number' || ceiling < 0)) {
        return reply.status(400).send({ error: 'ceiling must be a non-negative number' });
      }
      if (
        confidenceThreshold !== undefined &&
        (typeof confidenceThreshold !== 'number' ||
          confidenceThreshold < 0 ||
          confidenceThreshold > 1)
      ) {
        return reply
          .status(400)
          .send({ error: 'confidenceThreshold must be a number between 0 and 1' });
      }

      const patch: { ceiling?: number; confidenceThreshold?: number } = {};
      if (ceiling !== undefined) patch.ceiling = ceiling;
      if (confidenceThreshold !== undefined) patch.confidenceThreshold = confidenceThreshold;

      try {
        const updated = await updatePolicyConfig(patch);
        return reply.send(updated);
      } catch (err) {
        if (err instanceof StateConflictError) {
          return reply
            .status(409)
            .send({ error: 'Policy was updated concurrently — retry your request' });
        }
        throw err;
      }
    },
  );
}
