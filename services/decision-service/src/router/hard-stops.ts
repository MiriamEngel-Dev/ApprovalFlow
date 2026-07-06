import type { AgentAssessment, NormalizedInvoice, PolicyViolation } from '@approvalflow/shared';
import { hasFraudSignal } from './fraud-signals.js';

const MATH_TOLERANCE = 0.01;

function mathReconciles(invoice: NormalizedInvoice): boolean {
  const lineItemsTotal = invoice.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  return Math.abs(lineItemsTotal + invoice.taxAmount - invoice.total) <= MATH_TOLERANCE;
}

/**
 * Structural, always-escalate checks (policy.md §5, §1-2). Independent of the agent's
 * recommendation — these fire from the invoice's own fields, never from LLM output, so they
 * cannot be bypassed by prompt injection in `notes`.
 */
export function getHardStopViolations(
  invoice: NormalizedInvoice,
  assessment: AgentAssessment,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  if (!invoice.vendorKnown) {
    violations.push({
      ruleId: 'GLOBAL-VENDOR',
      message: 'New/unknown vendor always requires review',
    });
  }
  if (!invoice.receiptPresent && invoice.convertedTotal > 25) {
    violations.push({
      ruleId: 'GLOBAL-RECEIPT',
      message: 'Receipt required for expenses over $25',
    });
  }
  if (invoice.currency !== 'USD' && invoice.convertedTotal > 1000) {
    violations.push({ ruleId: 'GLOBAL-FX', message: 'FX item over $1,000 after conversion' });
  }
  if (!mathReconciles(invoice)) {
    violations.push({
      ruleId: 'GLOBAL-MATH',
      message: 'Line items + tax do not reconcile to total',
    });
  }
  if (hasFraudSignal(invoice, assessment)) {
    violations.push({ ruleId: 'GLOBAL-FRAUD', message: 'Fraud-pattern signals detected' });
  }
  if (invoice.category === 'meals' && invoice.attendees === undefined) {
    violations.push({ ruleId: 'MEAL-01', message: 'Missing attendee count' });
  }
  if (invoice.category === 'meals' && invoice.convertedTotal > 500 && !invoice.clientName) {
    violations.push({
      ruleId: 'MEAL-02',
      message: 'Client entertainment over $500 missing client name',
    });
  }
  if (
    invoice.category === 'travel' &&
    (invoice.fareClass === 'business' || invoice.fareClass === 'first')
  ) {
    violations.push({
      ruleId: 'TRAVEL-03',
      message: 'First/business class always requires approval',
    });
  }

  return violations;
}
