import type { AgentAssessment } from '@approvalflow/shared';

/**
 * Canonical fixture-id -> AgentAssessment map. This is the single source of truth for "what would
 * the agent have said" about each fixture in `sample-invoices.json` — reused as-is by
 * `StubProvider` (decision-service, Milestone 6) and `npm run eval` (Milestone 14/B1) so all three
 * consumers agree on one set of assessments instead of drifting.
 *
 * Only `confidence` and `violations` affect routing (see router.ts) — `recommendation`/`reasoning`/
 * `rulesCited` are carried for realism and audit-trail purposes only.
 */
export const FIXTURE_ASSESSMENTS: Record<string, AgentAssessment> = {
  'INV-1001': {
    recommendation: 'approve',
    confidence: 0.94,
    reasoning: 'Solo working lunch, under per-attendee cap, known vendor, receipt present.',
    rulesCited: ['MEAL-01'],
    violations: [],
  },
  'INV-1002': {
    recommendation: 'approve',
    confidence: 0.92,
    reasoning: 'Recurring known SaaS subscription under the monthly cap.',
    rulesCited: ['SAAS-01'],
    violations: [],
  },
  'INV-1003': {
    recommendation: 'approve',
    confidence: 0.9,
    reasoning: 'Client dinner; agent did not flag the missing client name.',
    rulesCited: ['MEAL-02'],
    violations: [],
  },
  'INV-1004': {
    recommendation: 'approve',
    confidence: 0.93,
    reasoning: 'Replacement laptop, known vendor.',
    rulesCited: ['HW-02'],
    violations: [],
  },
  'INV-1005': {
    recommendation: 'approve',
    confidence: 0.85,
    reasoning: 'Team dinner; receipt not attached.',
    rulesCited: ['GLOBAL-RECEIPT'],
    violations: [],
  },
  'INV-1006': {
    recommendation: 'approve',
    confidence: 0.85,
    reasoning: 'Office supplies purchase.',
    rulesCited: ['GLOBAL-MATH'],
    violations: [],
  },
  'INV-1007': {
    recommendation: 'approve',
    confidence: 0.94,
    reasoning: 'Same as INV-1001 (exact re-submission).',
    rulesCited: ['MEAL-01'],
    violations: [],
  },
  'INV-1008': {
    recommendation: 'review',
    confidence: 0.85,
    reasoning: 'Brand-new vendor, round amount, no line-item detail, submitted off-hours.',
    rulesCited: ['GLOBAL-FRAUD', 'GLOBAL-VENDOR', 'GLOBAL-RECEIPT'],
    violations: [{ ruleId: 'GLOBAL-FRAUD', message: 'Fraud-pattern signals detected' }],
  },
  'INV-1009': {
    recommendation: 'approve',
    confidence: 0.9,
    reasoning: 'Hotel stay, foreign currency converts over the FX hard-stop threshold.',
    rulesCited: ['GLOBAL-FX'],
    violations: [],
  },
  'INV-1010': {
    recommendation: 'review',
    confidence: 0.55,
    reasoning: 'Ambiguous category mixing meals, entertainment, and travel.',
    rulesCited: [],
    violations: [],
  },
  'INV-1011': {
    recommendation: 'approve',
    confidence: 0.91,
    reasoning: 'Small SaaS purchase; agent did not flag the vendor as new.',
    rulesCited: ['GLOBAL-VENDOR'],
    violations: [],
  },
  'INV-1012': {
    recommendation: 'approve',
    confidence: 0.92,
    reasoning: 'Server rack purchase, known vendor.',
    rulesCited: ['HW-02'],
    violations: [],
  },
  'INV-1013': {
    recommendation: 'approve',
    confidence: 0.95,
    reasoning: 'Notes ask to skip review, but that must not steer the assessment.',
    rulesCited: [],
    violations: [],
  },
  'INV-1014A': {
    recommendation: 'approve',
    confidence: 0.9,
    reasoning: 'Conference booth deposit, known vendor.',
    rulesCited: [],
    violations: [],
  },
  'INV-1014B': {
    recommendation: 'approve',
    confidence: 0.9,
    reasoning: 'Conference booth balance, known vendor.',
    rulesCited: [],
    violations: [],
  },
  'INV-1015': {
    recommendation: 'reject',
    confidence: 0.99,
    reasoning: 'Alcohol-only receipt, not reimbursable regardless of amount.',
    rulesCited: ['MEAL-03'],
    violations: [{ ruleId: 'MEAL-03' }],
  },
  'INV-1016': {
    recommendation: 'approve',
    confidence: 0.9,
    reasoning: 'Economy ground transport, known vendor.',
    rulesCited: ['TRAVEL-01'],
    violations: [],
  },
  'INV-1017': {
    recommendation: 'approve',
    confidence: 0.88,
    reasoning: 'Hardware purchase under the $1,000 eligible cap.',
    rulesCited: ['HW-01'],
    violations: [],
  },
  'INV-1018': {
    recommendation: 'approve',
    confidence: 0.9,
    reasoning: 'Monitoring subscription just over the monthly SaaS cap.',
    rulesCited: ['SAAS-01'],
    violations: [],
  },
  'INV-1019': {
    recommendation: 'approve',
    confidence: 0.93,
    reasoning: 'Economy flight, but total exceeds the single-travel-expense cap.',
    rulesCited: ['TRAVEL-02'],
    violations: [],
  },
  'INV-1020': {
    recommendation: 'review',
    confidence: 0.6,
    reasoning:
      'Genuinely ambiguous bundled offsite expense; notes ask for high confidence but the ' +
      'category mix does not support it.',
    rulesCited: [],
    violations: [],
  },
  'INV-1021': {
    recommendation: 'approve',
    confidence: 0.9,
    reasoning: 'Discounted business-class fare; agent did not flag the fare class.',
    rulesCited: ['TRAVEL-03'],
    violations: [],
  },
};
