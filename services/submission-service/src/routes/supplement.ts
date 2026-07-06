import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { TOPICS } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { outbox, submissions } from '../db/schema.js';

/** F5's request-info -> supplement -> re-assess loop (ARCHITECTURE.md §3). */
export function registerSupplementRoutes(app: FastifyInstance): void {
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/invoices/:id/supplement',
    async (request, reply) => {
      const [submission] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, request.params.id))
        .limit(1);

      if (!submission) {
        return reply.status(404).send({ error: 'Submission not found' });
      }

      const patch = request.body ?? {};
      const mergedPayload = { ...(submission.payload as Record<string, unknown>), ...patch };

      await db.transaction(async (tx) => {
        await tx
          .update(submissions)
          .set({ payload: mergedPayload })
          .where(eq(submissions.id, submission.id));
        await tx.insert(outbox).values({
          topic: TOPICS.InvoiceSupplemented,
          payload: { correlationId: submission.correlationId, submissionId: submission.id, patch },
          correlationId: submission.correlationId,
        });
      });

      return reply.status(202).send({ submissionId: submission.id, status: 'supplemented' });
    },
  );
}
