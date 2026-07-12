import type { AgentAssessment, NormalizedInvoice } from '@approvalflow/shared';

/**
 * GLOBAL-FRAUD fires on "≥3 signals" (policy.md §5). Of the four named signals, three are
 * structurally computable from the invoice; "padded quantities" requires domain judgement this
 * shape of data can't represent, so it isn't implemented here — the ≥3 threshold is unvalidated
 * beyond the one shipped fixture (ADR-001's caveat), and this is deliberately not over-engineered.
 * As a defense-in-depth fallback, an agent that explicitly cites GLOBAL-FRAUD in its own
 * assessment also counts — this can only make the router *more* conservative, never less
 * (ARCHITECTURE.md §3: "Agent emits a fraud SIGNAL; deterministic router escalates").
 */

function isRoundNumber(amount: number): boolean {
  return amount > 0 && amount % 500 === 0;
}

function hasNoLineItemDetail(invoice: NormalizedInvoice): boolean {
  if (invoice.lineItems.length !== 1) return false;
  const item = invoice.lineItems[0];
  if (!item) return false;
  const wordCount = item.description.trim().split(/\s+/).filter(Boolean).length;
  return wordCount <= 2;
}

function isOffHoursSubmission(dateIso: string): boolean {
  const day = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

export function countStructuralFraudSignals(invoice: NormalizedInvoice): number {
  let count = 0;
  if (!invoice.vendorKnown && isRoundNumber(invoice.total)) count += 1;
  if (hasNoLineItemDetail(invoice)) count += 1;
  if (isOffHoursSubmission(invoice.date)) count += 1;
  return count;
}

export function hasFraudSignal(invoice: NormalizedInvoice, assessment: AgentAssessment): boolean {
  const agentFlagged = assessment.violations.some((v) => v.ruleId === 'GLOBAL-FRAUD');
  return countStructuralFraudSignals(invoice) >= 3 || agentFlagged;
}
