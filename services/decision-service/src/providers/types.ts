import type { AgentAssessment, NormalizedInvoice } from '@approvalflow/shared';

/** Thrown by a provider on any error/timeout/malformed response — never swallowed (ADR-008,
 * M15). The caller catches this, logs it with correlationId, and fails open (confidence=0). */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export interface AgentProvider {
  assess(invoice: NormalizedInvoice, policyContext: string): Promise<AgentAssessment>;
}
