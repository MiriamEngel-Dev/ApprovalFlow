import type { FastifyInstance } from 'fastify';
import { requireRole } from '@approvalflow/shared';
import { sql } from '../db/client.js';

interface RouteCountRow {
  route: string | null;
  count: string;
}

interface MoneySplitRow {
  path: 'auto' | 'human';
  total: string | null;
}

export interface DashboardStats {
  totalDecisions: number;
  byRoute: Record<string, number>;
  moneyAutoApproved: number;
  moneyHumanApproved: number;
}

/** F8: throughput, auto-approval vs. escalation rates, money auto-approved vs. human-approved —
 * computed with plain SQL over `audit_events` rather than a separate materialized table (this
 * capstone's traffic doesn't warrant one). "Human-approved" money is any `PaymentSucceeded` whose
 * submission also has an `ApprovalCompleted` row; everything else that got paid went through
 * auto_approve (the router never lets a human_review item reach payment without one — M12). */
export async function getDashboardStats(): Promise<DashboardStats> {
  const [totalRow] = await sql<{ total: string }[]>`
    SELECT COUNT(DISTINCT submission_id) AS total
    FROM audit_events WHERE event_type = 'DecisionMade'
  `;

  const routeRows = await sql<RouteCountRow[]>`
    SELECT payload->>'route' AS route, COUNT(*) AS count
    FROM audit_events WHERE event_type = 'DecisionMade'
    GROUP BY payload->>'route'
  `;

  const moneyRows = await sql<MoneySplitRow[]>`
    SELECT
      CASE WHEN EXISTS (
        SELECT 1 FROM audit_events ac
        WHERE ac.submission_id = pe.submission_id AND ac.event_type = 'ApprovalCompleted'
      ) THEN 'human' ELSE 'auto' END AS path,
      SUM((pe.payload->>'amount')::numeric) AS total
    FROM audit_events pe
    WHERE pe.event_type = 'PaymentSucceeded'
    GROUP BY path
  `;

  const byRoute: Record<string, number> = {};
  for (const row of routeRows) {
    if (row.route) byRoute[row.route] = Number(row.count);
  }

  const money = { auto: 0, human: 0 };
  for (const row of moneyRows) {
    money[row.path] = Number(row.total ?? 0);
  }

  return {
    totalDecisions: Number(totalRow?.total ?? 0),
    byRoute,
    moneyAutoApproved: money.auto,
    moneyHumanApproved: money.human,
  };
}

export function registerDashboardRoutes(app: FastifyInstance, signingKey: string): void {
  app.get(
    '/api/dashboard',
    { preHandler: requireRole(signingKey, 'approver', 'admin') },
    async (_request, reply) => reply.send(await getDashboardStats()),
  );
}
