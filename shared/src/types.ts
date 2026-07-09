/**
 * Domain types shared across all services. Field names mirror `sample-invoices.json`
 * (the authoritative fixture set) so the router and every service agree on one shape.
 */

export type Category = 'meals' | 'saas' | 'travel' | 'hardware' | 'other';

export type BillingPeriod = 'monthly' | 'annual';

export type FareClass = 'economy' | 'business' | 'first';

export type Route = 'auto_approve' | 'human_review' | 'reject' | 'duplicate';

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

/** The submitted invoice/expense, as received from the submitter (F1). */
export interface Invoice {
  vendor: string;
  vendorKnown: boolean;
  invoiceNumber: string;
  currency: string;
  category: Category;
  department: string;
  submitter: string;
  lineItems: LineItem[];
  taxAmount: number;
  total: number;
  receiptPresent: boolean;
  date: string;
  notes?: string;
  attendees?: number;
  clientName?: string;
  /** Required for `category: 'saas'` to compute an effective monthly rate — ADR-010. */
  billingPeriod?: BillingPeriod;
  /** Required for `category: 'travel'` hard-stop check (TRAVEL-03). Defaults to 'economy'. */
  fareClass?: FareClass;
}

/** The invoice as it stands at decision time — original fields plus FX-normalized amount. */
export interface NormalizedInvoice extends Invoice {
  /** `total` converted to USD. Equal to `total` when `currency === 'USD'`. */
  convertedTotal: number;
}

export interface PolicyViolation {
  ruleId: string;
  message?: string;
}

/** The AI agent's structured recommendation — never itself authoritative (M12). */
export interface AgentAssessment {
  recommendation: 'approve' | 'reject' | 'review';
  confidence: number;
  reasoning: string;
  rulesCited: string[];
  violations: PolicyViolation[];
}

/** Ceiling/threshold values in force at the moment a decision was made — ADR-012. */
export interface PolicyConfig {
  ceiling: number;
  confidenceThreshold: number;
  policyVersion: number;
}

/** The deterministic router's output — the only code path that can set `auto_approve` (M12). */
export interface RouterResult {
  route: Route;
  violations: PolicyViolation[];
}

export interface Decision {
  submissionId: string;
  version: number;
  route: Route;
  agentRecommendation: AgentAssessment['recommendation'];
  agentConfidence: number;
  agentReasoning: string;
  rulesCited: string[];
  violations: PolicyViolation[];
  policySnapshot: PolicyConfig;
  correlationId: string;
}

export type ApprovalQueueStatus = 'pending' | 'approved' | 'rejected' | 'info_requested';

export interface ApprovalQueueItem {
  id: string;
  submissionId: string;
  status: ApprovalQueueStatus;
  approverId?: string;
  approverNote?: string;
  requestInfoNote?: string;
  correlationId: string;
  resolvedAt?: string;
}

// --- Pub/sub event payloads (ARCHITECTURE.md §6 — 11 topics, all carry correlationId) ---

interface EventBase {
  correlationId: string;
  submissionId: string;
}

export interface InvoiceSubmittedEvent extends EventBase {
  invoice: Invoice;
}

export interface InvoiceSupplementedEvent extends EventBase {
  patch: Partial<Invoice>;
}

export interface InvoiceResubmittedEvent extends EventBase {
  invoice: Invoice;
}

export interface DecisionMadeEvent extends EventBase {
  decisionId: string;
  route: Route;
  policySnapshot: PolicyConfig;
  /** Needed by payment-service to trigger the saga (ADR-003) on `auto_approve` without a second
   * round-trip to submission-service — decision-service already has both in hand from its own FX
   * normalization step. */
  department: string;
  amount: number;
}

export interface ApprovalTaskCreatedEvent extends EventBase {
  queueId: string;
}

export interface ApprovalCompletedEvent extends EventBase {
  queueId: string;
  approverId: string;
  /** Same rationale as `DecisionMadeEvent` — payment-service's saga trigger needs these
   * regardless of which event started it. */
  department: string;
  amount: number;
}

export interface ApprovalRejectedEvent extends EventBase {
  queueId: string;
  approverId: string;
  note?: string;
}

export interface InfoRequestedEvent extends EventBase {
  queueId: string;
  note: string;
}

export interface PaymentSucceededEvent extends EventBase {
  paymentId: string;
  amount: number;
}

export interface PaymentFailedEvent extends EventBase {
  reason: string;
}

export interface PaymentCompensatedEvent extends EventBase {
  reservationId: string;
}

export const TOPICS = {
  InvoiceSubmitted: 'InvoiceSubmitted',
  InvoiceSupplemented: 'InvoiceSupplemented',
  InvoiceResubmitted: 'InvoiceResubmitted',
  DecisionMade: 'DecisionMade',
  ApprovalTaskCreated: 'ApprovalTaskCreated',
  ApprovalCompleted: 'ApprovalCompleted',
  ApprovalRejected: 'ApprovalRejected',
  InfoRequested: 'InfoRequested',
  PaymentSucceeded: 'PaymentSucceeded',
  PaymentFailed: 'PaymentFailed',
  PaymentCompensated: 'PaymentCompensated',
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export const ROLES = ['submitter', 'approver', 'admin'] as const;

export type Role = (typeof ROLES)[number];
