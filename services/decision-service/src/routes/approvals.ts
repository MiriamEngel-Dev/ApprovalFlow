import type { FastifyInstance } from 'fastify';
import { requireRole } from '@approvalflow/shared';
import { approveQueueItem, rejectQueueItem, requestInfoOnQueueItem } from '../queue-actions.js';

interface ApproverBody {
  approverId: string;
  note?: string;
}

interface RequestInfoBody {
  note: string;
}

function sendActionResult(
  reply: import('fastify').FastifyReply,
  result: Awaited<ReturnType<typeof approveQueueItem>>,
): unknown {
  if (result.status === 'not_found')
    return reply.status(404).send({ error: 'Queue item not found' });
  if (result.status === 'conflict') {
    return reply.status(409).send({ error: 'Queue item is not pending (already resolved)' });
  }
  return reply.send({ queueId: result.queueId, submissionId: result.submissionId, status: 'ok' });
}

/** F5: approve, reject, or send back for more info in one action; row-lock resume (M11) means
 * a duplicate/retried action on an already-resolved item returns 409, not a second side effect. */
export function registerApprovalRoutes(app: FastifyInstance, signingKey: string): void {
  const approverOnly = { preHandler: requireRole(signingKey, 'approver', 'admin') };

  app.post<{ Params: { queueId: string }; Body: ApproverBody }>(
    '/api/approve/:queueId',
    approverOnly,
    async (request, reply) => {
      const { approverId } = request.body ?? {};
      if (!approverId) return reply.status(400).send({ error: 'approverId is required' });
      const result = await approveQueueItem(request.params.queueId, approverId);
      return sendActionResult(reply, result);
    },
  );

  app.post<{ Params: { queueId: string }; Body: ApproverBody }>(
    '/api/reject/:queueId',
    approverOnly,
    async (request, reply) => {
      const { approverId, note } = request.body ?? {};
      if (!approverId) return reply.status(400).send({ error: 'approverId is required' });
      const result = await rejectQueueItem(request.params.queueId, approverId, note);
      return sendActionResult(reply, result);
    },
  );

  app.post<{ Params: { queueId: string }; Body: RequestInfoBody }>(
    '/api/request-info/:queueId',
    approverOnly,
    async (request, reply) => {
      const { note } = request.body ?? {};
      if (!note) return reply.status(400).send({ error: 'note is required' });
      const result = await requestInfoOnQueueItem(request.params.queueId, note);
      return sendActionResult(reply, result);
    },
  );
}
