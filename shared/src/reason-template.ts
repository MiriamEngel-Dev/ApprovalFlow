import type { PolicyViolation, Route } from './types.js';

/**
 * Human-readable text per policy.md rule_id, for the submitter-facing plain-language reason
 * (F2). Deliberately separate from the agent's raw `reasoning` string — built only from `route` +
 * `violations[].ruleId`, so adversarial `notes` content in the payload can never echo back into
 * what the submitter sees (ARCHITECTURE.md §9).
 */
const RULE_MESSAGES: Record<string, string> = {
  'GLOBAL-DUP': 'This looks like a duplicate of an already-processed submission.',
  'MEAL-03': 'Alcohol-only receipts are not reimbursable.',
  'GLOBAL-VENDOR': 'New or unknown vendors always require manager review.',
  'GLOBAL-RECEIPT': 'A receipt is required for expenses over $25.',
  'GLOBAL-FX': 'The foreign-currency amount exceeds the review threshold after conversion.',
  'GLOBAL-MATH': 'The line items and tax do not add up to the total.',
  'GLOBAL-FRAUD': 'This submission matched fraud-pattern signals and needs manual review.',
  'MEAL-01': 'Missing attendee count, or over the $75-per-attendee meal cap.',
  'MEAL-02': 'Client entertainment over $500 needs a client name on file.',
  'SAAS-01': 'The subscription cost exceeds the $200/month policy cap.',
  'HW-02': 'Hardware purchases over $1,000 are capital expenses and need approval.',
  'TRAVEL-02': 'Single travel expenses over $1,500 always need manager approval.',
  'TRAVEL-03': 'First/business-class travel always needs manager approval.',
  'AUTONOMY-CONFIDENCE': 'The assessment confidence was below the auto-approval threshold.',
  'AUTONOMY-CEILING': 'The amount is above the auto-approval ceiling.',
};

const ROUTE_LABELS: Record<Route, string> = {
  auto_approve: 'Approved automatically',
  human_review: 'Escalated for human review',
  reject: 'Rejected',
  duplicate: 'Flagged as a duplicate submission',
};

export function buildReason(route: Route, violations: PolicyViolation[]): string {
  const label = ROUTE_LABELS[route];
  if (violations.length === 0) return `${label}.`;
  const reasons = violations.map((v) => RULE_MESSAGES[v.ruleId] ?? `Rule ${v.ruleId} applied.`);
  return `${label}: ${reasons.join(' ')}`;
}
