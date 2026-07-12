// Integration test against a real Postgres — same convention as ../queue-actions.test.ts (this
// service tests extracted logic against a real DB rather than via Fastify route injection).
import { randomUUID } from 'node:crypto';
import { sql as rawSql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { approvalQueue, decisions } from '../db/schema.js';
import { getDecisionSummary } from './internal.js';

async function seedDecision(submissionId: string): Promise<void> {
  await db.insert(decisions).values({
    submissionId,
    version: 1,
    route: 'human_review',
    agentRecommendation: 'review',
    agentConfidence: '0.500',
    agentReasoning: 'Ambiguous category.',
    rulesCited: [],
    violations: [],
    policySnapshot: { ceiling: 250, confidenceThreshold: 0.8, policyVersion: 1 },
    correlationId: randomUUID(),
  });
}

beforeEach(async () => {
  await db.execute(rawSql`TRUNCATE decisions, approval_queue`);
});

describe('getDecisionSummary — internal contract for submission-service (F2, F5)', () => {
  it('returns {found: false} for a submission with no decision yet — never a 404 (this is a normal, expected state, not a failure; see internal.ts doc comment on the circuit-breaker bug this avoids)', async () => {
    const result = await getDecisionSummary(randomUUID());
    expect(result).toEqual({ found: false });
  });

  it('returns {found: true, route, violations} with no approval when no queue row exists', async () => {
    const submissionId = randomUUID();
    await seedDecision(submissionId);

    const result = await getDecisionSummary(submissionId);
    expect(result).toMatchObject({ found: true, route: 'human_review', violations: [] });
    if (result.found) {
      expect(result.approval).toBeUndefined();
    }
  });

  it('includes the approval_queue resolution alongside the router route when a queue row exists', async () => {
    const submissionId = randomUUID();
    await seedDecision(submissionId);
    await db.insert(approvalQueue).values({
      submissionId,
      status: 'approved',
      department: 'engineering-2026Q2',
      amount: '100.00',
      submitter: 'jane@northwind.example',
      approverId: 'manager@northwind.example',
      correlationId: randomUUID(),
    });

    const result = await getDecisionSummary(submissionId);
    expect(result).toMatchObject({
      found: true,
      route: 'human_review',
      approval: { status: 'approved' },
    });
  });
});
