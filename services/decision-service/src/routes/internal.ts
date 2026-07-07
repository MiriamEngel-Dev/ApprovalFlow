import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { PolicyViolation, Route } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { decisions } from '../db/schema.js';

/** Internal, service-to-service only — submission-service's `GET /api/submissions/:id` (F2)
 * calls this to build the submitter-facing plain-language reason (Milestone 4 implementation
 * note). Not part of the public API / docs/openapi.yaml. */
export function registerInternalRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/internal/decisions/by-submission/:id',
    async (request, reply) => {
      const [latest] = await db
        .select({ route: decisions.route, violations: decisions.violations })
        .from(decisions)
        .where(eq(decisions.submissionId, request.params.id))
        .orderBy(desc(decisions.version))
        .limit(1);

      if (!latest) {
        return reply.status(404).send({ error: 'No decision recorded for this submission yet' });
      }

      return reply.send({
        route: latest.route as Route,
        violations: latest.violations as PolicyViolation[],
      });
    },
  );
}
