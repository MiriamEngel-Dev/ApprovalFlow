import type { NormalizedInvoice, PolicyViolation } from '@approvalflow/shared';

/**
 * Per-category policy-compliance gates (policy.md §1-4). Only reached once `getHardStopViolations`
 * is clean — these assume attendees/clientName are present where required. `category: 'other'`
 * has no rule here by design (ARCHITECTURE.md §5): an unbounded category never gets a free pass,
 * it relies solely on hard stops, confidence, and the ceiling.
 */
export function getCategoryViolations(invoice: NormalizedInvoice): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  if (invoice.category === 'meals' && invoice.attendees) {
    const perAttendee = invoice.convertedTotal / invoice.attendees;
    if (perAttendee > 75) {
      violations.push({ ruleId: 'MEAL-01', message: 'Over $75 per attendee' });
    }
  }

  if (invoice.category === 'saas') {
    const effectiveMonthly =
      invoice.billingPeriod === 'annual' ? invoice.convertedTotal / 12 : invoice.convertedTotal;
    if (effectiveMonthly > 200) {
      violations.push({ ruleId: 'SAAS-01', message: 'Over $200/month' });
    }
  }

  if (invoice.category === 'hardware' && invoice.convertedTotal > 1000) {
    violations.push({ ruleId: 'HW-02', message: 'Hardware over $1,000 is Capital' });
  }

  if (invoice.category === 'travel' && invoice.convertedTotal > 1500) {
    violations.push({ ruleId: 'TRAVEL-02', message: 'Single travel expense over $1,500' });
  }

  return violations;
}
