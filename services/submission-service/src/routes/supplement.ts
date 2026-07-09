import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  invokeService,
  requireRole,
  TOPICS,
  type PolicyViolation,
  type Route,
} from '@approvalflow/shared';
import { db } from '../db/client.js';
import { outbox, submissions } from '../db/schema.js';
import { validateInvoice } from '../validation.js';

type DecisionSummary =
  | { found: false }
  | {
      found: true;
      route: Route;
      violations: PolicyViolation[];
      approval?: {
        status: 'pending' | 'approved' | 'rejected' | 'info_requested' | 'superseded';
        approverNote?: string | null;
        requestInfoNote?: string | null;
      };
    };

export type SupplementResult =
  | { status: 'ok'; submissionId: string }
  | { status: 'not_found' }
  | { status: 'not_awaiting_info' }
  | { status: 'invalid'; errors: string[] };

/**
 * F5's request-info -> supplement -> re-assess loop (ARCHITECTURE.md §3). Exported standalone
 * (not folded into the route handler) so it can be tested directly, same separation as
 * `idempotency.ts`'s `submitInvoice`.
 *
 * Only accepts a patch while decision-service is actually waiting on one. Without this guard, a
 * stray or retried PATCH against a submission that was never escalated — or already resolved —
 * would still merge the patch and fire a re-assessment, which could silently undo a human's
 * decision (decision-service's `pipeline.ts` re-queues on `human_review`).
 */
export async function applySupplement(
  submissionId: string,
  patch: Record<string, unknown>,
): Promise<SupplementResult> {
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!submission) return { status: 'not_found' };

  let decision: Extract<DecisionSummary, { found: true }> | undefined;
  try {
    const result = await invokeService<DecisionSummary>(
      'decision-service',
      `internal/decisions/by-submission/${submission.id}`,
    );
    decision = result.found ? result : undefined;
  } catch {
    // decision-service unreachable — not something a supplement can legitimately resolve right
    // now; falls through to not_awaiting_info below, same as the "no decision yet" case.
  }
  if (decision?.approval?.status !== 'info_requested') {
    return { status: 'not_awaiting_info' };
  }

  const mergedPayload = { ...(submission.payload as Record<string, unknown>), ...patch };

  // Same system-boundary validation as the original POST — a patch can't merge in a
  // structurally-invalid invoice (wrong types, missing required fields) just because it's
  // partial (validation.ts:8-9).
  const validation = validateInvoice(mergedPayload);
  if (!validation.valid) return { status: 'invalid', errors: validation.errors };

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

  return { status: 'ok', submissionId: submission.id };
}

export function registerSupplementRoutes(app: FastifyInstance, signingKey: string): void {
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/invoices/:id/supplement',
    { preHandler: requireRole(signingKey, 'submitter') },
    async (request, reply) => {
      const result = await applySupplement(request.params.id, request.body ?? {});
      switch (result.status) {
        case 'not_found':
          return reply.status(404).send({ error: 'Submission not found' });
        case 'not_awaiting_info':
          return reply
            .status(409)
            .send({ error: 'This submission is not currently awaiting more information' });
        case 'invalid':
          return reply.status(400).send({ error: 'Invalid supplement', details: result.errors });
        case 'ok':
          return reply
            .status(202)
            .send({ submissionId: result.submissionId, status: 'supplemented' });
      }
    },
  );
}
