import { and, eq, inArray, max } from 'drizzle-orm';
import {
  createLogger,
  invokeService,
  TOPICS,
  type AgentAssessment,
  type Invoice,
  type PolicyConfig,
} from '@approvalflow/shared';
import { db } from './db/client.js';
import { decisions, approvalQueue, outbox, processedEvents } from './db/schema.js';
import { normalizeInvoice } from './router/fx.js';
import { route } from './router/router.js';
import { getPolicyConfig } from './policy-cache.js';
import { getPolicyContext } from './policy-context.js';
import type { AgentProvider } from './providers/index.js';

const logger = createLogger('decision-service');

export interface InboundInvoiceEvent {
  eventId: string;
  correlationId: string;
  submissionId: string;
  kind: 'submitted' | 'supplemented' | 'resubmitted';
  invoice?: Invoice;
}

interface SubmissionSnapshot {
  invoice: Invoice;
  correlationId: string;
}

/** `InvoiceSupplemented` only carries the patch on the wire (submission-service already merged it
 * into its own row) — fetch the current merged payload via the internal endpoint rather than
 * re-deriving the merge here, so submission-service stays the single system of record for the
 * raw invoice. */
async function resolveInvoice(event: InboundInvoiceEvent): Promise<Invoice> {
  if (event.invoice) return event.invoice;
  const snapshot = await invokeService<SubmissionSnapshot>(
    'submission-service',
    `internal/submissions/${event.submissionId}`,
  );
  return snapshot.invoice;
}

async function assessWithFailOpen(
  provider: AgentProvider,
  normalized: ReturnType<typeof normalizeInvoice>,
  correlationId: string,
): Promise<AgentAssessment> {
  try {
    return await provider.assess(normalized, getPolicyContext());
  } catch (err) {
    logger.error(
      { err, correlationId },
      'LLM provider failed — failing open to human_review (ADR-008)',
    );
    return {
      recommendation: 'review',
      confidence: 0,
      reasoning: 'AI provider error — failed open, routed to human review.',
      rulesCited: [],
      violations: [],
    };
  }
}

/**
 * Core Milestone 6 orchestration (ARCHITECTURE.md §3): FX normalize -> agent assessment
 * (fail-open on provider error, ADR-008) -> deterministic router (M12) -> atomic persist +
 * outbox. Dedups via `processed_events` (M10) so an at-least-once redelivery is a no-op. Exported
 * standalone (not folded into the HTTP route handler) so integration tests can drive it directly
 * — same separation submission-service uses for idempotency.ts.
 *
 * `policyOverride` lets tests inject a fixed `PolicyConfig` instead of going through the
 * Dapr-state-backed cache (policy-cache.ts already has its own focused unit tests for the
 * caching/version-bump behavior itself, mocking `@approvalflow/shared`'s state calls — mirroring
 * how shared/outbox-relay.test.ts mocks its collaborators rather than requiring live infra). The
 * production path (no override) is unchanged: it always calls `getPolicyConfig()`.
 */
