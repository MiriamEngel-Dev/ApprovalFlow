import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { PolicyViolation, Route } from '@approvalflow/shared';
import { db } from '../db/client.js';
import { approvalQueue, decisions } from '../db/schema.js';

export type DecisionSummary =
  | { found: false }
  | {
      found: true;
      route: Route;
      violations: PolicyViolation[];
      approval?: {
        status: 'pending' | 'approved' | 'rejected' | 'info_requested' | 'superseded';
        approverNote: string | null;
        requestInfoNote: string | null;
      };
    };

/**
 * `decisions.route` is the router's own decision and is never overwritten (F9: it's a versioned
 * audit trail, not a live status — `approveQueueItem`/`rejectQueueItem` intentionally never touch
 * it). A human's resolution of an escalated item lives separately, on `approval_queue`. Reporting
 * only `route` here means a submitter whose item was escalated and later approved by a human would
 * see "Escalated for human review" forever, even after payment completed — so this also looks up
 * the queue row (if any) and returns its resolution alongside the router's route, letting the
 * caller (submission-service) build a status that reflects what actually happened.
 *
 * Exported standalone (not inlined in the route) so it's directly unit-testable against real
 * Postgres, matching this service's existing convention (`queue-actions.ts`) rather than
 * Fastify-injection route tests, which this service doesn't otherwise use.
 */
export async function getDecisionSummary(submissionId: string): Promise<DecisionSummary> {
  const [latest] = await db
    .select({ route: decisions.route, violations: decisions.violations })
    .from(decisions)
    .where(eq(decisions.submissionId, submissionId))
    .orderBy(desc(decisions.version))
    .limit(1);

  if (!latest) {
    return { found: false };
  }

  const [queueItem] = await db
    .select({
      status: approvalQueue.status,
      approverNote: approvalQueue.approverNote,
      requestInfoNote: approvalQueue.requestInfoNote,
    })
    .from(approvalQueue)
    .where(eq(approvalQueue.submissionId, submissionId))
    .limit(1);

  return {
    found: true,
    route: latest.route as Route,
    violations: latest.violations as PolicyViolation[],
    ...(queueItem
      ? {
          approval: {
            status: queueItem.status as
              'pending' | 'approved' | 'rejected' | 'info_requested' | 'superseded',
            approverNote: queueItem.approverNote,
            requestInfoNote: queueItem.requestInfoNote,
          },
        }
      : {}),
  };
}

/** Internal, service-to-service only — submission-service's `GET /api/submissions/:id` (F2)
 * and `PATCH /api/invoices/:id/supplement` call this to look up decision state. Not part of the
 * public API / docs/openapi.yaml.
 *
 * Always `200`s for a syntactically valid lookup — "no decision recorded yet" is a normal state
 * for a freshly-submitted invoice (`{found: false}`), not an error, so it's never represented as
 * a non-2xx status. Dapr's resiliency circuit breaker (`dapr/components/resiliency.yaml`) counts
 * any non-2xx app response as a failure toward the same breaker that also gates pub/sub delivery
 * to this service; a submitter (or the UI) polling status before a decision exists used to trip
 * that breaker after 5 routine polls, blocking the `InvoiceSubmitted` delivery that would have
 * produced the decision in the first place. Non-2xx is reserved for actual failures now (DB
 * unreachable, etc.) — the only cases that should still count toward the breaker. */
export function registerInternalRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/internal/decisions/by-submission/:id',
    async (request, reply) => {
      return reply.send(await getDecisionSummary(request.params.id));
    },
  );
}
