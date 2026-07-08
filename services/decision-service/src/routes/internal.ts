import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { PolicyViolation, Route } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { approvalQueue, decisions } from '../db/schema.js';

/** Internal, service-to-service only — submission-service's `GET /api/submissions/:id` (F2)
 * calls this to build the submitter-facing plain-language reason (Milestone 4 implementation
 * note). Not part of the public API / docs/openapi.yaml.
 *
 * `decisions.route` is the router's own decision and is never overwritten (F9: it's a versioned
 * audit trail, not a live status — `approveQueueItem`/`rejectQueueItem` intentionally never touch
 * it). A human's resolution of an escalated item lives separately, on `approval_queue`. Reporting
 * only `route` here means a submitter whose item was escalated and later approved by a human would
 * see "Escalated for human review" forever, even after payment completed — so this also looks up
 * the queue row (if any) and returns its resolution alongside the router's route, letting the
 * caller (submission-service) build a status that reflects what actually happened. */
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

      const [queueItem] = await db
        .select({
          status: approvalQueue.status,
          approverNote: approvalQueue.approverNote,
          requestInfoNote: approvalQueue.requestInfoNote,
        })
        .from(approvalQueue)
        .where(eq(approvalQueue.submissionId, request.params.id))
        .limit(1);

      return reply.send({
        route: latest.route as Route,
        violations: latest.violations as PolicyViolation[],
        approval: queueItem
          ? {
              status: queueItem.status as 'pending' | 'approved' | 'rejected' | 'info_requested',
              approverNote: queueItem.approverNote,
              requestInfoNote: queueItem.requestInfoNote,
            }
          : undefined,
      });
    },
  );
}