export async function processInvoiceEvent(
  event: InboundInvoiceEvent,
  provider: AgentProvider,
  policyOverride?: PolicyConfig,
): Promise<{ status: 'processed' | 'duplicate-event' }> {
  const alreadyProcessed = await db
    .select({ eventId: processedEvents.eventId })
    .from(processedEvents)
    .where(eq(processedEvents.eventId, event.eventId))
    .limit(1);
  if (alreadyProcessed.length > 0) {
    return { status: 'duplicate-event' };
  }

  const invoice = await resolveInvoice(event);
  const normalized = normalizeInvoice(invoice);
  const policy = policyOverride ?? (await getPolicyConfig());
  const assessment = await assessWithFailOpen(provider, normalized, event.correlationId);
  const result = route(normalized, assessment, policy);

  let raceLost = false;
  await db.transaction(async (tx) => {
    // The pre-check above is a cheap optimization for the common redelivery case (skip the LLM
    // call entirely) — it is not authoritative. Two truly concurrent redeliveries of the same
    // eventId can both pass it and then both reach this transaction before either commits, so a
    // plain select-then-insert here still isn't race-proof: both selects can see "not present"
    // and both inserts then race on the real PK constraint, throwing a raw, uncaught
    // PostgresError for the loser instead of a clean duplicate-event result (reproduced directly
    // in pipeline.test.ts's concurrent-redelivery case). `onConflictDoNothing` + `returning` is
    // the actually-atomic version: whichever insert lands first wins and gets a row back; the
    // other becomes a no-op and gets none, so `inserted` unambiguously tells us who won.
    const [inserted] = await tx
      .insert(processedEvents)
      .values({ eventId: event.eventId })
      .onConflictDoNothing({ target: processedEvents.eventId })
      .returning({ eventId: processedEvents.eventId });
    if (!inserted) {
      raceLost = true;
      return;
    }

    const [existingMax] = await tx
      .select({ maxVersion: max(decisions.version) })
      .from(decisions)
      .where(eq(decisions.submissionId, event.submissionId));
    const version = (existingMax?.maxVersion ?? 0) + 1;

    const [decisionRow] = await tx
      .insert(decisions)
      .values({
        submissionId: event.submissionId,
        version,
        route: result.route,
        agentRecommendation: assessment.recommendation,
        agentConfidence: assessment.confidence.toFixed(3),
        agentReasoning: assessment.reasoning,
        rulesCited: assessment.rulesCited,
        violations: result.violations,
        policySnapshot: policy,
        correlationId: event.correlationId,
      })
      .returning({ id: decisions.id });
    if (!decisionRow) throw new Error('Insert into decisions returned no row');

    await tx.insert(outbox).values({
      topic: TOPICS.DecisionMade,
      payload: {
        correlationId: event.correlationId,
        submissionId: event.submissionId,
        decisionId: decisionRow.id,
        route: result.route,
        policySnapshot: policy,
        department: normalized.department,
        amount: normalized.convertedTotal,
        // F4/F9: the same fields persisted to `decisions` above, also on the wire — without
        // these, audit-service (a passive subscriber, ARCHITECTURE.md §8) can only ever store
        // what this payload carries, so a trimmed event silently breaks "the agent's reasoning /
        // rules applied" half of the audit trail despite `decisions` itself having the data.
        agentRecommendation: assessment.recommendation,
        agentConfidence: assessment.confidence,
        agentReasoning: assessment.reasoning,
        rulesCited: assessment.rulesCited,
        violations: result.violations,
      },
      correlationId: event.correlationId,
    });

    if (result.route === 'human_review') {
      const [existingQueueItem] = await tx
        .select({ id: approvalQueue.id })
        .from(approvalQueue)
        .where(eq(approvalQueue.submissionId, event.submissionId))
        .limit(1);

      let queueId: string;
      if (existingQueueItem) {
        // A prior request-info round already created this row — re-queue it for human
        // confirmation rather than silently resolving it, even if this re-assessment's route
        // would otherwise auto-approve. A human already intervened once; conservative-by-default,
        // consistent with ADR-008/ADR-001's posture.
        queueId = existingQueueItem.id;
        await tx
          .update(approvalQueue)
          .set({
            status: 'pending',
            resolvedAt: null,
            department: normalized.department,
            amount: normalized.convertedTotal.toFixed(2),
          })
          .where(eq(approvalQueue.id, queueId));
      } else {
        const [inserted] = await tx
          .insert(approvalQueue)
          .values({
            submissionId: event.submissionId,
            correlationId: event.correlationId,
            department: normalized.department,
            amount: normalized.convertedTotal.toFixed(2),
          })
          .returning({ id: approvalQueue.id });
        if (!inserted) throw new Error('Insert into approval_queue returned no row');
        queueId = inserted.id;
      }

      await tx.insert(outbox).values({
        topic: TOPICS.ApprovalTaskCreated,
        payload: { correlationId: event.correlationId, submissionId: event.submissionId, queueId },
        correlationId: event.correlationId,
      });
    } else {
      // A re-assessment (after a supplement) resolved to something other than human_review. If
      // this submission had an existing queue row — most commonly `info_requested`, paused by
      // requestInfoOnQueueItem — it must be closed out here, or it stays stuck at its old status
      // forever even though `decisions`/payment already moved on with the new route (F5, F9).
      // Only touch a row still "in flight" (pending/info_requested) — never overwrite a human's
      // own approved/rejected decision, and never re-touch an already-superseded row.
      await tx
        .update(approvalQueue)
        .set({ status: 'superseded', resolvedAt: new Date() })
        .where(
          and(
            eq(approvalQueue.submissionId, event.submissionId),
            inArray(approvalQueue.status, ['pending', 'info_requested']),
          ),
        );
    }
  });

  if (raceLost) return { status: 'duplicate-event' };
  return { status: 'processed' };
}
