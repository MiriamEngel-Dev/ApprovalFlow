import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { approvalQueue, decisions } from '../db/schema.js';

/** F4: the queue of only the items the system escalated, each with the agent's recommendation,
 * confidence, and the policy rules it cited. */
export function registerQueueRoutes(app: FastifyInstance, signingKey: string): void {
  app.get(
    '/api/queue',
    { preHandler: requireRole(signingKey, 'approver', 'admin') },
    async (_request, reply) => {
      const pending = await db
        .select()
        .from(approvalQueue)
        .where(eq(approvalQueue.status, 'pending'))
        .orderBy(desc(approvalQueue.createdAt));

      if (pending.length === 0) return reply.send([]);

      const submissionIds = pending.map((item) => item.submissionId);
      const latestDecisions = await db
        .select()
        .from(decisions)
        .where(inArray(decisions.submissionId, submissionIds))
        .orderBy(desc(decisions.version));

      const latestBySubmission = new Map<string, (typeof latestDecisions)[number]>();
      for (const decision of latestDecisions) {
        if (!latestBySubmission.has(decision.submissionId)) {
          latestBySubmission.set(decision.submissionId, decision);
        }
      }

      return reply.send(
        pending.map((item) => {
          const decision = latestBySubmission.get(item.submissionId);
          return {
            queueId: item.id,
            submissionId: item.submissionId,
            status: item.status,
            department: item.department,
            amount: item.amount,
            submitter: item.submitter,
            agentRecommendation: decision?.agentRecommendation,
            agentConfidence: decision ? Number(decision.agentConfidence) : undefined,
            agentReasoning: decision?.agentReasoning,
            rulesCited: decision?.rulesCited,
            violations: decision?.violations,
            correlationId: item.correlationId,
            createdAt: item.createdAt,
          };
        }),
      );
    },
  );
}
