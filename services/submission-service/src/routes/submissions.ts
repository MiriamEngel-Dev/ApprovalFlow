import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildReason, invokeService, type PolicyViolation, type Route } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { submissions } from '../db/schema.js';
import { submitInvoice } from '../idempotency.js';
import { validateInvoice } from '../validation.js';

interface DecisionSummary {
  route: Route;
  violations: PolicyViolation[];
  approval?: {
    status: 'pending' | 'approved' | 'rejected' | 'info_requested';
    approverNote?: string | null;
    requestInfoNote?: string | null;
  };
}

export function registerSubmissionRoutes(app: FastifyInstance): void {
  // F1: submit an invoice/expense and get an immediate ack with a tracking id — never blocking
  // on processing (assessment happens asynchronously, downstream, via the outbox relay).
  app.post('/api/submissions', async (request, reply) => {
    const validation = validateInvoice(request.body);
    if (!validation.valid) {
      return reply.status(400).send({ error: 'Invalid submission', details: validation.errors });
    }

    const result = await submitInvoice(validation.invoice, request.correlationId);

    if (result.status === 'duplicate') {
      // F3: a submission sent twice is never paid twice — short-circuit with the prior tracking id.
      return reply.status(200).send({
        trackingId: result.trackingId,
        correlationId: result.correlationId,
        status: 'duplicate',
      });
    }

    return reply
      .status(202)
      .send({ trackingId: result.trackingId, correlationId: result.correlationId });
  });

  // F2: status + a plain-language reason for the outcome.
  app.get<{ Params: { id: string } }>('/api/submissions/:id', async (request, reply) => {
    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, request.params.id))
      .limit(1);

    if (!submission) {
      return reply.status(404).send({ error: 'Submission not found' });
    }

    let decision: DecisionSummary | undefined;
    try {
      decision = await invokeService<DecisionSummary>(
        'decision-service',
        `internal/decisions/by-submission/${submission.id}`,
      );
    } catch {
      // decision-service unreachable, or no decision recorded yet — reported as "pending" below,
      // never a 5xx: a submitter checking status shouldn't be exposed to internal wiring gaps.
    }

    const route = decision?.route;
    let status: string = route ?? 'pending';
    let reason = route ? buildReason(route, decision?.violations ?? []) : 'Awaiting assessment.';

    // A human's resolution of an escalated item overrides the router's own route for display —
    // otherwise a submitter whose item was approved (and paid) would see "Escalated for human
    // review" forever, since `decisions.route` is an immutable audit trail (F9), never rewritten
    // to reflect what the approver decided.
    const approval = decision?.approval;
    if (approval?.status === 'approved') {
      status = 'approved';
      reason = 'Approved by a human reviewer.';
    } else if (approval?.status === 'rejected') {
      status = 'rejected';
      reason = approval.approverNote
        ? `Rejected by a human reviewer: ${approval.approverNote}`
        : 'Rejected by a human reviewer.';
    } else if (approval?.status === 'info_requested') {
      status = 'info_requested';
      reason = approval.requestInfoNote
        ? `More information needed: ${approval.requestInfoNote}`
        : 'More information needed.';
    }

    return reply.send({
      id: submission.id,
      trackingId: submission.trackingId,
      correlationId: submission.correlationId,
      status,
      reason,
      submittedAt: submission.createdAt,
    });
  });

  app.get<{ Params: { trackingId: string } }>(
    '/api/submissions/tracking/:trackingId',
    async (request, reply) => {
      const [submission] = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(eq(submissions.trackingId, request.params.trackingId))
        .limit(1);

      if (!submission) {
        return reply.status(404).send({ error: 'Tracking ID not found' });
      }

      return reply.redirect(`/api/submissions/${submission.id}`, 302);
    },
  );
}
