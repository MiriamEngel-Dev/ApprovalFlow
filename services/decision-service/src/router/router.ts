import type {
  AgentAssessment,
  NormalizedInvoice,
  PolicyConfig,
  RouterResult,
} from '@approvalflow/shared';
import { getHardStopViolations } from './hard-stops.js';
import { getCategoryViolations } from './category-rules.js';

export interface RouteContext {
  /** Set by the caller when submission-service's own UNIQUE-constraint check already fired, or
   * when this is a direct decision-service invocation that bypasses that check (defense in depth
   * — ARCHITECTURE.md §5). */
  isDuplicate?: boolean;
}

function isAlcoholOnly(invoice: NormalizedInvoice): boolean {
  return (
    invoice.category === 'meals' &&
    invoice.lineItems.length > 0 &&
    invoice.lineItems.every((item) => /alcohol/i.test(item.description))
  );
}

/**
 * The deterministic router (M12, F6, F10) — the ONLY code path that can produce `auto_approve`.
 * Pure and I/O-free: ceiling/threshold come in as `policy`, never read from anywhere else. The
 * agent's `recommendation` is never consulted here — only `confidence` (the one gate it
 * influences) and `violations` (as an additive fraud-detection signal, which can only escalate,
 * never approve). This is what makes the ceiling provable regardless of what the agent says.
 */
export function route(
  invoice: NormalizedInvoice,
  assessment: AgentAssessment,
  policy: PolicyConfig,
  context: RouteContext = {},
): RouterResult {
  if (context.isDuplicate) {
    return { route: 'duplicate', violations: [{ ruleId: 'GLOBAL-DUP' }] };
  }

  if (isAlcoholOnly(invoice)) {
    return { route: 'reject', violations: [{ ruleId: 'MEAL-03' }] };
  }

  const hardStopViolations = getHardStopViolations(invoice, assessment);
  if (hardStopViolations.length > 0) {
    return { route: 'human_review', violations: hardStopViolations };
  }

  const categoryViolations = getCategoryViolations(invoice);
  if (categoryViolations.length > 0) {
    return { route: 'human_review', violations: categoryViolations };
  }

  if (assessment.confidence < policy.confidenceThreshold) {
    return { route: 'human_review', violations: [{ ruleId: 'AUTONOMY-CONFIDENCE' }] };
  }

  if (invoice.convertedTotal > policy.ceiling) {
    return { route: 'human_review', violations: [{ ruleId: 'AUTONOMY-CEILING' }] };
  }

  return { route: 'auto_approve', violations: [] };
}
