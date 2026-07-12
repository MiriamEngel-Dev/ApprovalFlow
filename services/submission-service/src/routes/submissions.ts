import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  buildReason,
  invokeService,
  requireRole,
  type AuthClaims,
  type PolicyViolation,
  type Route,
} from '@approvalflow/shared';
import { db } from '../db/client.js';
import { submissions } from '../db/schema.js';
import { submitInvoice } from '../idempotency.js';
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

type PaymentStatusSummary =
  { found: false } | { found: true; status: 'succeeded' | 'failed' | 'compensated' };

/** Structural subset of Fastify's/Pino's logger — just what this needs, so a plain test double
 * works without pulling in either library's exact (and mutually incompatible) Logger type. */
interface WarnLogger {
  warn: (obj: object, msg: string) => void;
}

/**
 * Exported standalone (not inlined in the route) so the "decision-service unreachable" logging
 * path is directly testable, same separation as `idempotency.ts`'s `submitInvoice` and
 * `supplement.ts`'s `applySupplement`.
 *
 * Never throws — reported as "no decision yet" either way (a submitter checking status shouldn't
 * be exposed to internal wiring gaps as a 5xx), but a real outage must not be silent (M14/M15):
 * only the actually-unreachable case is logged. `{found: false}` (no decision recorded yet) is a
 * normal, expected response — not logged, and deliberately never surfaced to the caller as an
 * error status by decision-service, since Dapr's circuit breaker treats any non-2xx as a failure
 * and would otherwise trip on routine status polling (see `internal.ts` on the decision-service
 * side for the full explanation).
 */
export async function lookupDecision(
  submissionId: string,
  correlationId: string | undefined,
  logger: WarnLogger,
): Promise<Extract<DecisionSummary, { found: true }> | undefined> {
  try {
    const result = await invokeService<DecisionSummary>(
      'decision-service',
      `internal/decisions/by-submission/${submissionId}`,
    );
    return result.found ? result : undefined;
  } catch (err) {
    logger.warn(
      { err, correlationId, submissionId },
      'submissions: could not reach decision-service for status lookup — reporting pending',
    );
    return undefined;
  }
}

/**
 * Same shape/reasoning as `lookupDecision` above, calling audit-service's internal payment-status
 * endpoint instead of decision-service's — a submitter's `GET /api/submissions/:id` (F2) needs the
 * true terminal outcome ("payment succeeded"), which neither submission-service nor
 * decision-service has visibility into on its own (payment-service is a separate service).
 */
export async function lookupPaymentStatus(
  submissionId: string,
  correlationId: string | undefined,
  logger: WarnLogger,
): Promise<Extract<PaymentStatusSummary, { found: true }> | undefined> {
  try {
    const result = await invokeService<PaymentStatusSummary>(
      'audit-service',
      `internal/payment-status/${submissionId}`,
    );
    return result.found ? result : undefined;
  } catch (err) {
    logger.warn(
      { err, correlationId, submissionId },
      'submissions: could not reach audit-service for payment status lookup — reporting prior status',
    );
    return undefined;
  }
}

export interface SubmissionStatus {
  status: string;
  reason: string;
}

/**
 * F2's status + plain-language reason, extracted from `GET /api/submissions/:id`'s handler so
 * `GET /api/submissions/mine` (the submitter's own history list) can reuse the exact same
 * decision/approval/payment-merging logic instead of duplicating it — one place that knows how to
 * turn a submission's raw state into what a submitter should see.
 */
export async function buildSubmissionStatus(
  submissionId: string,
  correlationId: string | undefined,
  logger: WarnLogger,
): Promise<SubmissionStatus> {
  const decision = await lookupDecision(submissionId, correlationId, logger);

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

  // The payment outcome (when one exists) is the true terminal state — overrides
  // approved/auto_approve, since those just mean "cleared to pay," not "actually paid."
  const payment = await lookupPaymentStatus(submissionId, correlationId, logger);
  if (payment?.status === 'succeeded') {
    status = 'payment_succeeded';
    reason = 'Approved and payment completed successfully.';
  } else if (payment?.status === 'failed') {
    status = 'payment_failed';
    reason = 'Approved, but payment could not be completed (insufficient department budget).';
  } else if (payment?.status === 'compensated') {
    status = 'payment_failed';
    reason = 'Payment was reversed after an issue completing it.';
  }

  return { status, reason };
}

export function registerSubmissionRoutes(app: FastifyInstance, signingKey: string): void {
  // F1: submit an invoice/expense and get an immediate ack with a tracking id — never blocking
  // on processing (assessment happens asynchronously, downstream, via the outbox relay).
  app.post(
    '/api/submissions',
    { preHandler: requireRole(signingKey, 'submitter') },
    async (request, reply) => {
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
    },
  );

  // A submitter's own history — everything they've submitted and its current status. Registered
  // ahead of `/:id` so the literal path `mine` is never swallowed by that param route. Scoped to
  // the caller's own `sub` claim (never a client-supplied name/query param), so there's no way to
  // page through someone else's submissions by guessing a name.
  app.get(
    '/api/submissions/mine',
    { preHandler: requireRole(signingKey, 'submitter') },
    async (request, reply) => {
      const { sub } = (request as FastifyRequest & { authClaims: AuthClaims }).authClaims;

      const mine = await db
        .select()
        .from(submissions)
        .where(eq(submissions.submitter, sub))
        .orderBy(desc(submissions.createdAt));

      const rows = await Promise.all(
        mine.map(async (submission) => {
          const { status, reason } = await buildSubmissionStatus(
            submission.id,
            request.correlationId,
            request.log,
          );
          return {
            id: submission.id,
            trackingId: submission.trackingId,
            vendor: submission.vendor,
            invoiceNumber: submission.invoiceNumber,
            total: submission.total,
            currency: submission.currency,
            status,
            reason,
            createdAt: submission.createdAt,
          };
        }),
      );

      return reply.send(rows);
    },
  );

  // F2: status + a plain-language reason for the outcome.
  app.get<{ Params: { id: string } }>(
    '/api/submissions/:id',
    { preHandler: requireRole(signingKey, 'submitter', 'approver', 'admin') },
    async (request, reply) => {
      const [submission] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, request.params.id))
        .limit(1);

      if (!submission) {
        return reply.status(404).send({ error: 'Submission not found' });
      }

      const { status, reason } = await buildSubmissionStatus(
        submission.id,
        request.correlationId,
        request.log,
      );

      return reply.send({
        id: submission.id,
        trackingId: submission.trackingId,
        correlationId: submission.correlationId,
        status,
        reason,
        submittedAt: submission.createdAt,
      });
    },
  );

  app.get<{ Params: { trackingId: string } }>(
    '/api/submissions/tracking/:trackingId',
    { preHandler: requireRole(signingKey, 'submitter', 'approver', 'admin') },
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
