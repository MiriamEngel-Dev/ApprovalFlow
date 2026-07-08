import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLogger } from '@approvalflow/shared';
import { db } from './db/client.js';
import { departmentBudgets } from './db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../sample-invoices.json');

const logger = createLogger('payment-service');

/**
 * Seeds `department_budgets` from `sample-invoices.json`'s `budgets` block on startup — a no-op
 * if the table is already populated, so the concurrency journey (INV-1014A/B) and `npm run
 * verify` run from a clean database with no manual setup (Milestone 8 done-criteria).
 */
export async function seedBudgetsIfEmpty(): Promise<void> {
  const existing = await db.select({ id: departmentBudgets.id }).from(departmentBudgets).limit(1);
  if (existing.length > 0) return;

  const { budgets } = JSON.parse(readFileSync(fixturesPath, 'utf-8')) as {
    budgets: Record<string, number>;
  };

  const rows = Object.entries(budgets).map(([department, total]) => ({
    department,
    total: total.toFixed(2),
  }));

  await db.insert(departmentBudgets).values(rows);
  logger.info({ departments: rows.map((r) => r.department) }, 'seeded department budgets');
}
