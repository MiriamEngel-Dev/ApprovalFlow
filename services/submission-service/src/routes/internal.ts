import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Invoice } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { submissions } from '../db/schema.js';

/**
 * Internal, service-to-service only (not part of the public API surface / docs/openapi.yaml).
 * decision-service's `InvoiceSupplemented` handler needs the current merged invoice to
 * re-assess — the event on the wire only carries the patch, since submission-service is the
 * single system of record for the raw invoice (mirrors decision-service's own
 * `GET /internal/decisions/by-submission/:id`, added for the symmetric read submission-service
 * needs from decision-service).
 */
export function registerInternalRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/internal/submissions/:id', async (request, reply) => {
    const [submission] = await db
      .select({ payload: submissions.payload, correlationId: submissions.correlationId })
      .from(submissions)
      .where(eq(submissions.id, request.params.id))
      .limit(1);

    if (!submission) {
      return reply.status(404).send({ error: 'Submission not found' });
    }

    return reply.send({
      invoice: submission.payload as Invoice,
      correlationId: submission.correlationId,
    });
  });
}
