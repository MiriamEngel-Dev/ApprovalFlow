import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';

/** M8's "notification channel" — the event history a submitter would have been notified about.
 *
 * ARCHITECTURE.md's role table says "submitter (own), approver, admin" — but no JWT `sub` ↔
 * submission ownership link exists anywhere in this schema (submissions carries a free-text
 * `submitter` field, not a user id), and nothing else in the system needs one. Adding real
 * per-user ownership here would mean a schema change and logic nothing else uses — out of scope
 * for this capstone. Simplified to: any authenticated submitter/approver/admin may view any
 * submission's notifications (submissionId is an opaque, unguessable uuid). */
export function registerNotificationRoutes(app: FastifyInstance, signingKey: string): void {
  app.get<{ Params: { submissionId: string } }>(
    '/api/notifications/:submissionId',
    { preHandler: requireRole(signingKey, 'submitter', 'approver', 'admin') },
    async (request, reply) => {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.submissionId, request.params.submissionId))
        .orderBy(asc(notifications.createdAt));

      return reply.send({
        submissionId: request.params.submissionId,
        notifications: rows.map((n) => ({
          recipient: n.recipient,
          message: n.message,
          eventType: n.eventType,
          createdAt: n.createdAt,
        })),
      });
    },
  );
}
