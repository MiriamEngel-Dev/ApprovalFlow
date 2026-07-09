import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';

/** M8's "notification channel" — the event history a submitter would have been notified about. */
export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get<{ Params: { submissionId: string } }>(
    '/api/notifications/:submissionId',
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
